import { describe, expect, it } from 'vitest'
import type { Cell } from '../../types'
import {
  applyFlagToCells,
  clearFlag,
  findFlaggedCells,
  getFlag,
  hasFlag,
  pickRandomCellsWithoutFlag,
  setFlag,
  tickFlagDuration,
} from './flags'

const c = (color: 'red' | 'blue' = 'red'): Cell => ({ gemColor: color })

// Tiny 2×2 board for the unit tests. Shape doesn't matter to flags —
// helpers operate on positions, not on match geometry.
const mkBoard = (): Cell[][] => [
  [c(), c()],
  [c(), c()],
]

describe('setFlag / clearFlag / hasFlag / getFlag', () => {
  it('set is pure and creates a new cell', () => {
    const cell = c()
    const flagged = setFlag(cell, 'burning', 2)
    expect(cell.flags).toBeUndefined() // input untouched
    expect(flagged.flags?.burning).toBe(2)
    expect(getFlag(flagged, 'burning')).toBe(2)
    expect(hasFlag(flagged, 'burning')).toBe(true)
  })

  it('clearFlag drops the flag and the flags bag when empty', () => {
    const cell = setFlag(c(), 'burning', 2)
    const cleared = clearFlag(cell, 'burning')
    expect(cleared.flags).toBeUndefined()
  })

  it('clearFlag on a cell without the flag is a no-op', () => {
    const cell = c()
    expect(clearFlag(cell, 'burning')).toBe(cell)
  })
})

describe('tickFlagDuration', () => {
  it('decrements remaining duration by 1 across the board', () => {
    let board = mkBoard()
    board = applyFlagToCells(board, [{ x: 0, y: 0 }, { x: 1, y: 1 }], 'burning', 2)
    const { board: ticked, events } = tickFlagDuration(board, 'burning')
    expect(getFlag(ticked[0]?.[0], 'burning')).toBe(1)
    expect(getFlag(ticked[1]?.[1], 'burning')).toBe(1)
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('cell-flag-ticked')
  })

  it('clears the flag when duration drops to 0', () => {
    let board = mkBoard()
    board = applyFlagToCells(board, [{ x: 0, y: 0 }], 'burning', 1)
    const { board: ticked } = tickFlagDuration(board, 'burning')
    expect(hasFlag(ticked[0]?.[0], 'burning')).toBe(false)
  })

  it('reports expired positions on the tick event', () => {
    // (0,0) and (1,1) expire this tick (duration 1 → 0); (1,0) survives
    // with duration 2 remaining, so `expired` is a strict subset of
    // `positions`.
    let board = mkBoard()
    board = applyFlagToCells(
      board,
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      'burning',
      1,
    )
    board = applyFlagToCells(board, [{ x: 1, y: 0 }], 'burning', 3)
    const { events } = tickFlagDuration(board, 'burning')
    const event = events[0]
    expect(event?.kind).toBe('cell-flag-ticked')
    if (event?.kind !== 'cell-flag-ticked') throw new Error('unreachable')
    expect(event.positions).toHaveLength(3)
    expect(event.expired).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ])
  })

  it('is a no-op when nothing is flagged', () => {
    const board = mkBoard()
    const { board: ticked, events } = tickFlagDuration(board, 'burning')
    expect(ticked).toBe(board)
    expect(events).toEqual([])
  })
})

describe('pickRandomCellsWithoutFlag', () => {
  it('skips cells that already carry the flag', () => {
    let board = mkBoard()
    board = applyFlagToCells(board, [{ x: 0, y: 0 }, { x: 1, y: 1 }], 'burning', 2)
    const { cells } = pickRandomCellsWithoutFlag(board, 'burning', 2, { seed: 1 })
    expect(cells).toHaveLength(2)
    for (const p of cells) {
      expect(hasFlag(board[p.y]?.[p.x], 'burning')).toBe(false)
    }
  })

  it('returns fewer than asked if not enough unflagged cells exist', () => {
    let board = mkBoard()
    // Flag everything; nothing left to pick.
    board = applyFlagToCells(
      board,
      [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      'burning',
      2,
    )
    const { cells } = pickRandomCellsWithoutFlag(board, 'burning', 3, { seed: 1 })
    expect(cells).toEqual([])
  })

  it('is deterministic for the same seed', () => {
    const board = mkBoard()
    const a = pickRandomCellsWithoutFlag(board, 'burning', 2, { seed: 42 })
    const b = pickRandomCellsWithoutFlag(board, 'burning', 2, { seed: 42 })
    expect(a.cells).toEqual(b.cells)
    expect(a.rng).toEqual(b.rng)
  })
})

describe('findFlaggedCells', () => {
  it('returns positions of flagged cells in row-major order', () => {
    let board = mkBoard()
    board = applyFlagToCells(board, [{ x: 1, y: 0 }, { x: 0, y: 1 }], 'burning', 2)
    expect(findFlaggedCells(board, 'burning')).toEqual([
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ])
  })
})
