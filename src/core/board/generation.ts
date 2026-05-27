import {
  type Cell,
  type GemColor,
  type Pos,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  MANA_GEM_COLORS,
} from '../../types'
import { nextInt, type RngState } from '../rng/mulberry32'
import { detectMatches } from './detectMatches'
import { pickGemColorWeighted } from './gemSpawn'

export function generateBoard(
  rng: RngState,
  width: number = BOARD_WIDTH,
  height: number = BOARD_HEIGHT,
  petrifiedRows: Readonly<Record<number, number>> = {},
): { board: Cell[][]; rng: RngState } {
  let r = rng
  const randColor = (): GemColor => {
    const [color, n] = pickGemColorWeighted(r)
    r = n
    return color
  }
  const randIntBelow = (max: number): number => {
    const [v, n] = nextInt(r, max)
    r = n
    return v
  }

  let board = fillAndDematch(width, height, randColor)
  if (!hasValidSwap(board, petrifiedRows)) {
    board = forcePlaceSwap(board, randIntBelow, petrifiedRows)
  }
  return { board, rng: r }
}

function fillAndDematch(width: number, height: number, randColor: () => GemColor): Cell[][] {
  const board: Cell[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ gemColor: randColor() })),
  )
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const forbidden = forbiddenColorsAt(board, x, y)
      const current = board[y]?.[x]
      if (!current) throw new Error('fill: missing cell')
      if (!forbidden.has(current.gemColor)) continue
      // Mana-only fallback prevents forced gold clusters during cleanup.
      const choice = MANA_GEM_COLORS.find((c) => !forbidden.has(c))
      if (!choice) throw new Error('fill: no safe color')
      current.gemColor = choice
    }
  }
  return board
}

function forbiddenColorsAt(board: Cell[][], x: number, y: number): Set<GemColor> {
  const out = new Set<GemColor>()
  const at = (xx: number, yy: number): GemColor | null => board[yy]?.[xx]?.gemColor ?? null
  // Ban any color that would complete a triplet with two filled neighbors.
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

export function hasValidSwap(
  board: Cell[][],
  petrifiedRows: Readonly<Record<number, number>> = {},
): boolean {
  const h = board.length
  const w = board[0]?.length ?? 0
  for (let y = 0; y < h; y++) {
    if ((petrifiedRows[y] ?? 0) > 0) continue // gems in this row are stuck
    for (let x = 0; x < w; x++) {
      if (x + 1 < w) {
        if (swapMakesMatch(board, x, y, x + 1, y)) return true
      }
      if (y + 1 < h && (petrifiedRows[y + 1] ?? 0) === 0) {
        if (swapMakesMatch(board, x, y, x, y + 1)) return true
      }
    }
  }
  return false
}

export function findAllValidSwaps(
  board: Cell[][],
  petrifiedRows: Readonly<Record<number, number>> = {},
): Array<{ from: Pos; to: Pos }> {
  const out: Array<{ from: Pos; to: Pos }> = []
  const h = board.length
  const w = board[0]?.length ?? 0
  for (let y = 0; y < h; y++) {
    if ((petrifiedRows[y] ?? 0) > 0) continue
    for (let x = 0; x < w; x++) {
      if (x + 1 < w && swapMakesMatch(board, x, y, x + 1, y)) {
        out.push({ from: { x, y }, to: { x: x + 1, y } })
      }
      if (y + 1 < h && (petrifiedRows[y + 1] ?? 0) === 0 && swapMakesMatch(board, x, y, x, y + 1)) {
        out.push({ from: { x, y }, to: { x, y: y + 1 } })
      }
    }
  }
  return out
}

function swapMakesMatch(board: Cell[][], ax: number, ay: number, bx: number, by: number): boolean {
  const rowA = board[ay]
  const rowB = board[by]
  if (!rowA || !rowB) return false
  const ca = rowA[ax]
  const cb = rowB[bx]
  if (!ca || !cb) return false
  rowA[ax] = cb
  rowB[bx] = ca
  const hit = detectMatches(board).length > 0
  rowA[ax] = ca
  rowB[bx] = cb
  return hit
}

// Last-resort: force [A,B,A,B] into a row to guarantee a valid swap.
function forcePlaceSwap(
  board: Cell[][],
  randIntBelow: (max: number) => number,
  petrifiedRows: Readonly<Record<number, number>> = {},
): Cell[][] {
  const h = board.length
  const w = board[0]?.length ?? 0
  if (w < 4 || h === 0) return board
  const rowOrder = Array.from({ length: h }, (_, i) => i).filter(
    (y) => (petrifiedRows[y] ?? 0) === 0,
  )
  for (let i = rowOrder.length - 1; i > 0; i--) {
    const j = randIntBelow(i + 1)
    const a = rowOrder[i]
    const b = rowOrder[j]
    if (a === undefined || b === undefined) continue
    rowOrder[i] = b
    rowOrder[j] = a
  }
  for (const y of rowOrder) {
    // Mana-only: forced segment should pay mana, not gold.
    for (let ai = 0; ai < MANA_GEM_COLORS.length; ai++) {
      for (let bi = 0; bi < MANA_GEM_COLORS.length; bi++) {
        if (ai === bi) continue
        const colA = MANA_GEM_COLORS[ai]
        const colB = MANA_GEM_COLORS[bi]
        if (!colA || !colB) continue
        if (tryForceSegment(board, y, colA, colB)) {
          dematchExceptSegment(board, y)
          if (hasValidSwap(board, petrifiedRows)) return board
        }
      }
    }
  }
  // Should be unreachable for sensible board sizes; return board as-is.
  return board
}

function tryForceSegment(board: Cell[][], y: number, a: GemColor, b: GemColor): boolean {
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
      const choice = MANA_GEM_COLORS.find((c) => !forbidden.has(c))
      if (!choice) continue
      cur.gemColor = choice
    }
  }
}
