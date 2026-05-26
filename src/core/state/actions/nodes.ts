import { generateBoard } from '../../board/generation'
import { getReachableFrom } from '../../map/paths'
import { runOnRoundStarted, snapshotOf } from '../../relics/engine'
import type { RngStreams } from '../../rng/streams'
import type {
  FightState,
  MapState,
  PendingReward,
  RunPhase,
} from '../../../types'
import type { BoardState } from '../store'
import type { StoreSet, StoreGet } from './types'
import { freshBoardState, freshFight } from './helpers'

// Flat HP restored when entering a rest node. Bosses heal to full; regular
// fights carry HP forward (see enterNode). Rest sits between: a top-up that
// doesn't make the map trivial.
const REST_HEAL_AMOUNT = 10

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
    // Only valid on the map screen.
    if (current.runPhase !== 'map') return
    // Validate the target is reachable from currentNodeId (or is a
    // col-0 node when currentNodeId is null).
    const reachable = getReachableFrom(current.map)
    if (!reachable.has(nodeId)) return
    const node = current.map.nodes.find((n) => n.id === nodeId)
    if (!node) return

    // Shop/rest in H1: auto-complete, mark visited, stay on map.
    // Phase I builds the real screens. Rest nodes top up HP by a flat
    // REST_HEAL_AMOUNT (clamped to maxHp) — boss kills heal fully, so
    // rest sits between fight carry-over and boss reset.
    if (node.kind === 'shop' || node.kind === 'rest') {
      set((s) => {
        s.map.currentNodeId = nodeId
        if (!s.map.completedNodeIds.includes(nodeId)) {
          s.map.completedNodeIds.push(nodeId)
        }
        if (node.kind === 'rest') {
          const p = s.fight.player
          p.hp = Math.min(p.maxHp, p.hp + REST_HEAL_AMOUNT)
        }
      })
      return
    }

    // Fight / elite / boss: roll a fresh fight from the node's archetypes.
    // Player HP carries from the previous fight; freshFight resets to
    // defaults and we overwrite HP below. Boss victory heals to full
    // (see attemptSwap victory block), so the player enters the next
    // map's run topped up.
    //
    // Mana and skillCharge BOTH reset to zero between fights. Original
    // H3 design carried mana over, but in practice that let players
    // arrive at later fights with a full bank that trivialised pacing
    // — and rewarded sitting on saved mana through trivial fights
    // rather than spending it. Per-fight reset puts every encounter
    // back on the same starting line and forces in-fight decisions.
    const enemyRoll = freshFight(current.rng.enemy, current.fight.player.relics, {
      archetypes: node.archetypes,
      isBoss: node.kind === 'boss',
    })
    enemyRoll.fight.player.hp = Math.min(
      enemyRoll.fight.player.maxHp,
      current.fight.player.hp,
    )
    const boardRoll = generateBoard(current.rng.board)
    // onRoundStarted fires for the new encounter. Events are dropped on
    // the floor here — there's no animation queue between map clicks and
    // the fight start, so listeners that emit visual cues won't pop until
    // the next swap. (Phase G's onRoundStarted listeners are none.)
    runOnRoundStarted(
      { fightId: 0 },
      enemyRoll.fight.player.relics,
      snapshotOf(
        enemyRoll.fight.player,
        enemyRoll.fight.enemies,
        enemyRoll.fight.targetEnemyId,
        0,
      ),
    )

    set((s) => {
      s.map.currentNodeId = nodeId
      s.fight = enemyRoll.fight
      s.rng.enemy = enemyRoll.rng
      // All board-affecting state resets via freshBoardState — single
      // source of truth so a new effect added in the future (e.g. a
      // frozen-tiles map, global board modifier) inherits the cleanup
      // here without needing a code change at every transition site.
      s.board = freshBoardState(boardRoll.board)
      s.rng.board = boardRoll.rng
      s.fightCounter += 1
      s.runPhase = 'fight'
      // Stale board-targeting mode left over from the previous fight
      // gets cleared so the new fight starts in normal swap mode.
      s.boardTargetingSpell = null
    })
  }
}

// initialState is passed as a callback to avoid circular runtime dependency:
// nodes.ts → store.ts → nodes.ts. type GameStore import is type-only (no
// runtime cycle); initialState itself lives in store.ts.
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
