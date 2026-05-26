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
  // H2b: optional petrify map. The post-cascade regen path in
  // actions/swap.ts can call generateBoard while a Defender's
  // petrify-row lockout is still active; without threading this in,
  // the internal hasValidSwap check would happily accept a board
  // whose only valid swaps sit on the locked row — which from the
  // player's perspective is still a no-moves state. Defaults to
  // empty so existing boot / new-fight callers (which have no
  // petrify state) behave unchanged.
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

function fillAndDematch(
  width: number,
  height: number,
  randColor: () => GemColor,
): Cell[][] {
  const board: Cell[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({ gemColor: randColor() })),
  )
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const forbidden = forbiddenColorsAt(board, x, y)
      const current = board[y]?.[x]
      if (!current) throw new Error('fill: missing cell')
      if (!forbidden.has(current.gemColor)) continue
      // Anti-match fallback walks the mana colours first (never gold),
      // so de-matching can never spawn a forced gold cluster during
      // initial board cleanup.
      const choice = MANA_GEM_COLORS.find((c) => !forbidden.has(c))
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

// H2b: optional petrifiedRows respected as a SWAP gate. A swap whose
// origin or target sits on a locked row is invalid — the gem itself is
// stuck. Matches can still flow THROUGH a petrified row when anchored
// elsewhere; that case is unaffected by this function.
export function hasValidSwap(
  board: Cell[][],
  petrifiedRows: Readonly<Record<number, number>> = {},
): boolean {
  const h = board.length
  const w = board[0]?.length ?? 0
  for (let y = 0; y < h; y++) {
    if ((petrifiedRows[y] ?? 0) > 0) continue // gems in this row are stuck
    for (let x = 0; x < w; x++) {
      // Try swap right (same row, so already petrify-checked above).
      if (x + 1 < w) {
        if (swapMakesMatch(board, x, y, x + 1, y)) return true
      }
      // Try swap down — target row must also be unpetrified.
      if (y + 1 < h && (petrifiedRows[y + 1] ?? 0) === 0) {
        if (swapMakesMatch(board, x, y, x, y + 1)) return true
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
    if ((petrifiedRows[y] ?? 0) > 0) continue
    for (let x = 0; x < w; x++) {
      if (x + 1 < w && swapMakesMatch(board, x, y, x + 1, y)) {
        out.push({ from: { x, y }, to: { x: x + 1, y } })
      }
      if (
        y + 1 < h &&
        (petrifiedRows[y + 1] ?? 0) === 0 &&
        swapMakesMatch(board, x, y, x, y + 1)
      ) {
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
): boolean {
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

// Last-resort: force a row's first 4 cells to [A,B,A,B] with A,B chosen so
// they don't form matches with cells above or to the right. Then re-clean
// the rest of the board (preserving the forced segment).
function forcePlaceSwap(
  board: Cell[][],
  randIntBelow: (max: number) => number,
  // H2b: skip petrified rows when picking the "force placement" row —
  // and use the petrify-aware hasValidSwap check at the end, so the
  // forced board is genuinely playable under the active lockout.
  petrifiedRows: Readonly<Record<number, number>> = {},
): Cell[][] {
  const h = board.length
  const w = board[0]?.length ?? 0
  if (w < 4 || h === 0) return board
  // Try rows in randomized order until placement works. Skip rows that
  // are currently under a petrify lockout — placing the forced segment
  // there would just trip the lockout gate in hasValidSwap.
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
    // Force-place pairs are drawn from MANA_GEM_COLORS only — a guaranteed
    // playable segment should pay mana on the first swap, not gold.
    for (let ai = 0; ai < MANA_GEM_COLORS.length; ai++) {
      for (let bi = 0; bi < MANA_GEM_COLORS.length; bi++) {
        if (ai === bi) continue
        const colA = MANA_GEM_COLORS[ai]
        const colB = MANA_GEM_COLORS[bi]
        if (!colA || !colB) continue
        if (tryForceSegment(board, y, colA, colB)) {
          // Re-clean rest of board (preserving forced segment).
          dematchExceptSegment(board, y)
          if (hasValidSwap(board, petrifiedRows)) return board
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
      // Same rationale as fillAndDematch: anti-match fallback walks the
      // mana colours first so re-cleaning can't manufacture gold runs.
      const choice = MANA_GEM_COLORS.find((c) => !forbidden.has(c))
      if (!choice) continue
      cur.gemColor = choice
    }
  }
}
