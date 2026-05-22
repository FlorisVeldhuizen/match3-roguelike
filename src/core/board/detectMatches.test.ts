import { describe, it, expect } from 'vitest'
import type { Cell, GemColor } from '../../types'
import { detectMatches } from './detectMatches'

// Build a board from a string grid. Chars: r/b/g/y/p (explicit) / . (auto-fill).
// Auto-fill picks colors that don't extend any 3-in-a-row with neighbors —
// so explicit placements stand alone as the only matches.
function build(rows: string[]): Cell[][] {
  const colorMap: Record<string, GemColor> = {
    r: 'red',
    b: 'blue',
    g: 'green',
    y: 'yellow',
    p: 'purple',
  }
  const h = rows.length
  const w = rows[0]?.length ?? 0
  const grid: (GemColor | null)[][] = rows.map((row) =>
    [...row].map((ch) => colorMap[ch] ?? null),
  )
  const at = (x: number, y: number): GemColor | null => {
    if (x < 0 || y < 0 || x >= w || y >= h) return null
    return grid[y]?.[x] ?? null
  }
  const palette: GemColor[] = ['red', 'blue', 'green', 'yellow', 'purple']

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y]?.[x] !== null) continue
      const forbid = new Set<GemColor>()
      const ban = (a: GemColor | null, b: GemColor | null) => {
        if (a && a === b) forbid.add(a)
      }
      // Horizontal triplets touching (x,y).
      ban(at(x - 2, y), at(x - 1, y))
      ban(at(x - 1, y), at(x + 1, y))
      ban(at(x + 1, y), at(x + 2, y))
      // Vertical triplets touching (x,y).
      ban(at(x, y - 2), at(x, y - 1))
      ban(at(x, y - 1), at(x, y + 1))
      ban(at(x, y + 1), at(x, y + 2))
      const picked = palette.find((c) => !forbid.has(c))
      if (!picked) throw new Error('build: no safe filler')
      const row = grid[y]
      if (!row) throw new Error('build: missing row')
      row[x] = picked
    }
  }
  return grid.map((row) =>
    row.map((c) => {
      if (!c) throw new Error('build: unfilled cell')
      return { gemColor: c, flags: {} }
    }),
  )
}

describe('detectMatches', () => {
  it('detects no matches on a clean board', () => {
    const board = build([
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ])
    expect(detectMatches(board)).toEqual([])
  })

  it('detects a horizontal 3-line', () => {
    const board = build([
      '........',
      '........',
      '...rrr..',
      '........',
      '........',
      '........',
      '........',
      '........',
    ])
    const matches = detectMatches(board)
    expect(matches.length).toBe(1)
    const m = matches[0]
    expect(m).toBeDefined()
    if (!m) return
    expect(m.shape).toBe('line')
    expect(m.color).toBe('red')
    expect(m.size).toBe(3)
  })

  it('detects a vertical 4-line', () => {
    const board = build([
      '...b....',
      '...b....',
      '...b....',
      '...b....',
      '........',
      '........',
      '........',
      '........',
    ])
    const matches = detectMatches(board)
    expect(matches.length).toBe(1)
    const m = matches[0]
    if (!m) throw new Error('no match')
    expect(m.shape).toBe('line')
    expect(m.size).toBe(4)
  })

  it('detects a 5-line', () => {
    const board = build([
      'ggggg...',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ])
    const matches = detectMatches(board)
    expect(matches.length).toBe(1)
    const m = matches[0]
    if (!m) throw new Error('no match')
    expect(m.shape).toBe('line')
    expect(m.size).toBe(5)
  })

  it('detects a T: H 3-run with V 3-run meeting at H middle', () => {
    // 5 cells total (3 H + 3 V - 1 shared)
    const board = build([
      '........',
      '...y....',
      '..yyy...',
      '...y....',
      '........',
      '........',
      '........',
      '........',
    ])
    const matches = detectMatches(board)
    expect(matches.length).toBe(1)
    const m = matches[0]
    if (!m) throw new Error('no match')
    expect(m.shape).toBe('T')
    expect(m.size).toBe(5)
  })

  it('detects an L: H 3-run with V 3-run meeting at both ends', () => {
    const board = build([
      'ppp.....',
      'p.......',
      'p.......',
      '........',
      '........',
      '........',
      '........',
      '........',
    ])
    const matches = detectMatches(board)
    expect(matches.length).toBe(1)
    const m = matches[0]
    if (!m) throw new Error('no match')
    expect(m.shape).toBe('L')
    expect(m.size).toBe(5)
  })

  it('detects matches at top-left corner', () => {
    const board = build([
      'rrr.....',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
    ])
    expect(detectMatches(board).length).toBe(1)
  })

  it('detects matches at bottom-right corner', () => {
    const board = build([
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '.....rrr',
    ])
    expect(detectMatches(board).length).toBe(1)
  })

  it('detects multiple disjoint matches', () => {
    const board = build([
      'rrr.....',
      '........',
      '........',
      '........',
      'bbb.....',
      '........',
      '........',
      '........',
    ])
    expect(detectMatches(board).length).toBe(2)
  })

  it('does not merge two matches of different colors', () => {
    // r horizontal at row 2; b vertical at col 6 — disjoint.
    const board = build([
      '......b.',
      '......b.',
      'rrr...b.',
      '........',
      '........',
      '........',
      '........',
      '........',
    ])
    const matches = detectMatches(board)
    expect(matches.length).toBe(2)
  })

  it('groups same-color H+V that touch only at end → L', () => {
    const board = build([
      '.....ggg',
      '.....g..',
      '.....g..',
      '........',
      '........',
      '........',
      '........',
      '........',
    ])
    const matches = detectMatches(board)
    expect(matches.length).toBe(1)
    const m = matches[0]
    if (!m) throw new Error('no match')
    expect(m.shape).toBe('L')
  })
})
