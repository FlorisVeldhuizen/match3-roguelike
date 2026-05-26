import { generateBoard, hasValidSwap } from '../../board/generation'
import { resolveSwap, type SwapResolution } from '../../board/cascade'
import { beginPlayerPhase, resolveEndOfPhase } from '../../combat/turn'
import { executeEnemyTurn } from '../../combat/enemyTurn'
import { pickNextTarget } from '../../combat/aoe'
import { hasExtraTurnMatch } from '../../combat/pools'
import { processCascadeEvents } from '../../combat/cascadeProcessor'
import { rollPostFightReward } from '../../relics/reward'
import { rollGoldDrop } from '../../map/goldDrop'
import {
  runOnBlockGained,
  runOnPhaseStart,
  runOnPhaseEnd,
  snapshotOf,
} from '../../relics/engine'
import {
  type CombatPhase,
  type GameEvent,
  type GemColor,
  type HexedColor,
  type PendingReward,
  type PetrifiedRows,
  type Pos,
  type RunPhase,
} from '../../../types'
import {
  tickFlagDuration,
  tickHexedColors,
  tickPetrifiedRows,
} from '../../board/flags'
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

    let enemyRng = current.rng.enemy

    // Walk the swap's cascade stream through the shared match-event
    // processor: relic onMatch / onCascade / onEnemyKilled hooks, per-
    // colour pool deltas, red damage routing (with Skewer/Volley
    // interactions), green heal commit, kill chain + target re-point.
    // Same machinery is now reused by castShatter so shatter fires
    // the same hooks a regular match would.
    const processed = processCascadeEvents(
      swap.events,
      player,
      current.fight.enemies,
      current.fight.targetEnemyId,
      current.fight.hexedColors ?? [],
    )
    player = processed.player
    let enemies = processed.enemies
    let targetEnemyId = processed.targetEnemyId
    const damageHealStream: GameEvent[] = [...processed.events]

    // Post-cascade playability check. If the settled board has no
    // legal swap (rare with 5 colors on 8×8, but possible), regenerate
    // a fresh playable board and emit a `board-shuffled` event so the
    // animator can sell it. The reshuffle does not consume the turn.
    let finalBoard = swap.board
    let finalBoardRng = swap.rng
    const shuffleEvents: GameEvent[] = []
    if (!hasValidSwap(finalBoard, current.board.petrifiedRows)) {
      // Thread petrifiedRows in so the regenerated board has a valid
      // swap OUTSIDE the locked row(s). Otherwise the regen could
      // hand back another no-valid-moves state under an active
      // petrify lockout.
      const regen = generateBoard(
        finalBoardRng,
        undefined,
        undefined,
        current.board.petrifiedRows,
      )
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
    // H2c: same staging pattern for Caster's hexedColors set.
    let tickedHexedColors: HexedColor[] = current.fight.hexedColors ?? []

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
        // BoardState) and ticks per phase like burning.
        const petrifyTick = tickPetrifiedRows(current.board.petrifiedRows)
        // petrifiedRows update is staged into `s.board.petrifiedRows` in
        // the `set` block below — accumulate locally for now. The
        // per-row tick events drive the PetrifyOverlay's weakening →
        // expired transitions on the animator's timeline.
        tickedPetrifiedRows = petrifyTick.petrifiedRows
        tailEvents.push(...petrifyTick.events)
        // H2c: hexedColors tick on the same phase boundary — once per
        // enemy phase, regardless of how many casters are alive. Decrement
        // happens BEFORE executeEnemyTurn so any new hex placed by a
        // Caster this turn keeps its full specced duration.
        const hexTick = tickHexedColors(current.fight.hexedColors ?? [])
        tickedHexedColors = hexTick.hexedColors
        tailEvents.push(...hexTick.events)

        const enemyResult = executeEnemyTurn(
          player,
          enemies,
          finalBoard,
          enemyRng,
          tickedPetrifiedRows,
          tickedHexedColors,
          targetEnemyId,
        )
        player = enemyResult.player
        enemies = enemyResult.enemies
        finalBoard = enemyResult.board
        tickedPetrifiedRows = enemyResult.petrifiedRows
        tickedHexedColors = enemyResult.hexedColors
        enemyRng = enemyResult.rng
        phase = enemyResult.phase
        targetEnemyId = enemyResult.targetEnemyId
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
        // Phase I: gold drop is rolled from the cleared map node's tier
        // BEFORE the relic offer so both consume rng.loot in a stable
        // order (gold first, then relic pool draws). Falls back to 0g if
        // the current node can't be located (boot sentinel / save-load
        // edge cases).
        const clearedNode = current.map.nodes.find(
          (n) => n.id === current.map.currentNodeId,
        )
        let goldDrop = 0
        if (clearedNode) {
          const goldRoll = rollGoldDrop(clearedNode, nextLootRng)
          goldDrop = goldRoll.gold
          nextLootRng = goldRoll.rng
        }
        // Phase I: elite nodes drop an uncommon-rarity offer (ladder
        // promotes to rare if uncommon pool is exhausted, per rollReward).
        // Boss skips the reward roll entirely (handled above).
        const rarity = current.fight.isElite === true ? 'uncommon' : 'common'
        const rolled = rollPostFightReward({
          ownedRelics: player.relics,
          ownedSpellIds: player.ownedSpellIds,
          rarity,
          rng: nextLootRng,
          gold: goldDrop,
        })
        pendingReward = rolled.reward
        nextLootRng = rolled.rng
        tailEvents.push({
          kind: 'reward-offered',
          offerKind: rolled.reward.kind,
          offeredRelicIds:
            rolled.reward.kind === 'relic' ? rolled.reward.offeredRelicIds : [],
          offeredSpellIds:
            rolled.reward.kind === 'spell' ? rolled.reward.offeredSpellIds : [],
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
      s.fight.hexedColors = tickedHexedColors
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
