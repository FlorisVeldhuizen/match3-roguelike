import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { RngState } from '../rng/mulberry32'
import { generateBoard } from '../board/generation'
import { resolveSwap, type SwapResolution } from '../board/cascade'
import { forkStreams, type RngStreams } from '../rng/streams'
import {
  applyPoolDeltas,
  beginPlayerPhase,
  resolveEndOfPhase,
} from '../combat/turn'
import { executeEnemyTurn } from '../combat/enemyTurn'
import { rollIntent } from '../combat/intents'
import {
  computeMatchPayouts,
  hasExtraTurnMatch,
  withPoolGainedEvents,
} from '../combat/pools'
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  type Cell,
  type CombatPhase,
  type Enemy,
  type FightState,
  type GameEvent,
  type Player,
  type Pos,
} from '../../types'
import { getArchetype } from '../combat/archetypeRegistry'

export type BoardState = {
  width: number
  height: number
  cells: Cell[][]
  selected: Pos | null
}

export type GameStore = {
  board: BoardState
  rng: RngStreams
  rootSeed: string
  fight: FightState
  selectCell: (pos: Pos | null) => void
  attemptSwap: (a: Pos, b: Pos) => { valid: boolean; events: GameEvent[] }
  restart: () => void
}

const PLAYER_MAX_HP = 60

function freshPlayer(): Player {
  return {
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    block: 0,
    mana: 0,
    skillCharge: 0,
    phasePools: { red: 0, blue: 0, green: 0 },
  }
}

function freshFight(enemyRng: RngState): { fight: FightState; rng: RngState } {
  const archetype = 'brute'
  const def = getArchetype(archetype)
  const first = rollIntent(archetype, 0, enemyRng)
  const enemy: Enemy = {
    id: 'enemy-1',
    name: def.name,
    archetype,
    hp: def.maxHp,
    maxHp: def.maxHp,
    block: 0,
    currentIntent: first.intent,
    nextIntentIndex: 0,
  }
  return {
    fight: {
      phase: 'player-acting',
      player: freshPlayer(),
      enemies: [enemy],
      targetEnemyId: enemy.id,
    },
    rng: first.rng,
  }
}

function initialState(seed: string): {
  board: BoardState
  rng: RngStreams
  rootSeed: string
  fight: FightState
} {
  const streams = forkStreams(seed)
  const { board, rng: nextBoardRng } = generateBoard(streams.board)
  const { fight, rng: nextEnemyRng } = freshFight(streams.enemy)
  return {
    board: {
      width: BOARD_WIDTH,
      height: BOARD_HEIGHT,
      cells: board,
      selected: null,
    },
    rng: { ...streams, board: nextBoardRng, enemy: nextEnemyRng },
    rootSeed: seed,
    fight,
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

      const deltas = computeMatchPayouts(swap.events)
      const decoratedSwap = withPoolGainedEvents(swap.events)
      player = applyPoolDeltas(player, deltas)

      const tailEvents: GameEvent[] = []

      const extraTurn = hasExtraTurnMatch(swap.events)
      if (extraTurn) {
        tailEvents.push({ kind: 'extra-turn-granted' })
      }

      if (!extraTurn) {
        const resolved = resolveEndOfPhase(player, enemies, targetEnemyId)
        player = resolved.player
        enemies = resolved.enemies
        targetEnemyId = resolved.targetEnemyId
        phase = resolved.phase
        tailEvents.push(...resolved.events)

        // If enemies still alive, enemy turn fires now. Then begin next player
        // phase so block zeroes and pools reset before the player swaps again.
        if (phase === 'enemy-acting') {
          const enemyResult = executeEnemyTurn(player, enemies, enemyRng)
          player = enemyResult.player
          enemies = enemyResult.enemies
          enemyRng = enemyResult.rng
          phase = enemyResult.phase
          tailEvents.push(...enemyResult.events)

          if (phase === 'player-acting') {
            player = beginPlayerPhase(player)
          }
        }
      }

      set((s) => {
        s.board.cells = swap.board
        s.rng.board = swap.rng
        s.rng.enemy = enemyRng
        s.board.selected = null
        s.fight.phase = phase
        s.fight.player = player
        s.fight.enemies = enemies
        s.fight.targetEnemyId = targetEnemyId
      })

      return {
        valid: true,
        events: [...decoratedSwap, ...tailEvents],
      }
    },
    restart: () => {
      const fresh = initialState(newSliceSeed())
      set((s) => {
        s.board = fresh.board
        s.rng = fresh.rng
        s.rootSeed = fresh.rootSeed
        s.fight = fresh.fight
      })
    },
  })),
)
