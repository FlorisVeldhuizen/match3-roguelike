import {
  type Cell,
  type GemColor,
  type Pos,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  GEM_COLORS,
} from '../../types'
import { nextInt, type RngState } from '../rng/mulberry32'
import { detectMatches } from './detectMatches'

// Generates a playable starting board:
//  1. fill with random gems, then walk row-major and replace any cell that
//     would complete a pre-existing match with a non-completing color
//  2. verify at least one valid swap exists; if not, fall through to
//  3. force-place a guaranteed swappable [A,B,A,B] segment and re-clean
//
// Threads RngState through and returns the advanced state. Determinism: same
// (seed, dims) → same board.
export function generateBoard(
  rng: RngState,
  width: number = BOARD_WIDTH,
  height: number = BOARD_HEIGHT,
): { board: Cell[][]; rng: RngState } {
  let r = rng
  const rand = (): number => {
    const [v, n] = nextInt(r, GEM_COLORS.length)
    r = n
    return v
  }

  let board = fillAndDematch(width, height, rand)
  if (!hasValidSwap(board)) {
    board = forcePlaceSwap(board, rand)
  }
  return { board, rng: r }
}

function fillAndDematch(
  width: number,
  height: number,
  randIdx: () => number,
): Cell[][] {
  const board: Cell[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => {
      const color = GEM_COLORS[randIdx()]
      if (!color) throw new Error('fill: oob color idx')
      return { gemColor: color }
    }),
  )
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const forbidden = forbiddenColorsAt(board, x, y)
      const current = board[y]?.[x]
      if (!current) throw new Error('fill: missing cell')
      if (!forbidden.has(current.gemColor)) continue
      const choice = GEM_COLORS.find((c) => !forbidden.has(c))
      if (!choice) throw new Error('fill: no safe color')
      current.gemColor = choice
    }
  }
  return board
}

function forbiddenColorsAt(
  board: Cell[][],
  x: number,
  y: number,
): Set<GemColor> {
  const out = new Set<GemColor>()
  const at = (xx: number, yy: number): GemColor | null =>
    board[yy]?.[xx]?.gemColor ?? null
  // Triplet patterns including (x,y); we only need patterns where the
  // two non-(x,y) cells are already filled and equal.
  const ban = (a: GemColor | null, b: GemColor | null) => {
    if (a && a === b) out.add(a)
  }
  ban(at(x - 2, y), at(x - 1, y))
  ban(at(x - 1, y), at(x + 1, y))
  ban(at(x + 1, y), at(x + 2, y))
  ban(at(x, y - 2), at(x, y - 1))
  ban(at(x, y - 1), at(x, y + 1))
  ban(at(x, y + 1), at(x, y + 2))
  return out
}

// H2b: optional petrifiedRows respected when checking whether the
// player still has a valid move. A swap whose only matches sit on
// locked rows shouldn't keep the board from auto-regen-ing.
export function hasValidSwap(
  board: Cell[][],
  petrifiedRows: Readonly<Record<number, number>> = {},
): boolean {
  const h = board.length
  const w = board[0]?.length ?? 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Try swap right.
      if (x + 1 < w) {
        if (swapMakesMatch(board, x, y, x + 1, y, petrifiedRows)) return true
      }
      // Try swap down.
      if (y + 1 < h) {
        if (swapMakesMatch(board, x, y, x, y + 1, petrifiedRows)) return true
      }
    }
  }
  return false
}

// Returns every (from → to) pair that yields at least one match. Used by the
// idle-hint nudge to cycle through random suggestions without repeats.
export function findAllValidSwaps(
  board: Cell[][],
  petrifiedRows: Readonly<Record<number, number>> = {},
): Array<{ from: Pos; to: Pos }> {
  const out: Array<{ from: Pos; to: Pos }> = []
  const h = board.length
  const w = board[0]?.length ?? 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x + 1 < w && swapMakesMatch(board, x, y, x + 1, y, petrifiedRows)) {
        out.push({ from: { x, y }, to: { x: x + 1, y } })
      }
      if (y + 1 < h && swapMakesMatch(board, x, y, x, y + 1, petrifiedRows)) {
        out.push({ from: { x, y }, to: { x, y: y + 1 } })
      }
    }
  }
  return out
}

function swapMakesMatch(
  board: Cell[][],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  petrifiedRows: Readonly<Record<number, number>> = {},
): boolean {
  const rowA = board[ay]
  const rowB = board[by]
  if (!rowA || !rowB) return false
  const ca = rowA[ax]
  const cb = rowB[bx]
  if (!ca || !cb) return false
  rowA[ax] = cb
  rowB[bx] = ca
  const hit = detectMatches(board, petrifiedRows).length > 0
  rowA[ax] = ca
  rowB[bx] = cb
  return hit
}

// Last-resort: force a row's first 4 cells to [A,B,A,B] with A,B chosen so
// they don't form matches with cells above or to the right. Then re-clean
// the rest of the board (preserving the forced segment).
function forcePlaceSwap(board: Cell[][], randIdx: () => number): Cell[][] {
  const h = board.length
  const w = board[0]?.length ?? 0
  if (w < 4 || h === 0) return board
  // Try rows in randomized order until placement works.
  const rowOrder = Array.from({ length: h }, (_, i) => i)
  for (let i = rowOrder.length - 1; i > 0; i--) {
    const j = randIdx() % (i + 1)
    const a = rowOrder[i]
    const b = rowOrder[j]
    if (a === undefined || b === undefined) continue
    rowOrder[i] = b
    rowOrder[j] = a
  }
  for (const y of rowOrder) {
    for (let ai = 0; ai < GEM_COLORS.length; ai++) {
      for (let bi = 0; bi < GEM_COLORS.length; bi++) {
        if (ai === bi) continue
        const colA = GEM_COLORS[ai]
        const colB = GEM_COLORS[bi]
        if (!colA || !colB) continue
        if (tryForceSegment(board, y, colA, colB)) {
          // Re-clean rest of board (preserving forced segment).
          dematchExceptSegment(board, y)
          if (hasValidSwap(board)) return board
        }
      }
    }
  }
  // Should be unreachable for sensible board sizes; return board as-is.
  return board
}

function tryForceSegment(
  board: Cell[][],
  y: number,
  a: GemColor,
  b: GemColor,
): boolean {
  const row = board[y]
  if (!row) return false
  const segment: GemColor[] = [a, b, a, b]
  const snapshot: Cell[] = []
  for (let x = 0; x < 4; x++) {
    const cell = row[x]
    if (!cell) return false
    snapshot.push({ gemColor: cell.gemColor })
    cell.gemColor = segment[x] ?? a
  }
  // Validate: forced cells must not complete matches with cells above/below.
  const matches = detectMatches(board)
  if (matches.length > 0) {
    for (let x = 0; x < 4; x++) {
      const s = snapshot[x]
      const row2 = board[y]
      if (!row2 || !s) continue
      const cur = row2[x]
      if (cur) cur.gemColor = s.gemColor
    }
    return false
  }
  return true
}

function dematchExceptSegment(board: Cell[][], reservedRow: number): void {
  const h = board.length
  const w = board[0]?.length ?? 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y === reservedRow && x < 4) continue
      const forbidden = forbiddenColorsAt(board, x, y)
      const cur = board[y]?.[x]
      if (!cur || !forbidden.has(cur.gemColor)) continue
      const choice = GEM_COLORS.find((c) => !forbidden.has(c))
      if (!choice) continue
      cur.gemColor = choice
    }
  }
}
