import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { generateBoard } from '../board/generation'
import { resolveSwap, type SwapResolution } from '../board/cascade'
import { forkStreams, type RngStreams } from '../rng/streams'
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  type Cell,
  type GameEvent,
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
  selectCell: (pos: Pos | null) => void
  attemptSwap: (a: Pos, b: Pos) => { valid: boolean; events: GameEvent[] }
}

function initialState(seed: string): {
  board: BoardState
  rng: RngStreams
  rootSeed: string
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
  }
}

// Slice seed: stable for the lifetime of this module (HMR resets). For Phase C
// we don't expose a UI to reseed; later phases will wire this up.
const SLICE_SEED = `slice-${Math.floor(Math.random() * 1e9).toString(36)}`

export const useGameStore = create<GameStore>()(
  immer((set, get) => ({
    ...initialState(SLICE_SEED),
    selectCell: (pos) =>
      set((s) => {
        s.board.selected = pos
      }),
    attemptSwap: (a, b) => {
      const current = get()
      const result: SwapResolution = resolveSwap(
        current.board.cells,
        current.rng.board,
        a,
        b,
      )
      if (result.valid) {
        set((s) => {
          s.board.cells = result.board
          s.rng.board = result.rng
          s.board.selected = null
        })
      }
      return { valid: result.valid, events: result.events }
    },
  })),
)
