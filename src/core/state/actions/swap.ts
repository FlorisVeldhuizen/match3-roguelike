import { generateBoard, hasValidSwap } from '../../board/generation'
import { resolveSwap, type SwapResolution } from '../../board/cascade'
import { beginPlayerPhase, resolveEndOfPhase } from '../../combat/turn'
import { executeEnemyTurn } from '../../combat/enemyTurn'
import { applyMatchRedDamage, pickNextTarget } from '../../combat/aoe'
import { hasExtraTurnMatch } from '../../combat/pools'
import { applyMultiplier } from '../../combat/math'
import { getCascadeMultiplier } from '../../combat/multipliers'
import { rollReward } from '../../relics/reward'
import {
  runOnMatch,
  runOnCascade,
  runOnEnemyKilled,
  runOnBlockGained,
  runOnPhaseStart,
  runOnPhaseEnd,
  snapshotOf,
} from '../../relics/engine'
import {
  MANA_CAPS,
  type CombatPhase,
  type GameEvent,
  type GemColor,
  type PendingReward,
  type PetrifiedRows,
  type Pos,
  type RunPhase,
} from '../../../types'
import {
  applyStatusToList,
  BURN_FROM_TILE_BONUS,
  getStatusTemplate,
} from '../../combat/statuses'
import { tickFlagDuration, tickPetrifiedRows } from '../../board/flags'
import type { StoreSet, StoreGet } from './types'

export function makeSelectCell(set: StoreSet, _get: StoreGet) {
  return (pos: Pos | null): void =>
    set((s) => {
      s.board.selected = pos
    })
}

export function makeSetTargetEnemy(set: StoreSet, _get: StoreGet) {
  return (id: string): void =>
    set((s) => {
      if (s.fight.phase !== 'player-acting') return
      const target = s.fight.enemies.find((e) => e.id === id)
      if (!target || target.hp <= 0) return
      s.fight.targetEnemyId = id
    })
}

export function makeAttemptSwap(set: StoreSet, get: StoreGet) {
  return (a: Pos, b: Pos): { valid: boolean; events: GameEvent[] } => {
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
      current.board.petrifiedRows,
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
    if (!hasValidSwap(finalBoard, current.board.petrifiedRows)) {
      const regen = generateBoard(finalBoardRng)
      finalBoard = regen.board
      finalBoardRng = regen.rng
      const cells: { at: Pos; color: GemColor }[] = []
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
        // H2b: petrify-row is duration-based (position-bound on
        // BoardState) and ticks per phase like burning. pendingSmash
        // is NOT ticked — it's a trigger-based marker consumed at fire
        // time (or swept as an orphan inside executeEnemyTurn when its
        // source enemy isn't around to fire it).
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
    let pendingReward: PendingReward | null = current.pendingReward
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
  }
}
