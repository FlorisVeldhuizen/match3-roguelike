import { generateBoard } from '../../board/generation'
import { getReachableFrom } from '../../map/paths'
import { applyCombatEvents } from '../../combat/applyCombatEvents'
import { cloneRelicsForHooks, runOnRoundStarted, snapshotOf } from '../../relics/engine'
import type { RngStreams } from '../../rng/streams'
import type { FightState, MapState, PendingReward, RunPhase } from '../../../types'
import type { BoardState } from '../store'
import type { StoreSet, StoreGet } from './types'
import { freshBoardState, freshFight } from './helpers'

export const REST_HEAL_PERCENT = 0.3

export type InitialStateResult = {
  board: BoardState
  rng: RngStreams
  rootSeed: string
  fight: FightState
  fightCounter: number
  pendingReward: PendingReward | null
  map: MapState
  runPhase: RunPhase
}

export function makeEnterNode(set: StoreSet, get: StoreGet) {
  return (nodeId: string): void => {
    const current = get()
    if (current.runPhase !== 'map') return
    const reachable = getReachableFrom(current.map)
    if (!reachable.has(nodeId)) return
    const node = current.map.nodes.find((n) => n.id === nodeId)
    if (!node) return

    if (node.kind === 'shop') {
      set((s) => {
        s.map.currentNodeId = nodeId
        s.runPhase = 'shop'
      })
      return
    }
    if (node.kind === 'rest') {
      set((s) => {
        s.map.currentNodeId = nodeId
        s.runPhase = 'rest'
      })
      return
    }

    const enemyRoll = freshFight(current.rng.enemy, current.fight.player.relics, {
      archetypes: node.archetypes,
      isBoss: node.kind === 'boss',
      isElite: node.kind === 'elite',
    })
    enemyRoll.fight.player.hp = Math.min(enemyRoll.fight.player.maxHp, current.fight.player.hp)
    enemyRoll.fight.player.gold = current.fight.player.gold
    enemyRoll.fight.player.ownedSpellIds = current.fight.player.ownedSpellIds
    const boardRoll = generateBoard(current.rng.board)
    const writeRelics = cloneRelicsForHooks(enemyRoll.fight.player.relics)
    const roundEvents = runOnRoundStarted(
      { fightId: 0 },
      writeRelics,
      snapshotOf(enemyRoll.fight.player, enemyRoll.fight.enemies, enemyRoll.fight.targetEnemyId, 0),
    )
    const roundApplied = applyCombatEvents(
      roundEvents,
      enemyRoll.fight.player,
      enemyRoll.fight.enemies,
      enemyRoll.fight.targetEnemyId,
    )
    enemyRoll.fight.player = { ...roundApplied.player, relics: writeRelics }
    enemyRoll.fight.enemies = roundApplied.enemies
    enemyRoll.fight.targetEnemyId = roundApplied.targetEnemyId

    set((s) => {
      s.map.currentNodeId = nodeId
      s.fight = enemyRoll.fight
      s.rng.enemy = enemyRoll.rng
      s.board = freshBoardState(boardRoll.board)
      s.rng.board = boardRoll.rng
      s.fightCounter += 1
      s.runPhase = 'fight'
      s.boardTargetingSpell = null
    })
  }
}

// Callback avoids circular runtime dependency: nodes.ts → store.ts → nodes.ts.
export function makeRestart(
  set: StoreSet,
  _get: StoreGet,
  getInitialState: () => InitialStateResult,
) {
  return (): void => {
    const fresh = getInitialState()
    set((s) => {
      s.board = fresh.board
      s.rng = fresh.rng
      s.rootSeed = fresh.rootSeed
      s.fight = fresh.fight
      s.pendingReward = fresh.pendingReward
      s.map = fresh.map
      s.runPhase = fresh.runPhase
      s.fightCounter += 1
    })
  }
}
