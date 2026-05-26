import type { RngState } from '../rng/mulberry32'
import type {
  Cell,
  CombatPhase,
  Enemy,
  GameEvent,
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
  resolveColumnSmashIntent,
  resolveHealAllyIntent,
  resolvePetrifyRowIntent,
  resolveShieldAllyIntent,
  resolveTileBurnIntent,
} from './intentResolvers'

export type EnemyTurnResult = {
  player: Player
  enemies: Enemy[]
  board: Cell[][]
  petrifiedRows: PetrifiedRows
  rng: RngState
  phase: CombatPhase
  events: GameEvent[]
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
): EnemyTurnResult {
  const events: GameEvent[] = []
  let nextPlayer: Player = player
  let nextEnemies: Enemy[] = enemies
  let nextBoard: Cell[][] = board
  let nextPetrifiedRows: PetrifiedRows = petrifiedRows
  let nextRng = rng

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
      )
      nextRng = rolled.rng
      let updatedBlock = updatedEnemy.block
      if (rolled.intent.kind === 'block') {
        updatedBlock = updatedBlock + rolled.intent.amount
        events.push({
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
      events.push({
        kind: 'intent-telegraphed',
        enemyId: updatedEnemy.id,
        intent: rolled.intent,
      })
      // H2b: if the rolled next intent is a board verb, apply its
      // telegraph flag immediately so the player can see (and counter)
      // the threat during their next phase. column-smash flags cells
      // in the column; petrify-row writes to BoardState.petrifiedRows.
      const tele = applyIntentTelegraph(
        nextBoard,
        nextPetrifiedRows,
        rolled.intent,
        updatedEnemy.id,
        updatedEnemy.archetype,
      )
      nextBoard = tele.board
      nextPetrifiedRows = tele.petrifiedRows
      events.push(...tele.events)
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
    rng: nextRng,
    phase,
    events,
  }
}
