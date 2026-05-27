import { describe, it, expect } from 'vitest'
import { resolveSwap } from './cascade'
import { detectMatches } from './detectMatches'
import { generateBoard } from './generation'
import type { Cell, GemColor, Pos } from '../../types'

function findValidSwap(board: Cell[][]): { from: Pos; to: Pos } | null {
  const h = board.length
  const w = board[0]?.length ?? 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
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
        const hit = detectMatches(board).length > 0
        rowA[x] = a
        rowB[nx] = b
        if (hit) return { from: { x, y }, to: { x: nx, y: ny } }
      }
    }
  }
  return null
}

function boardSignature(board: Cell[][]): string {
  return board.map((row) => row.map((c) => c.gemColor[0]).join('')).join('|')
}

describe('cascade.resolveSwap', () => {
  it('invalid swap reverts and leaves board unchanged', () => {
    // Build a board with NO same-color adjacent gems and check that any
    // swap either makes a match (we skip) or reverts cleanly.
    const { board } = generateBoard({ seed: 12345 })
    const before = boardSignature(board)
    // Find a swap that does NOT produce a match.
    const w = board[0]?.length ?? 0
    let triedInvalid = false
    for (let y = 0; y < board.length && !triedInvalid; y++) {
      for (let x = 0; x < w - 1 && !triedInvalid; x++) {
        const r = resolveSwap(board, { seed: 1 }, { x, y }, { x: x + 1, y })
        if (!r.valid) {
          triedInvalid = true
          expect(boardSignature(r.board)).toBe(before)
          expect(r.events.at(0)?.kind).toBe('swap')
          expect(r.events.at(-1)?.kind).toBe('swap-reverted')
        }
      }
    }
    expect(triedInvalid).toBe(true)
  })

  it('valid swap produces a settled board with no orphan matches', () => {
    const { board, rng } = generateBoard({ seed: 7 })
    const swap = findValidSwap(board)
    expect(swap).not.toBeNull()
    if (!swap) return
    const result = resolveSwap(board, rng, swap.from, swap.to)
    expect(result.valid).toBe(true)
    // Final board has no pending matches.
    expect(detectMatches(result.board)).toEqual([])
    // No empty cells.
    for (const row of result.board) {
      expect(row.length).toBe(8)
      for (const c of row) expect(c).toBeDefined()
    }
  })

  it('is deterministic across same seed+swap', () => {
    const g1 = generateBoard({ seed: 42 })
    const g2 = generateBoard({ seed: 42 })
    const swap = findValidSwap(g1.board)
    expect(swap).not.toBeNull()
    if (!swap) return
    const r1 = resolveSwap(g1.board, g1.rng, swap.from, swap.to)
    const r2 = resolveSwap(g2.board, g2.rng, swap.from, swap.to)
    expect(boardSignature(r1.board)).toBe(boardSignature(r2.board))
    expect(r1.events).toEqual(r2.events)
    expect(r1.rng.seed).toBe(r2.rng.seed)
  })

  // The 3-color rotation pattern `palette[(x + y) % 3]` produces a board
  // with NO 3-runs in any direction or shape — used as a deterministic
  // "safe" base for tests that need to surgically place a few gems
  // without spurious pre-existing matches.
  const buildSafeBoard = (): Cell[][] => {
    const palette: GemColor[] = ['red', 'green', 'yellow']
    return Array.from({ length: 8 }, (_, y) =>
      Array.from({ length: 8 }, (_, x): Cell => ({ gemColor: palette[(x + y) % 3] ?? 'red' })),
    )
  }

  // Pre-arrange a horizontal 5-line that completes at (3,3) when the
  // blue at (3,4) is swapped up. 4 blues split across (1,3)-(2,3) and
  // (4,3)-(5,3) leaves a 2-run + 2-run with no pre-existing match; the
  // swap source at (3,4) is a lone blue (no vertical match against the
  // safe palette). Verified by `expect(detectMatches).length === 0` in
  // each test, so a palette change here fails loud.
  const setupFiveLineSwap = (board: Cell[][]) => {
    for (const x of [1, 2, 4, 5]) {
      const c = board[3]?.[x]
      if (c) c.gemColor = 'blue'
    }
    const swapSrc = board[4]?.[3]
    if (swapSrc) swapSrc.gemColor = 'blue'
  }
  const FIVE_LINE_SWAP = {
    from: { x: 3, y: 4 },
    to: { x: 3, y: 3 },
  }
  const FIVE_LINE_CELLS = [1, 2, 3, 4, 5].map((x) => ({ x, y: 3 }))

  it('5-line match flags the cleared cells as Blessed', () => {
    const board = buildSafeBoard()
    setupFiveLineSwap(board)
    expect(board[3]?.[3]?.gemColor).not.toBe('blue')
    expect(detectMatches(board).length).toBe(0)

    const result = resolveSwap(board, { seed: 1 }, FIVE_LINE_SWAP.from, FIVE_LINE_SWAP.to)
    expect(result.valid).toBe(true)

    // Cleared set is exactly the 5 line cells — no row extension anymore.
    const cleared = result.events.find((e) => e.kind === 'gems-cleared')
    expect(cleared?.kind).toBe('gems-cleared')
    if (cleared?.kind === 'gems-cleared') {
      const keys = new Set(cleared.cells.map((c) => `${c.x},${c.y}`))
      for (const p of FIVE_LINE_CELLS) expect(keys.has(`${p.x},${p.y}`)).toBe(true)
      expect(cleared.cells).toHaveLength(5)
    }

    // tile-blessed-placed event fires with the 5 line positions.
    const placed = result.events.find((e) => e.kind === 'tile-blessed-placed')
    expect(placed?.kind).toBe('tile-blessed-placed')
    if (placed?.kind === 'tile-blessed-placed') {
      const keys = new Set(placed.cells.map((c) => `${c.x},${c.y}`))
      for (const p of FIVE_LINE_CELLS) expect(keys.has(`${p.x},${p.y}`)).toBe(true)
      expect(placed.color).toBe('blue')
    }

    // After gravity + refill, the 5 line positions hold blessed-flagged
    // gems. (After this single 5-line with no chain, the cascade settles
    // here; the only blessed cells on the board are these 5.)
    for (const p of FIVE_LINE_CELLS) {
      expect(result.board[p.y]?.[p.x]?.flags?.blessed).toBe(true)
    }
  })

  it('blessed flag travels with the gem when gravity pulls it down', () => {
    // Pre-flag a gem at (4, 0). A line-5 in row 3 clears (4, 3), so
    // gravity pulls the col-4 stack down by one — (4, 0) lands at (4, 1)
    // (and the col-4 cleared cell at (4, 3) receives the original (4, 2)
    // gem, which itself also gets re-flagged blessed by the line-5).
    const board = buildSafeBoard()
    setupFiveLineSwap(board)
    const topCell = board[0]?.[4]
    if (topCell) topCell.flags = { blessed: true }
    expect(detectMatches(board).length).toBe(0)

    const result = resolveSwap(board, { seed: 1 }, FIVE_LINE_SWAP.from, FIVE_LINE_SWAP.to)
    expect(result.valid).toBe(true)
    // The original (4, 0) gem is now at (4, 1) and still carries its flag.
    expect(result.board[1]?.[4]?.flags?.blessed).toBe(true)
    // (4, 3) is one of the line-5 cells → re-blessed by the same step.
    expect(result.board[3]?.[4]?.flags?.blessed).toBe(true)
  })

  it('matching a blessed gem sets match-found.blessed and emits blessed-match-triggered', () => {
    const board = buildSafeBoard()
    // Set up a 3-run that completes via swap and includes a pre-flagged
    // blessed gem. (2,2) is the swap target (non-red); (3,2) is red and
    // is the blessed gem we'll match into the run. (0,2) and (1,2) are
    // red so the swap (3,2)→(2,2) makes a horizontal run at cols 0..3.
    // Actually we want a 3-run; place reds at (0,2), (1,2), and (3,2);
    // swap (3,2)→(2,2) shifts the run to cols 0..2 (with (3,2) becoming
    // whatever was at (2,2)).
    for (const x of [0, 1, 3]) {
      const c = board[2]?.[x]
      if (c) c.gemColor = 'red'
    }
    // The swap exchanges (2,2)'s palette color (green per (2+2)%3=1)
    // with (3,2)'s red. After swap, (0,2)=(1,2)=(2,2)=red — 3-run. The
    // blessed gem must be on (3,2) so that *after the swap* it lands at
    // (2,2) and participates in the cleared match. Flag (3,2) blessed.
    const blessedCell = board[2]?.[3]
    if (blessedCell) blessedCell.flags = { blessed: true }
    expect(detectMatches(board).length).toBe(0)

    const result = resolveSwap(board, { seed: 1 }, { x: 3, y: 2 }, { x: 2, y: 2 })
    expect(result.valid).toBe(true)

    const matchFound = result.events.find((e) => e.kind === 'match-found')
    expect(matchFound?.kind).toBe('match-found')
    if (matchFound?.kind === 'match-found') {
      expect(matchFound.blessed).toBe(true)
      expect(matchFound.size).toBe(3)
      expect(matchFound.color).toBe('red')
    }

    const blessedFired = result.events.find((e) => e.kind === 'blessed-match-triggered')
    expect(blessedFired?.kind).toBe('blessed-match-triggered')
    if (blessedFired?.kind === 'blessed-match-triggered') {
      expect(blessedFired.count).toBe(1)
    }
  })

  it('blessed flag does not stack on re-bless', () => {
    const board = buildSafeBoard()
    setupFiveLineSwap(board)
    // Pre-flag (3,3) as blessed. The line-5 swap brings the blue from
    // (3,4) into (3,3) — (3,3) becomes the new gem, NOT the previously
    // flagged one (the previously flagged gem moves down to (3,4)). So
    // (3,3) post-cascade carries `blessed: true` because the line-5
    // placed it there fresh. Flag is exactly `true`, not a count.
    const target = board[3]?.[3]
    if (target) target.flags = { blessed: true }
    expect(detectMatches(board).length).toBe(0)

    const result = resolveSwap(board, { seed: 1 }, FIVE_LINE_SWAP.from, FIVE_LINE_SWAP.to)
    expect(result.valid).toBe(true)
    expect(result.board[3]?.[3]?.flags?.blessed).toBe(true)
  })

  it('property: 1000 seeds → all settle, no orphans, deterministic', () => {
    const signatures: string[] = []
    const signatures2: string[] = []
    for (let seed = 1; seed <= 1000; seed++) {
      const g1 = generateBoard({ seed })
      const g2 = generateBoard({ seed })
      const swap = findValidSwap(g1.board)
      if (!swap) continue
      const r1 = resolveSwap(g1.board, g1.rng, swap.from, swap.to)
      const r2 = resolveSwap(g2.board, g2.rng, swap.from, swap.to)
      expect(r1.valid).toBe(true)
      expect(detectMatches(r1.board)).toEqual([])
      // 8x8 full
      expect(r1.board.length).toBe(8)
      for (const row of r1.board) expect(row.length).toBe(8)
      // Deterministic
      signatures.push(boardSignature(r1.board))
      signatures2.push(boardSignature(r2.board))
    }
    expect(signatures).toEqual(signatures2)
    expect(signatures.length).toBeGreaterThan(0)
  })
})
