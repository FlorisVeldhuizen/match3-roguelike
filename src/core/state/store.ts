import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { generateBoard } from '../board/generation'
import { resolveSwap, type SwapResolution } from '../board/cascade'
import { forkStreams, type RngStreams } from '../rng/streams'
import {
  applyPoolDeltas,
  beginPlayerPhase,
  resolveEndOfPhase,
} from '../combat/turn'
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
const ENEMY_DEFAULT_HP = 20

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

function freshEnemy(): Enemy {
  return {
    id: 'enemy-1',
    name: 'Brute',
    hp: ENEMY_DEFAULT_HP,
    maxHp: ENEMY_DEFAULT_HP,
  }
}

function freshFight(): FightState {
  const enemy = freshEnemy()
  return {
    phase: 'player-acting',
    player: freshPlayer(),
    enemies: [enemy],
    targetEnemyId: enemy.id,
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
  return {
    board: {
      width: BOARD_WIDTH,
      height: BOARD_HEIGHT,
      cells: board,
      selected: null,
    },
    rng: { ...streams, board: nextBoardRng },
    rootSeed: seed,
    fight: freshFight(),
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

      if (current.fight.phase === 'victory') {
        return { valid: false, events: [] }
      }

      // If the prior phase ended (enemy-acting holds until the player commits
      // their next swap in Phase D — the enemy doesn't actually act yet),
      // start a fresh player phase: block zeroes, pools reset.
      let phase: CombatPhase = current.fight.phase
      let player = current.fight.player
      const prelude: GameEvent[] = []
      if (phase === 'enemy-acting') {
        player = beginPlayerPhase(player)
        phase = 'player-acting'
        prelude.push({ kind: 'phase-changed', phase: 'player-acting' })
      }

      if (phase !== 'player-acting') {
        return { valid: false, events: prelude }
      }

      const swap: SwapResolution = resolveSwap(
        current.board.cells,
        current.rng.board,
        a,
        b,
      )

      if (!swap.valid) {
        // Commit just the prelude reset (if any) so we don't lose the phase
        // transition. The board stays as-is.
        if (prelude.length > 0) {
          set((s) => {
            s.fight.player = player
            s.fight.phase = phase
          })
        }
        return { valid: false, events: [...prelude, ...swap.events] }
      }

      let enemies = current.fight.enemies
      let targetEnemyId = current.fight.targetEnemyId

      const deltas = computeMatchPayouts(swap.events)
      const decoratedSwap = withPoolGainedEvents(swap.events)
      player = applyPoolDeltas(player, deltas)

      let endEvents: GameEvent[] = []
      if (!hasExtraTurnMatch(swap.events)) {
        const resolved = resolveEndOfPhase(player, enemies, targetEnemyId)
        player = resolved.player
        enemies = resolved.enemies
        targetEnemyId = resolved.targetEnemyId
        phase = resolved.phase
        endEvents = resolved.events
      }

      set((s) => {
        s.board.cells = swap.board
        s.rng.board = swap.rng
        s.board.selected = null
        s.fight.phase = phase
        s.fight.player = player
        s.fight.enemies = enemies
        s.fight.targetEnemyId = targetEnemyId
      })

      return {
        valid: true,
        events: [...prelude, ...decoratedSwap, ...endEvents],
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
