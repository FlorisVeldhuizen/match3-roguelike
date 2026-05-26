import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { generateBoard, hasValidSwap } from '../board/generation'
import { resolveSwap, type SwapResolution } from '../board/cascade'
import { forkStreams, type RngStreams } from '../rng/streams'
import { beginPlayerPhase, resolveEndOfPhase } from '../combat/turn'
import { executeEnemyTurn } from '../combat/enemyTurn'
import { applyMatchRedDamage, pickNextTarget } from '../combat/aoe'
import { hasExtraTurnMatch } from '../combat/pools'
import { applyMultiplier } from '../combat/math'
import { getCascadeMultiplier } from '../combat/multipliers'
import { rollReward } from '../relics/reward'
import {
  runOnMatch,
  runOnCascade,
  runOnEnemyKilled,
  runOnBlockGained,
  runOnSpellCast,
  runOnUltimateUsed,
  runOnPhaseStart,
  runOnPhaseEnd,
  snapshotOf,
} from '../relics/engine'
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  MANA_CAPS,
  type Cell,
  type CombatPhase,
  type Enemy,
  type EnemyArchetype,
  type FightState,
  type GameEvent,
  type GemColor,
  type MapState,
  type PendingReward,
  type PetrifiedRows,
  type Player,
  type Pos,
  type RunPhase,
  type SpellId,
  type StatusKind,
  type UltimateId,
} from '../../types'
import { generateMap } from '../map/generate'
import {
  applyStatusToList,
  BURN_FROM_TILE_BONUS,
  getStatusTemplate,
} from '../combat/statuses'
import { getSpell, getUltimate } from '../combat/spellRegistry'
import { canAffordSpell, consumeSpellCost } from '../combat/mana'
import {
  resolveBrittle,
  resolveCinderLash,
  resolveFocus,
  resolveIgnite,
  resolvePurify,
  resolveRegenerate,
} from '../combat/spellResolvers'
import { tickFlagDuration, tickPetrifiedRows } from '../board/flags'
import { makeDebugForceFight } from './actions/debug'
import { makeAcquireRelic, makeSkipReward } from './actions/rewards'
import { makeEnterNode, makeRestart } from './actions/nodes'
import { freshPlayer } from './actions/helpers'

export type BoardState = {
  width: number
  height: number
  cells: Cell[][]
  selected: Pos | null
  // H2b: row index → player phases remaining for Defender's petrify
  // lockout. detectMatches reads this to exclude petrified rows as
  // match anchors. Position-bound (does NOT travel with gems via
  // gravity — the row stays locked regardless of which gems flow
  // through). Empty by default; entries cleared when ticking to 0.
  petrifiedRows: PetrifiedRows
}

export type GameStore = {
  board: BoardState
  rng: RngStreams
  rootSeed: string
  fight: FightState
  // Monotonic counter bumped each time a fresh fight starts (enterNode for
  // fight/elite/boss, restart). UI layers (Pixi BoardScene, HUD displays)
  // watch this for "rebuild from scratch" — wholesale board.cells swaps
  // are otherwise invisible to subscribers that compare references.
  fightCounter: number
  // Rolled when a non-boss fight transitions to 'victory'; nulled by
  // acquireRelic / skipReward. UI mounts RewardScreen on runPhase==='reward'.
  pendingReward: PendingReward | null
  // H1: procedural map + run-level phase machine. runPhase drives the
  // top-level screen (map / fight / reward / victory / game-over) while
  // fight.phase still drives in-fight transitions.
  map: MapState
  runPhase: RunPhase
  selectCell: (pos: Pos | null) => void
  // Manual target override (click-to-target). Only valid during
  // 'player-acting'; no-op on dead/missing enemies. Auto-reselect on kill
  // is handled inline in attemptSwap / resolveEndOfPhase already.
  setTargetEnemy: (id: string) => void
  attemptSwap: (a: Pos, b: Pos) => { valid: boolean; events: GameEvent[] }
  castSpell: (id: SpellId) => { ok: boolean; events: GameEvent[] }
  castUltimate: (id: UltimateId) => { ok: boolean; events: GameEvent[] }
  // H4a picker-arg spells. UI opens a modal on the spell-tray button
  // click and dispatches the action below on confirm.
  castPurify: (statusKind: StatusKind) => {
    ok: boolean
    events: GameEvent[]
  }
  castFocus: (
    from: GemColor,
    to: GemColor,
  ) => { ok: boolean; events: GameEvent[] }
  castVolley: (targets: string[]) => {
    ok: boolean
    events: GameEvent[]
  }
  acquireRelic: (id: string) => { ok: boolean; events: GameEvent[] }
  skipReward: () => void
  // Map navigation. Validates against getReachableFrom; no-op on invalid
  // target. Spins up a fresh fight for fight/elite/boss nodes; auto-
  // completes shop/rest nodes for H1 (Phase I implements them).
  enterNode: (nodeId: string) => void
  restart: () => void
  // Dev-only: rewrites board.cells to a safe (no-match) palette pattern
  // with a planted line-5 prereq, then returns the swap coords that
  // will trigger the match-5 cascade. Caller (DevTools) dispatches the
  // actual swap via the debug bus so animations play normally through
  // BoardScene.performSwap. Bumps fightCounter so the BoardScene
  // rebuilds sprites against the new cells.
  debugForceMatch5: () => { from: Pos; to: Pos } | null
  // Dev-only: force-start a fight against the given archetype, bypassing
  // map navigation. HP + mana carry from the current fight state (same
  // semantics as enterNode), but no map node is marked completed and
  // currentNodeId is left untouched — purely a sandbox.
  debugForceFight: (archetypes: EnemyArchetype | EnemyArchetype[]) => void
}

function initialState(seed: string): {
  board: BoardState
  rng: RngStreams
  rootSeed: string
  fight: FightState
  fightCounter: number
  pendingReward: PendingReward | null
  map: MapState
  runPhase: RunPhase
} {
  const streams = forkStreams(seed)
  // H1: map is rolled at boot; the fight roll is deferred to enterNode so
  // each fight-node entry consumes rng.enemy in node-order. The sentinel
  // board + fight below exist purely to satisfy non-null UI contracts —
  // they are overwritten the moment the player picks a fight node.
  const { board, rng: nextBoardRng } = generateBoard(streams.board)
  const { map, rng: nextMapRng } = generateMap(streams.map)
  const sentinelFight: FightState = {
    phase: 'player-acting',
    player: freshPlayer([]),
    enemies: [],
    targetEnemyId: null,
  }
  return {
    board: {
      width: BOARD_WIDTH,
      height: BOARD_HEIGHT,
      cells: board,
      selected: null,
      petrifiedRows: {},
    },
    rng: { ...streams, board: nextBoardRng, map: nextMapRng },
    rootSeed: seed,
    fight: sentinelFight,
    fightCounter: 0,
    pendingReward: null,
    map,
    runPhase: 'map',
  }
}

function newSliceSeed(): string {
  return `slice-${Math.floor(Math.random() * 1e9).toString(36)}`
}

const SLICE_SEED = newSliceSeed()

export const useGameStore = create<GameStore>()(
  immer((set, get) => ({
    ...initialState(SLICE_SEED),
    selectCell: (pos) =>
      set((s) => {
        s.board.selected = pos
      }),
    setTargetEnemy: (id) =>
      set((s) => {
        if (s.fight.phase !== 'player-acting') return
        const target = s.fight.enemies.find((e) => e.id === id)
        if (!target || target.hp <= 0) return
        s.fight.targetEnemyId = id
      }),
    attemptSwap: (a, b) => {
      const current = get()

      if (
        current.fight.phase === 'victory' ||
        current.fight.phase === 'game-over'
      ) {
        return { valid: false, events: [] }
      }

      let phase: CombatPhase = current.fight.phase
      let player = current.fight.player

      if (phase !== 'player-acting') {
        return { valid: false, events: [] }
      }

      const swap: SwapResolution = resolveSwap(
        current.board.cells,
        current.rng.board,
        a,
        b,
      )

      if (!swap.valid) {
        return { valid: false, events: swap.events }
      }

      let enemies = current.fight.enemies
      let targetEnemyId = current.fight.targetEnemyId
      let enemyRng = current.rng.enemy

      // Walk the swap's cascade stream, inlining the relic engine's
      // onMatch hook per match-found. Each match builds a per-match
      // MatchPayload (single Match + cascade-level-scaled deltas) that
      // relics can modify; the post-hook deltas drive immediate
      // credit (mana/charge), per-match damage/heal commit (red/green),
      // pool accumulation (blue), and the pool-gained events that the
      // animator/SFX layer hangs off.
      const damageHealStream: GameEvent[] = []
      let cascadeLevel = 0
      for (const ev of swap.events) {
        damageHealStream.push(ev)
        // Cascade cleared cells with the `burning` flag → apply Burn to
        // the player. Each cleared burning cell contributes a Burn
        // stack (02-scope §Smolder verb). Re-application accumulates
        // via applyStatusToList — stacks doubles as turns-remaining in
        // the StS model, so adding more makes the burn both heavier
        // and longer.
        if (ev.kind === 'tile-burn-triggered') {
          // Apply Burn to the player. Magnitude = cells.length + content-
          // side BURN_FROM_TILE_BONUS (currently 1). StS triangle math:
          // total damage = stacks*(stacks+1)/2. 1 cell → Burn 2 → 3 dmg
          // total; 4 cells → Burn 5 → 15 dmg. Bonus lives in content so
          // tuning doesn't require touching this cascade walker.
          const incoming = {
            ...getStatusTemplate('burn'),
            stacks: ev.cells.length + BURN_FROM_TILE_BONUS,
          }
          player = {
            ...player,
            statuses: applyStatusToList(player.statuses, incoming),
          }
          damageHealStream.push({
            kind: 'status-applied',
            target: 'player',
            status: incoming,
            source: { kind: 'board-cells', cells: ev.cells },
          })
          continue
        }
        if (ev.kind === 'cascade-start') {
          cascadeLevel = ev.level
          const cascadeEvents = runOnCascade(
            { level: ev.level },
            player.relics,
            snapshotOf(player, enemies, targetEnemyId, cascadeLevel),
          )
          damageHealStream.push(...cascadeEvents)
          continue
        }
        if (ev.kind !== 'match-found') continue

        // H4a Surge: a one-shot armed by casting Surge bumps THIS match's
        // cascade level by +2 (affects relic onMatch hooks AND the raw
        // multiplier). Consumed below after processing finishes.
        const surgeConsumed = player.surgeArmed === true
        const effectiveCascade = surgeConsumed ? cascadeLevel + 2 : cascadeLevel
        // Per-match payload: raw amount = size × cascade × blessed,
        // assigned to the match's color slot. Relics' onMatch hooks
        // mutate these deltas in acquisition order. Blessed flag on the
        // match doubles the multiplier before floor (so `floor(size ×
        // cascade × 2)` — single helper call inherits the rounding rule).
        const cascadeMult = getCascadeMultiplier(effectiveCascade)
        const mult = ev.blessed ? cascadeMult * 2 : cascadeMult
        const raw = applyMultiplier(ev.size, mult)
        const initialDeltas = {
          red: ev.color === 'red' ? raw : 0,
          blue: ev.color === 'blue' ? raw : 0,
          green: ev.color === 'green' ? raw : 0,
          yellow: ev.color === 'yellow' ? raw : 0,
          purple: ev.color === 'purple' ? raw : 0,
        }
        const matchResult = runOnMatch(
          { match: { cells: ev.cells, color: ev.color, size: ev.size, shape: ev.shape }, deltas: initialDeltas, cascadeLevel: effectiveCascade },
          player.relics,
          snapshotOf(player, enemies, targetEnemyId, effectiveCascade),
        )
        damageHealStream.push(...matchResult.events)
        const finalDeltas = matchResult.payload.deltas

        // H3 multi-color mana: each colour delta accumulates BOTH the
        // immediate-effect track (R/B/G into phasePools, P into
        // skillCharge) AND into the colour mana pool (per MANA_CAPS).
        // Yellow goes only into the colour mana pool (wild). Purple
        // still goes only into skillCharge.
        const m = player.mana
        player = {
          ...player,
          skillCharge: player.skillCharge + finalDeltas.purple,
          phasePools: {
            red: player.phasePools.red + finalDeltas.red,
            blue: player.phasePools.blue + finalDeltas.blue,
            green: player.phasePools.green + finalDeltas.green,
          },
          mana: {
            red: Math.min(MANA_CAPS.red, m.red + finalDeltas.red),
            blue: Math.min(MANA_CAPS.blue, m.blue + finalDeltas.blue),
            green: Math.min(MANA_CAPS.green, m.green + finalDeltas.green),
            yellow: Math.min(MANA_CAPS.yellow, m.yellow + finalDeltas.yellow),
          },
        }

        // AOE matches (T, L, line-5) fan red damage out to all living
        // enemies; single line-3/4 stays single-target. Decision is per-
        // match so a cascade can mix narrow + wide hits. Relic onMatch
        // already ran on the pool above, so the same modified red delta
        // gets fanned — relics like Sharp Edge stay "single-source", just
        // spread wider, instead of multiplying with enemy count.
        const isAoe = ev.shape !== 'line' || ev.size === 5

        // Emit pool-gained per non-zero delta in the canonical
        // red/blue/green/yellow/purple order so the animator/SFX layer
        // sees a deterministic sequence (matches the old
        // withPoolGainedEvents shape, just per-color instead of per-match).
        for (const color of ['red', 'blue', 'green', 'yellow', 'purple'] as const) {
          const amount = finalDeltas[color]
          if (amount <= 0) continue
          damageHealStream.push({ kind: 'pool-gained', color, amount })
          if (color === 'red') {
            // H4a: while Volley is pending, red matches stop dealing
            // damage — the red goes only into phasePools.red, to be
            // consumed at EOP by the queued spell. Skip the damage
            // routing entirely; pool accumulation already happened
            // above.
            if (player.pendingSpells.includes('volley')) {
              continue
            }
            // H4a Skewer: doubles the red damage on this match. The
            // pool (mana + phasePools) credited above is NOT doubled —
            // only the damage applied. Consumed below regardless of
            // whether the doubled hit lands HP, so a kill from a
            // doubled chunk still clears the flag.
            const skewerConsumed = player.skewerArmed === true
            const dmgAmount = skewerConsumed ? amount * 2 : amount
            // Per-target damage routing lives in core/combat/aoe.ts so
            // the loop structure + Vulnerable/Weak composition is unit-
            // testable without standing up a full Zustand store. Caller
            // (this block) owns the kill-hook + target re-point work.
            const aoe = applyMatchRedDamage(
              enemies,
              targetEnemyId,
              dmgAmount,
              player.statuses,
              isAoe,
            )
            enemies = aoe.enemies
            damageHealStream.push(...aoe.events)
            for (const killedId of aoe.killedIds) {
              damageHealStream.push({ kind: 'enemy-killed', enemyId: killedId })
              const killEvents = runOnEnemyKilled(
                { enemyId: killedId },
                player.relics,
                snapshotOf(player, enemies, targetEnemyId, cascadeLevel),
              )
              damageHealStream.push(...killEvents)
              if (killedId === targetEnemyId) {
                targetEnemyId = pickNextTarget(enemies, null)
              }
            }
          } else if (color === 'green') {
            const before = player.hp
            const next = Math.min(player.maxHp, player.hp + amount)
            const healed = next - before
            if (healed <= 0) continue
            player = { ...player, hp: next }
            damageHealStream.push({ kind: 'healed', amount: healed })
          }
        }

        // H4a Skewer / Surge: one-shot match modifiers consumed by this
        // match. Clear both the per-player flag AND the corresponding
        // entry in pendingSpells so the PendingStrip drops the pip and
        // the same match can't double-trigger. Emit pending-effect-
        // resolved so subscribers (relics, future battle log) can
        // notice the consumption.
        if (player.skewerArmed === true) {
          player = {
            ...player,
            skewerArmed: false,
            pendingSpells: player.pendingSpells.filter((id) => id !== 'skewer'),
          }
          damageHealStream.push({
            kind: 'pending-effect-resolved',
            spellId: 'skewer',
          })
        }
        if (surgeConsumed) {
          player = {
            ...player,
            surgeArmed: false,
            pendingSpells: player.pendingSpells.filter((id) => id !== 'surge'),
          }
          damageHealStream.push({
            kind: 'pending-effect-resolved',
            spellId: 'surge',
          })
        }
      }

      // Post-cascade playability check. If the settled board has no
      // legal swap (rare with 5 colors on 8×8, but possible), regenerate
      // a fresh playable board and emit a `board-shuffled` event so the
      // animator can sell it. The reshuffle does not consume the turn.
      let finalBoard = swap.board
      let finalBoardRng = swap.rng
      const shuffleEvents: GameEvent[] = []
      if (!hasValidSwap(finalBoard)) {
        const regen = generateBoard(finalBoardRng)
        finalBoard = regen.board
        finalBoardRng = regen.rng
        const cells: { at: Pos; color: import('../../types').GemColor }[] = []
        for (let y = 0; y < finalBoard.length; y++) {
          const row = finalBoard[y]
          if (!row) continue
          for (let x = 0; x < row.length; x++) {
            const cell = row[x]
            if (!cell) continue
            cells.push({ at: { x, y }, color: cell.gemColor })
          }
        }
        shuffleEvents.push({ kind: 'board-shuffled', cells })
      }

      const tailEvents: GameEvent[] = []
      // H2b: petrify-row state is staged here for the enemy-acting
      // branch below; defaults to current state so non-enemy paths
      // (extra-turn cascades, victory) leave petrified rows untouched.
      let tickedPetrifiedRows: PetrifiedRows = current.board.petrifiedRows

      // 4+ matches grant an extra turn — UNLESS the swap also killed the
      // last enemy, in which case we want to fall through to
      // resolveEndOfPhase so the victory transition fires now, not on the
      // next swap.
      const anyEnemyAlive = enemies.some((e) => e.hp > 0)
      const extraTurn = anyEnemyAlive && hasExtraTurnMatch(swap.events)
      if (extraTurn) {
        // Stamp the first 4+ match in the stream so the animator pops the
        // "+1 TURN" callout at the moment of contact instead of waiting for
        // a post-cascade banner.
        for (let i = 0; i < damageHealStream.length; i++) {
          const ev = damageHealStream[i]
          if (ev && ev.kind === 'match-found' && ev.size >= 4) {
            damageHealStream[i] = { ...ev, grantsExtraTurn: true }
            break
          }
        }
        tailEvents.push({ kind: 'extra-turn-granted' })
      }

      if (!extraTurn) {
        const resolved = resolveEndOfPhase(player, enemies, targetEnemyId)
        player = resolved.player
        enemies = resolved.enemies
        targetEnemyId = resolved.targetEnemyId
        phase = resolved.phase
        tailEvents.push(...resolved.events)

        // onPhaseEnd listeners fire after EOP resolution. onBlockGained
        // fires once if the EOP produced a block-gained event (player
        // side; enemy block-gained is wired in enemyTurn).
        const phaseEndEvents = runOnPhaseEnd(
          { phaseKind: 'player' },
          player.relics,
          snapshotOf(player, enemies, targetEnemyId, 0),
        )
        tailEvents.push(...phaseEndEvents)
        const playerBlockGained = resolved.events.find(
          (e) => e.kind === 'block-gained',
        )
        if (playerBlockGained && playerBlockGained.kind === 'block-gained') {
          const blockEvents = runOnBlockGained(
            { amount: playerBlockGained.amount, target: 'player' },
            player.relics,
            snapshotOf(player, enemies, targetEnemyId, 0),
          )
          tailEvents.push(...blockEvents)
        }

        // If enemies still alive, tick board-flag durations (Phase F:
        // burning cells lose one charge per player phase that ends
        // without them being matched), then the enemy turn fires. Then
        // begin next player phase so block zeroes and pools reset
        // before the player swaps again.
        if (phase === 'enemy-acting') {
          const tickResult = tickFlagDuration(finalBoard, 'burning')
          finalBoard = tickResult.board
          tailEvents.push(...tickResult.events)
          // H2b: tick column-smash countdown (gem-bound, on Cell.flags)
          // and petrify-row countdown (position-bound, on BoardState).
          // Both tick per phase, mirroring burning's cadence.
          const smashTick = tickFlagDuration(finalBoard, 'pendingSmash')
          finalBoard = smashTick.board
          tailEvents.push(...smashTick.events)
          const petrifyTick = tickPetrifiedRows(current.board.petrifiedRows)
          // petrifiedRows update is staged into `s.board.petrifiedRows` in
          // the `set` block below — accumulate locally for now.
          tickedPetrifiedRows = petrifyTick.petrifiedRows

          const enemyResult = executeEnemyTurn(
            player,
            enemies,
            finalBoard,
            enemyRng,
            tickedPetrifiedRows,
          )
          player = enemyResult.player
          enemies = enemyResult.enemies
          finalBoard = enemyResult.board
          tickedPetrifiedRows = enemyResult.petrifiedRows
          enemyRng = enemyResult.rng
          phase = enemyResult.phase
          tailEvents.push(...enemyResult.events)

          // Target may have died during the enemy turn (Thornmail reflect,
          // Burn tick at turn start, Riposte counter). pickNextTarget
          // re-points to the leftmost living enemy when the current
          // target is dead/missing, no-op otherwise.
          targetEnemyId = pickNextTarget(enemies, targetEnemyId)

          if (phase === 'player-acting') {
            const begin = beginPlayerPhase(player, enemies, targetEnemyId)
            player = begin.player
            phase = begin.phase
            tailEvents.push(...begin.events)
            // Run onPhaseStart listeners for the new player phase.
            if (phase === 'player-acting') {
              const startEvents = runOnPhaseStart(
                { phaseKind: 'player' },
                player.relics,
                snapshotOf(player, enemies, targetEnemyId, 0),
              )
              tailEvents.push(...startEvents)
            }
            // Emit phase-changed AFTER begin.events so the HUD's
            // block-zero (and other phase-gated UI like the banner)
            // lands once the burn tick and status decrements have
            // resolved. Phase here may be 'player-acting' (normal) or
            // 'game-over' (burn killed at phase start).
            tailEvents.push({ kind: 'phase-changed', phase })
          }
        }
      }

      // On victory transition, roll the post-fight reward set
      // deterministically from rng.loot. Boss kills skip the reward roll
      // — the run-victory screen is the celebration there.
      let nextLootRng = current.rng.loot
      let pendingReward = current.pendingReward
      let nextRunPhase: RunPhase = current.runPhase
      const completedNodeIds = current.map.completedNodeIds.slice()
      const isBossFight = current.fight.isBoss === true
      if (phase === 'victory') {
        // Append the current map node to completedNodeIds once.
        const cur = current.map.currentNodeId
        if (cur != null && !completedNodeIds.includes(cur)) {
          completedNodeIds.push(cur)
        }
        if (isBossFight) {
          // Boss kill heals to full so the next map (future multi-act runs)
          // starts topped up. Today the run-victory screen follows, so the
          // heal is only observable if we ever continue past the boss.
          player = { ...player, hp: player.maxHp }
          nextRunPhase = 'victory'
        } else if (pendingReward == null) {
          const rolled = rollReward(player.relics, 'common', nextLootRng, 0)
          pendingReward = rolled.reward
          nextLootRng = rolled.rng
          tailEvents.push({
            kind: 'reward-offered',
            offeredRelicIds: rolled.reward.offeredRelicIds,
            gold: rolled.reward.gold,
          })
          nextRunPhase = 'reward'
        }
      } else if (phase === 'game-over') {
        nextRunPhase = 'game-over'
      }

      set((s) => {
        s.board.cells = finalBoard
        s.board.petrifiedRows = tickedPetrifiedRows
        s.rng.board = finalBoardRng
        s.rng.enemy = enemyRng
        s.rng.loot = nextLootRng
        s.board.selected = null
        s.fight.phase = phase
        s.fight.player = player
        s.fight.enemies = enemies
        s.fight.targetEnemyId = targetEnemyId
        s.pendingReward = pendingReward
        s.runPhase = nextRunPhase
        s.map.completedNodeIds = completedNodeIds
      })

      return {
        valid: true,
        events: [...damageHealStream, ...shuffleEvents, ...tailEvents],
      }
    },
    // Free-action spell cast. Cost paid on cast; effect resolves at EOP
    // (Bulwark/Reinforce/Volley), on the next enemy attack (Riposte),
    // on the next match (Skewer/Surge), or immediately (Ignite/
    // Regenerate/Brittle/Cinder Lash). 01-design rules: cast window =
    // player phase + board settled + can pay cost. "Board settled"
    // belongs in UI (button disabled while AC drains) — engine just
    // gates on phase and cost.
    //
    // H4a redesign: picker-arg spells (Purify, Focus, Volley) have their
    // own store actions. castSpell covers no-arg cases: Bulwark,
    // Reinforce, Ignite, Regenerate, Brittle, Skewer, Surge, Cinder Lash.
    castSpell: (id: SpellId) => {
      const current = get()
      if (current.fight.phase !== 'player-acting') {
        return { ok: false, events: [] }
      }
      if (current.fight.player.pendingSpells.includes(id)) {
        return { ok: false, events: [] }
      }
      // Spells that need picker args refuse the no-arg path.
      if (id === 'purify' || id === 'focus' || id === 'volley') {
        return { ok: false, events: [] }
      }
      const def = getSpell(id)
      if (!canAffordSpell(current.fight.player.mana, def.cost)) {
        return { ok: false, events: [] }
      }
      // Target-required spells reject without a living enemy in focus.
      const needsTarget =
        id === 'ignite' || id === 'brittle' || id === 'cinder-lash'
      const targetId = current.fight.targetEnemyId
      if (needsTarget) {
        const t = targetId
          ? current.fight.enemies.find((e) => e.id === targetId && e.hp > 0)
          : undefined
        if (!t) return { ok: false, events: [] }
      }
      const event: GameEvent = { kind: 'spell-cast', spellId: id }
      const writeRelics = current.fight.player.relics.map((r) => ({
        ...r,
        runFlags: { ...r.runFlags },
        fightFlags: { ...r.fightFlags },
      }))
      const hookEvents = runOnSpellCast(
        { spellId: id },
        writeRelics,
        snapshotOf(
          current.fight.player,
          current.fight.enemies,
          current.fight.targetEnemyId,
          0,
        ),
      )
      const nextMana = consumeSpellCost(current.fight.player.mana, def.cost)
      const playerWithCost: Player = {
        ...current.fight.player,
        mana: nextMana,
        relics: writeRelics,
      }
      if (def.resolution === 'immediate') {
        let nextPlayer: Player = playerWithCost
        let nextEnemies: Enemy[] = [...current.fight.enemies]
        const effectEvents: GameEvent[] = []
        if (id === 'ignite' && targetId) {
          const r = resolveIgnite(nextEnemies, targetId)
          nextEnemies = r.enemies
          effectEvents.push(...r.events)
        } else if (id === 'regenerate') {
          const r = resolveRegenerate(nextPlayer)
          nextPlayer = r.player
          effectEvents.push(...r.events)
        } else if (id === 'brittle' && targetId) {
          const r = resolveBrittle(nextEnemies, targetId)
          nextEnemies = r.enemies
          effectEvents.push(...r.events)
        } else if (id === 'cinder-lash' && targetId) {
          const r = resolveCinderLash(nextPlayer, nextEnemies, targetId)
          nextPlayer = r.player
          nextEnemies = r.enemies
          effectEvents.push(...r.events)
        }
        set((s) => {
          s.fight.player = nextPlayer
          s.fight.enemies = nextEnemies
        })
        return { ok: true, events: [event, ...hookEvents, ...effectEvents] }
      }
      // Pending-resolution spells (Bulwark/Reinforce/Skewer/Surge).
      // Skewer + Surge ALSO arm a one-shot flag consumed by the next
      // match (see cascade walker), in addition to entering pendingSpells
      // so the PendingStrip can show them.
      set((s) => {
        s.fight.player.mana = nextMana
        s.fight.player.pendingSpells.push(id)
        s.fight.player.relics = writeRelics
        if (id === 'skewer') {
          s.fight.player.skewerArmed = true
        } else if (id === 'surge') {
          s.fight.player.surgeArmed = true
        }
      })
      return { ok: true, events: [event, ...hookEvents] }
    },
    // H4a Purify: immediate. Args: which player status to remove. Strips
    // the chosen status ENTIRELY (all stacks). If it was Burn, also
    // heals PURIFY_BURN_HEAL. Picker UI offers only present statuses;
    // this action no-ops if the named status is absent, on top of the
    // standard affordability + phase gate.
    castPurify: (statusKind: StatusKind) => {
      const current = get()
      if (current.fight.phase !== 'player-acting') {
        return { ok: false, events: [] }
      }
      const def = getSpell('purify')
      if (!canAffordSpell(current.fight.player.mana, def.cost)) {
        return { ok: false, events: [] }
      }
      if (!current.fight.player.statuses.some((s) => s.kind === statusKind)) {
        return { ok: false, events: [] }
      }
      const event: GameEvent = { kind: 'spell-cast', spellId: 'purify' }
      const writeRelics = current.fight.player.relics.map((r) => ({
        ...r,
        runFlags: { ...r.runFlags },
        fightFlags: { ...r.fightFlags },
      }))
      const hookEvents = runOnSpellCast(
        { spellId: 'purify' },
        writeRelics,
        snapshotOf(
          current.fight.player,
          current.fight.enemies,
          current.fight.targetEnemyId,
          0,
        ),
      )
      const nextMana = consumeSpellCost(current.fight.player.mana, def.cost)
      const r = resolvePurify(
        { ...current.fight.player, mana: nextMana, relics: writeRelics },
        statusKind,
      )
      set((s) => {
        s.fight.player = r.player
      })
      return { ok: true, events: [event, ...hookEvents, ...r.events] }
    },
    // H4a Focus: immediate. Args: source colour (mana taken from) and
    // target colour (mana added to). Picker UI is responsible for offering
    // only non-empty sources and non-capped targets; this action no-ops
    // (refunds nothing) on degenerate args.
    castFocus: (from: GemColor, to: GemColor) => {
      const current = get()
      if (current.fight.phase !== 'player-acting') {
        return { ok: false, events: [] }
      }
      const def = getSpell('focus')
      if (!canAffordSpell(current.fight.player.mana, def.cost)) {
        return { ok: false, events: [] }
      }
      if (from === to) {
        return { ok: false, events: [] }
      }
      if (from === 'purple' || to === 'purple') {
        return { ok: false, events: [] }
      }
      const event: GameEvent = { kind: 'spell-cast', spellId: 'focus' }
      const writeRelics = current.fight.player.relics.map((r) => ({
        ...r,
        runFlags: { ...r.runFlags },
        fightFlags: { ...r.fightFlags },
      }))
      const hookEvents = runOnSpellCast(
        { spellId: 'focus' },
        writeRelics,
        snapshotOf(
          current.fight.player,
          current.fight.enemies,
          current.fight.targetEnemyId,
          0,
        ),
      )
      const nextMana = consumeSpellCost(current.fight.player.mana, def.cost)
      const r = resolveFocus(
        { ...current.fight.player, mana: nextMana, relics: writeRelics },
        from,
        to,
      )
      set((s) => {
        s.fight.player = r.player
      })
      return { ok: true, events: [event, ...hookEvents, ...r.events] }
    },
    // H4a Volley: pending. Args: array of 3 enemy ids (the chosen targets,
    // one per hit). The sole red-pool consumer. Stored in
    // player.volleyTargets for EOP to read; cleared with the pending
    // entry at EOP.
    castVolley: (targets: string[]) => {
      const current = get()
      if (current.fight.phase !== 'player-acting') {
        return { ok: false, events: [] }
      }
      if (current.fight.player.pendingSpells.includes('volley')) {
        return { ok: false, events: [] }
      }
      const def = getSpell('volley')
      if (!canAffordSpell(current.fight.player.mana, def.cost)) {
        return { ok: false, events: [] }
      }
      if (targets.length !== 3) {
        return { ok: false, events: [] }
      }
      // Each target must be a living enemy in this fight.
      const living = new Set(
        current.fight.enemies.filter((e) => e.hp > 0).map((e) => e.id),
      )
      if (!targets.every((id) => living.has(id))) {
        return { ok: false, events: [] }
      }
      const event: GameEvent = { kind: 'spell-cast', spellId: 'volley' }
      const writeRelics = current.fight.player.relics.map((r) => ({
        ...r,
        runFlags: { ...r.runFlags },
        fightFlags: { ...r.fightFlags },
      }))
      const hookEvents = runOnSpellCast(
        { spellId: 'volley' },
        writeRelics,
        snapshotOf(
          current.fight.player,
          current.fight.enemies,
          current.fight.targetEnemyId,
          0,
        ),
      )
      const nextMana = consumeSpellCost(current.fight.player.mana, def.cost)
      set((s) => {
        s.fight.player.mana = nextMana
        s.fight.player.pendingSpells.push('volley')
        s.fight.player.relics = writeRelics
        s.fight.player.volleyTargets = [...targets]
        // Reset accumulated phasePools.red on cast so pre-cast red
        // (already dealt as damage) doesn't double-dip into the EOP
        // volley split.
        s.fight.player.phasePools.red = 0
      })
      return { ok: true, events: [event, ...hookEvents] }
    },
    castUltimate: (id: UltimateId) => {
      const current = get()
      if (current.fight.phase !== 'player-acting') {
        return { ok: false, events: [] }
      }
      if (current.fight.player.pendingSpells.includes(id)) {
        return { ok: false, events: [] }
      }
      const def = getUltimate(id)
      if (current.fight.player.skillCharge < def.chargeCost) {
        return { ok: false, events: [] }
      }
      const event: GameEvent = { kind: 'spell-cast', spellId: id }
      const writeRelics = current.fight.player.relics.map((r) => ({
        ...r,
        runFlags: { ...r.runFlags },
        fightFlags: { ...r.fightFlags },
      }))
      const hookEvents = runOnUltimateUsed(
        { spellId: id },
        writeRelics,
        snapshotOf(
          current.fight.player,
          current.fight.enemies,
          current.fight.targetEnemyId,
          0,
        ),
      )
      set((s) => {
        s.fight.player.skillCharge -= def.chargeCost
        s.fight.player.pendingSpells.push(id)
        s.fight.player.relics = writeRelics
      })
      return { ok: true, events: [event, ...hookEvents] }
    },
    acquireRelic: makeAcquireRelic(set, get),
    skipReward: makeSkipReward(set, get),
    enterNode: makeEnterNode(set, get),
    restart: makeRestart(set, get, () => initialState(newSliceSeed())),
    debugForceMatch5: () => {
      // Hard guard: only valid while the player can swap. Avoids running
      // during a cascade or enemy turn (which would clash with the AC
      // queue) or at game-over / victory (where attemptSwap returns
      // invalid anyway).
      const cur = get()
      if (cur.fight.phase !== 'player-acting') return null

      // Safe 3-color rotation: palette[(x + y) % 3] produces no 3-runs
      // anywhere. Same trick as cascade.test.ts's buildSafeBoard. We
      // then overlay the line-5 prereq: 4 blues at row 3 cols 1, 2, 4,
      // 5 (split so the row has no pre-existing match), with a blue at
      // (3, 4) that will swap up into (3, 3) to complete the line. (3,
      // 3) is left at the palette default (red per (3+3)%3) so the
      // pre-swap board is match-free.
      const palette: ('red' | 'green' | 'yellow')[] = ['red', 'green', 'yellow']
      set((s) => {
        const cells = s.board.cells
        for (let y = 0; y < cells.length; y++) {
          const row = cells[y]
          if (!row) continue
          for (let x = 0; x < row.length; x++) {
            row[x] = { gemColor: palette[(x + y) % 3] ?? 'red' }
          }
        }
        const row3 = cells[3]
        const row4 = cells[4]
        if (!row3 || !row4) return
        for (const x of [1, 2, 4, 5]) {
          row3[x] = { gemColor: 'blue' }
        }
        row4[3] = { gemColor: 'blue' }
        s.board.selected = null
        // Bump fightCounter so subscribers (BoardScene sprite grid,
        // BurningOverlay, BlessedOverlay) rebuild against the new cells.
        s.fightCounter += 1
      })
      return { from: { x: 3, y: 4 }, to: { x: 3, y: 3 } }
    },
    debugForceFight: makeDebugForceFight(set, get),
  })),
)
