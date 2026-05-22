import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { generateBoard } from '../board/generation'
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  type Cell,
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
  selectCell: (pos: Pos | null) => void
  swapCells: (a: Pos, b: Pos) => void
}

export const useGameStore = create<GameStore>()(
  immer((set) => ({
    board: {
      width: BOARD_WIDTH,
      height: BOARD_HEIGHT,
      cells: generateBoard(),
      selected: null,
    },
    selectCell: (pos) =>
      set((s) => {
        s.board.selected = pos
      }),
    swapCells: (a, b) =>
      set((s) => {
        const rowA = s.board.cells[a.y]
        const rowB = s.board.cells[b.y]
        if (!rowA || !rowB) return
        const cellA = rowA[a.x]
        const cellB = rowB[b.x]
        if (!cellA || !cellB) return
        rowA[a.x] = cellB
        rowB[b.x] = cellA
      }),
  })),
)
