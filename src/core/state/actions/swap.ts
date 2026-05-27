import { generateBoard, hasValidSwap } from '../../board/generation'
import { resolveSwap, type SwapResolution } from '../../board/cascade'
import { beginPlayerPhase, resolveEndOfPhase } from '../../combat/turn'
import { applyCombatEvents } from '../../combat/applyCombatEvents'
import { executeEnemyTurn } from '../../combat/enemyTurn'
import { pickNextTarget } from '../../combat/aoe'
import { hasExtraTurnMatch } from '../../combat/pools'
import { processCascadeEvents } from '../../combat/cascadeProcessor'
import { rollPostFightReward } from '../../relics/reward'
import { rollGoldDrop } from '../../map/goldDrop'
import {
  runOnBlockBroken,
  runOnBlockGained,
  runOnPhaseStart,
  runOnPhaseEnd,
  snapshotOf,
} from '../../relics/engine'
import {
  type CombatPhase,
  type DrainedColor,
  type GameEvent,
  type GemColor,
  type HexedColor,
  type PendingReward,
  type PetrifiedRows,
  type Pos,
  type RunPhase,
} from '../../../types'
import {
  tickDrainedColors,
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

    const processed = processCascadeEvents(
      swap.events,
      player,
      current.fight.enemies,
      current.fight.targetEnemyId,
      current.fight.hexedColors ?? [],
      current.fight.drainedColors ?? [],
    )
    player = processed.player
    let enemies = processed.enemies
    let targetEnemyId = processed.targetEnemyId
    const damageHealStream: GameEvent[] = [...processed.events]

    let finalBoard = swap.board
    let finalBoardRng = swap.rng
    const shuffleEvents: GameEvent[] = []
    if (!hasValidSwap(finalBoard, current.board.petrifiedRows)) {
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
    let tickedPetrifiedRows: PetrifiedRows = current.board.petrifiedRows
    let tickedHexedColors: HexedColor[] = current.fight.hexedColors ?? []
    let tickedDrainedColors: DrainedColor[] = current.fight.drainedColors ?? []

    const anyEnemyAlive = enemies.some((e) => e.hp > 0)
    const extraTurn = anyEnemyAlive && hasExtraTurnMatch(swap.events)
    if (extraTurn) {
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

      const phaseEndEvents = runOnPhaseEnd(
        { phaseKind: 'player' },
        player.relics,
        snapshotOf(player, enemies, targetEnemyId, 0),
      )
      tailEvents.push(...phaseEndEvents)
      const phaseEndApplied = applyCombatEvents(
        phaseEndEvents,
        player,
        enemies,
        targetEnemyId,
      )
      player = phaseEndApplied.player
      enemies = phaseEndApplied.enemies
      targetEnemyId = phaseEndApplied.targetEnemyId
      tailEvents.push(...phaseEndApplied.derived)

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
        const blockApplied = applyCombatEvents(
          blockEvents,
          player,
          enemies,
          targetEnemyId,
        )
        player = blockApplied.player
        enemies = blockApplied.enemies
        targetEnemyId = blockApplied.targetEnemyId
        tailEvents.push(...blockApplied.derived)
      }

      if (phase === 'enemy-acting') {
        const tickResult = tickFlagDuration(finalBoard, 'burning')
        finalBoard = tickResult.board
        tailEvents.push(...tickResult.events)
        const petrifyTick = tickPetrifiedRows(current.board.petrifiedRows)
        tickedPetrifiedRows = petrifyTick.petrifiedRows
        tailEvents.push(...petrifyTick.events)
        // Hex ticks BEFORE executeEnemyTurn so new hex keeps full duration
        const hexTick = tickHexedColors(current.fight.hexedColors ?? [])
        tickedHexedColors = hexTick.hexedColors
        tailEvents.push(...hexTick.events)

        // Drain ticks: same pattern as hex ticks
        const drainTick = tickDrainedColors(current.fight.drainedColors ?? [])
        let tickedDrainedColors = drainTick.drainedColors
        tailEvents.push(...drainTick.events)

        const enemyResult = executeEnemyTurn(
          player,
          enemies,
          finalBoard,
          enemyRng,
          tickedPetrifiedRows,
          tickedHexedColors,
          targetEnemyId,
          tickedDrainedColors,
        )
        player = enemyResult.player
        enemies = enemyResult.enemies
        finalBoard = enemyResult.board
        tickedPetrifiedRows = enemyResult.petrifiedRows
        tickedHexedColors = enemyResult.hexedColors
        tickedDrainedColors = enemyResult.drainedColors
        enemyRng = enemyResult.rng
        phase = enemyResult.phase
        targetEnemyId = enemyResult.targetEnemyId
        tailEvents.push(...enemyResult.events)

        targetEnemyId = pickNextTarget(enemies, targetEnemyId)

        if (phase === 'player-acting') {
          const begin = beginPlayerPhase(player, enemies, targetEnemyId)
          player = begin.player
          phase = begin.phase
          tailEvents.push(...begin.events)
          if (phase === 'player-acting') {
            const startEvents = runOnPhaseStart(
              { phaseKind: 'player' },
              player.relics,
              snapshotOf(player, enemies, targetEnemyId, 0),
            )
            tailEvents.push(...startEvents)
            const startApplied = applyCombatEvents(
              startEvents,
              player,
              enemies,
              targetEnemyId,
            )
            player = startApplied.player
            enemies = startApplied.enemies
            targetEnemyId = startApplied.targetEnemyId
            tailEvents.push(...startApplied.derived)
          }
          tailEvents.push({ kind: 'phase-changed', phase })
        }
      }
    }

    let nextLootRng = current.rng.loot
    let pendingReward: PendingReward | null = current.pendingReward
    let nextRunPhase: RunPhase = current.runPhase
    const completedNodeIds = current.map.completedNodeIds.slice()
    const isBossFight = current.fight.isBoss === true
    if (phase === 'victory') {
      const cur = current.map.currentNodeId
      if (cur != null && !completedNodeIds.includes(cur)) {
        completedNodeIds.push(cur)
      }
      if (isBossFight) {
        player = { ...player, hp: player.maxHp }
        nextRunPhase = 'victory'
      } else if (pendingReward == null) {
        const clearedNode = current.map.nodes.find(
          (n) => n.id === current.map.currentNodeId,
        )
        let goldDrop = 0
        if (clearedNode) {
          const goldRoll = rollGoldDrop(clearedNode, nextLootRng)
          goldDrop = goldRoll.gold
          nextLootRng = goldRoll.rng
        }
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
      s.fight.drainedColors = tickedDrainedColors
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
