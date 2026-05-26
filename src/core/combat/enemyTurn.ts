import type { RngState } from '../rng/mulberry32'
import type {
  Cell,
  CombatPhase,
  Enemy,
  GameEvent,
  HexedColor,
  Intent,
  PetrifiedRows,
  Player,
} from '../../types'
import { applyIntentTelegraph, rollIntent } from './intents'
import { applyDamage } from './damage'
import { tickStatuses } from './statuses'
import {
  resolveAttackIntent,
  resolveBlockIntent,
  resolveBuffAllyIntent,
  resolveClusterShoveIntent,
  resolveColorHexIntent,
  resolveColumnSmashIntent,
  resolveHealAllyIntent,
  resolvePetrifyRowIntent,
  resolveShieldAllyIntent,
  resolveTileBurnIntent,
} from './intentResolvers'
import { detectMatches } from '../board/detectMatches'
import { runCascade } from '../board/cascade'
import { processCascadeEvents } from './cascadeProcessor'

export type EnemyTurnResult = {
  player: Player
  enemies: Enemy[]
  board: Cell[][]
  petrifiedRows: PetrifiedRows
  hexedColors: HexedColor[]
  rng: RngState
  phase: CombatPhase
  events: GameEvent[]
  // Re-pointed target. Enemy-caused board changes (cluster-shove) can
  // create matches that kill the current target; processCascadeEvents
  // re-points to the leftmost living enemy. Caller (swap.ts) reads
  // this back into fight.targetEnemyId.
  targetEnemyId: string | null
}

// Execute one enemy turn for every living enemy: tick statuses, resolve
// currentIntent (or have Riposte parry it), then advance pattern index
// and roll the *next* intent for telegraphing. Returns next phase
// ('player-acting' or 'game-over' if the player died). Caller is
// responsible for beginPlayerPhase before the next player swap — block
// zeroing happens at the start of the next player phase, AFTER any damage
// absorption that occurred during this enemy turn.
//
// Block intent is pre-applied at telegraph time (here for subsequent turns,
// in freshFight for the initial intent) so the enemy is already guarded
// when the player swaps. Processing a `block` currentIntent below is a
// no-op — the block already went up at the end of the previous turn.
//
// Riposte: if player.pendingSpells includes 'riposte' and the enemy's
// current intent is an attack, the attack is parried (player takes 0
// damage) and the full pre-block intent amount is dealt back to the
// attacking enemy. Consumes Riposte. If no attack came across the whole
// enemy turn, Riposte expires unused at the end of the turn.
//
// Per-intent-kind logic lives in `intentResolvers.ts` — this function
// orchestrates the per-enemy loop (tick → resolve → telegraph) and
// owns the cross-cutting state (player, enemies, board, rng, petrifiedRows).
export function executeEnemyTurn(
  player: Player,
  enemies: Enemy[],
  board: Cell[][],
  rng: RngState,
  petrifiedRows: PetrifiedRows = {},
  hexedColors: HexedColor[] = [],
  // Player's current target. Needed so post-action cascades (e.g. a
  // cluster-shove that lined up a 3-match) can route damage through
  // processCascadeEvents and re-point the target if it dies.
  targetEnemyId: string | null = null,
): EnemyTurnResult {
  const events: GameEvent[] = []
  // Telegraph events for the *next* player turn (enemy-block-gained
  // when the upcoming intent is block, intent-telegraphed, and any
  // applyIntentTelegraph placed events) are deferred to a side buffer
  // and flushed once after the per-enemy loop. Without this they fire
  // interleaved with each enemy's action, so the player watches intents
  // tick in one by one across the enemy turn; flushing them together
  // means all new intents (and their threat overlays) pop in
  // simultaneously at the start of the next player turn. Board mutations
  // from applyIntentTelegraph still happen IN the loop (the side buffer
  // only defers the *events*) so subsequent enemies see the latest
  // board.
  const telegraphEvents: GameEvent[] = []
  // Track sibling intents rolled THIS turn so each roller can avoid
  // overlapping claims with earlier-rolled siblings (cross-archetype
  // — Brute vs Defender vs Swarmer vs Caster all share this view).
  // Push after each successful roll; rollIntent reads it on the next
  // enemy's call.
  const siblingNextIntents: Intent[] = []
  let nextPlayer: Player = player
  let nextEnemies: Enemy[] = enemies
  let nextBoard: Cell[][] = board
  let nextPetrifiedRows: PetrifiedRows = petrifiedRows
  let nextHexedColors: HexedColor[] = hexedColors
  let nextRng = rng
  let nextTargetEnemyId: string | null = targetEnemyId

  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue
    if (nextPlayer.hp <= 0) break

    // Status tick at start of this enemy's turn (02-scope §Tick
    // granularity). Mirror the player-side order: emit `damage-dealt`
    // BEFORE the tick events so the chip → HP particle trail can
    // snapshot the chip's position while it still exists; a final-
    // tick expiry that removes the chip happens after the trail is
    // already in flight.
    const ticked = tickStatuses(enemy.id, enemy.statuses)
    let workingEnemy: Enemy = { ...enemy, statuses: ticked.statuses }
    if (ticked.burnDamage > 0 && workingEnemy.hp > 0) {
      // Burn ticks route through applyDamage so the enemy's own block
      // eats the burn first — same rule as the player side. Block-tick
      // sub-events fire between damage-dealt and the status-ticked
      // /-expired events to preserve the chip→target FX ordering.
      const res = applyDamage(
        workingEnemy.block,
        workingEnemy.hp,
        ticked.burnDamage,
      )
      workingEnemy = {
        ...workingEnemy,
        hp: res.hpAfter,
        block: res.blockAfter,
      }
      events.push({
        kind: 'damage-dealt',
        targetId: workingEnemy.id,
        amount: res.hpDamage,
        blocked: res.blocked,
        source: 'burn',
      })
      if (res.blockBroken) {
        events.push({ kind: 'block-broken', targetId: workingEnemy.id })
      } else if (res.blockAbsorbed) {
        events.push({ kind: 'block-absorbed', targetId: workingEnemy.id })
      }
      if (res.killed) {
        events.push({ kind: 'enemy-killed', enemyId: workingEnemy.id })
      }
    }
    events.push(...ticked.events)

    nextEnemies = nextEnemies.map((e) =>
      e.id === workingEnemy.id ? workingEnemy : e,
    )

    if (workingEnemy.hp <= 0) {
      continue
    }

    const intent = workingEnemy.currentIntent
    let updatedEnemy: Enemy = workingEnemy

    // Dispatch to the per-kind resolver. Each returns only the slices
    // it changed; we apply the patches back here. Exhaustive switch is
    // checked by the resolver coverage — adding a new IntentKind without
    // a corresponding resolver fails typecheck.
    if (intent.kind === 'attack') {
      const r = resolveAttackIntent(intent, updatedEnemy, nextPlayer, nextEnemies)
      updatedEnemy = r.source
      nextPlayer = r.player
      events.push(...r.events)
    } else if (intent.kind === 'tile-burn') {
      const r = resolveTileBurnIntent(intent, updatedEnemy, nextBoard, nextRng)
      nextBoard = r.board
      nextRng = r.rng
      events.push(...r.events)
    } else if (intent.kind === 'column-smash') {
      const r = resolveColumnSmashIntent(intent, updatedEnemy, nextBoard, nextRng)
      nextBoard = r.board
      nextRng = r.rng
      events.push(...r.events)
    } else if (intent.kind === 'petrify-row') {
      const r = resolvePetrifyRowIntent(intent, updatedEnemy, nextPetrifiedRows)
      nextPetrifiedRows = r.petrifiedRows
      events.push(...r.events)
    } else if (intent.kind === 'color-hex') {
      const r = resolveColorHexIntent(intent, updatedEnemy, nextHexedColors)
      nextHexedColors = r.hexedColors
      events.push(...r.events)
    } else if (intent.kind === 'cluster-shove') {
      const r = resolveClusterShoveIntent(updatedEnemy, nextBoard, nextRng)
      nextBoard = r.board
      nextRng = r.rng
      events.push(...r.events)
    } else if (intent.kind === 'block') {
      const r = resolveBlockIntent(updatedEnemy)
      events.push(...r.events)
    } else if (intent.kind === 'heal-ally') {
      const r = resolveHealAllyIntent(intent, updatedEnemy, nextEnemies)
      nextEnemies = r.enemies
      events.push(...r.events)
    } else if (intent.kind === 'buff-ally') {
      const r = resolveBuffAllyIntent(intent, updatedEnemy, nextEnemies)
      nextEnemies = r.enemies
      events.push(...r.events)
    } else if (intent.kind === 'shield-ally') {
      const r = resolveShieldAllyIntent(intent, updatedEnemy, nextEnemies)
      nextEnemies = r.enemies
      events.push(...r.events)
    }

    // Fire enemy-acted AFTER this enemy's action events. The intent
    // badge fades on this event (one badge at a time, in lockstep with
    // the action playing out) rather than all badges hiding at the
    // start of the enemy phase.
    events.push({ kind: 'enemy-acted', enemyId: updatedEnemy.id })

    // Telegraph next intent for the *next* player phase. If it's a block
    // intent, apply the block now so it's already in place when the player
    // attacks during their next phase. Skip if this enemy just died.
    if (updatedEnemy.hp > 0) {
      const nextIndex = updatedEnemy.nextIntentIndex + 1
      // Pass the current living enemies and roller's id so ally-target intents
      // can pick a sibling deterministically. nextEnemies reflects mid-turn
      // deaths (e.g. burn kills), so the target pool is always fresh.
      const rolled = rollIntent(
        updatedEnemy.archetype,
        nextIndex,
        nextRng,
        nextEnemies,
        updatedEnemy.id,
        siblingNextIntents,
      )
      // Record so the NEXT sibling to roll sees this enemy's claim.
      siblingNextIntents.push(rolled.intent)
      nextRng = rolled.rng
      let updatedBlock = updatedEnemy.block
      if (rolled.intent.kind === 'block') {
        updatedBlock = updatedBlock + rolled.intent.amount
        telegraphEvents.push({
          kind: 'enemy-block-gained',
          enemyId: updatedEnemy.id,
          amount: rolled.intent.amount,
        })
      }
      updatedEnemy = {
        ...updatedEnemy,
        block: updatedBlock,
        currentIntent: rolled.intent,
        nextIntentIndex: nextIndex,
      }
      telegraphEvents.push({
        kind: 'intent-telegraphed',
        enemyId: updatedEnemy.id,
        intent: rolled.intent,
      })
      // H2b: if the rolled next intent is a board verb, apply its
      // telegraph flag immediately so the player can see (and counter)
      // the threat during their next phase. column-smash flags cells
      // in the column; petrify-row writes to BoardState.petrifiedRows.
      // Board mutations land in nextBoard now (subsequent enemies need
      // them); the *events* describing the telegraph are deferred to
      // telegraphEvents so they fan out in one frame at turn end.
      const tele = applyIntentTelegraph(
        nextBoard,
        nextPetrifiedRows,
        rolled.intent,
        updatedEnemy.id,
        updatedEnemy.archetype,
      )
      nextBoard = tele.board
      nextPetrifiedRows = tele.petrifiedRows
      telegraphEvents.push(...tele.events)
    }

    nextEnemies = nextEnemies.map((e) =>
      e.id === updatedEnemy.id ? updatedEnemy : e,
    )
  }

  // Riposte expires unused at the end of the enemy turn if no attack came.
  if (nextPlayer.pendingSpells.includes('riposte')) {
    nextPlayer = {
      ...nextPlayer,
      pendingSpells: nextPlayer.pendingSpells.filter((id) => id !== 'riposte'),
    }
    events.push({ kind: 'pending-effect-resolved', spellId: 'riposte' })
  }

  // Post-action cascade: enemy actions can rearrange the board (cluster-
  // shove writes new cells; column-smash clears + refills). The H2c
  // design ("existing gravity + match-detection picks up any resulting
  // match naturally") relies on a cascade pass here; without it, a
  // shove that lines up a 3-run leaves matching gems sitting on the
  // board until the next swap. Run match detection on the current
  // nextBoard; if any matches exist, cascade them and route the result
  // through processCascadeEvents so the player gets pool/damage credit
  // (Swarmer's verb can "be useful, can ruin a set-up" per design —
  // useful means: player benefits when a match lands).
  //
  // The cascade events go BEFORE the telegraph flush so the visual
  // ordering is: enemy actions → resolution cascade → new intents pop
  // in. That mirrors the swap-side pipeline (swap → cascade → enemy
  // turn).
  const postActionMatches = detectMatches(nextBoard)
  if (postActionMatches.length > 0) {
    const cascade = runCascade(nextBoard, nextRng, postActionMatches)
    nextBoard = cascade.board
    nextRng = cascade.rng
    const processed = processCascadeEvents(
      cascade.events,
      nextPlayer,
      nextEnemies,
      nextTargetEnemyId,
      nextHexedColors,
    )
    nextPlayer = processed.player
    nextEnemies = processed.enemies
    nextTargetEnemyId = processed.targetEnemyId
    events.push(...processed.events)
  }

  // Flush the deferred telegraph events. Order: enemy-action events
  // (above) → post-action cascade (above) → telegraph batch (all
  // enemies' new intents pop in at once) → phase-changed. Filter out
  // telegraphs from enemies that died after their telegraph was
  // buffered — Riposte / Thornmail / a post-action cascade kill can
  // end an enemy AFTER its own turn ended; the buffered
  // intent-telegraphed would otherwise show "next intent" briefly on
  // a corpse.
  const livingEnemyIds = new Set(
    nextEnemies.filter((e) => e.hp > 0).map((e) => e.id),
  )
  for (const ev of telegraphEvents) {
    if ('enemyId' in ev && !livingEnemyIds.has(ev.enemyId)) continue
    events.push(ev)
  }

  // Phase precedence: game-over (player died) > victory (all enemies
  // dead) > player-acting. Enemies can die DURING the enemy turn from
  // Riposte counter, Thornmail reflect, or their own burn tick at turn
  // start — if that empties the field, we must route to victory here
  // rather than handing the player another (pointless) turn.
  const anyEnemyAlive = nextEnemies.some((e) => e.hp > 0)
  const phase: CombatPhase =
    nextPlayer.hp <= 0 ? 'game-over' : anyEnemyAlive ? 'player-acting' : 'victory'
  // Emit phase-changed for terminal transitions (game-over, victory)
  // directly. The player-acting transition is deferred to the caller
  // (store.ts), which emits it AFTER beginPlayerPhase has run — so that
  // the HUD-side block-zeroing (driven by phase-changed:player-acting)
  // lands after the player's burn-tick events resolve, not before.
  if (phase === 'game-over' || phase === 'victory') {
    events.push({ kind: 'phase-changed', phase })
  }

  return {
    player: nextPlayer,
    enemies: nextEnemies,
    board: nextBoard,
    petrifiedRows: nextPetrifiedRows,
    hexedColors: nextHexedColors,
    rng: nextRng,
    phase,
    events,
    targetEnemyId: nextTargetEnemyId,
  }
}
