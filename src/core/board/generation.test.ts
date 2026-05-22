import { describe, it, expect } from 'vitest'
import { generateBoard } from './generation'
import { detectMatches } from './detectMatches'
import type { RngState } from '../rng/mulberry32'

describe('generateBoard', () => {
  it('produces a board with no pre-existing matches', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { board } = generateBoard({ seed })
      expect(detectMatches(board)).toEqual([])
    }
  })

  it('always produces a board with at least one valid swap', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { board } = generateBoard({ seed })
      const h = board.length
      const w = board[0]?.length ?? 0
      let found = false
      outer: for (let y = 0; y < h && !found; y++) {
        for (let x = 0; x < w && !found; x++) {
          for (const [dx, dy] of [
            [1, 0],
            [0, 1],
          ] as const) {
            const nx = x + dx
            const ny = y + dy
            if (nx >= w || ny >= h) continue
            const rowA = board[y]
            const rowB = board[ny]
            if (!rowA || !rowB) continue
            const a = rowA[x]
            const b = rowB[nx]
            if (!a || !b) continue
            rowA[x] = b
            rowB[nx] = a
            const matches = detectMatches(board)
            rowA[x] = a
            rowB[nx] = b
            if (matches.length > 0) {
              found = true
              break outer
            }
          }
        }
      }
      expect(found).toBe(true)
    }
  })

  it('is deterministic given the same seed', () => {
    const r1: RngState = { seed: 12345 }
    const r2: RngState = { seed: 12345 }
    const a = generateBoard(r1)
    const b = generateBoard(r2)
    expect(a.board).toEqual(b.board)
    expect(a.rng.seed).toBe(b.rng.seed)
  })

  it('terminates (does not infinite-loop) on many seeds', () => {
    // Implicit: just iterate and ensure each call returns.
    for (let seed = 0; seed < 500; seed++) {
      const { board } = generateBoard({ seed })
      expect(board.length).toBeGreaterThan(0)
    }
  })
})
