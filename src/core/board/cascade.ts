import {
  type Cell,
  type GameEvent,
  type GemColor,
  type Pos,
  GEM_COLORS,
} from '../../types'
import { detectMatches } from './detectMatches'
import { applyFlagToCells, hasFlag } from './flags'
import { applyGravity } from './gravity'
import { nextInt, type RngState } from '../rng/mulberry32'

export type SwapResolution = {
  valid: boolean
  board: Cell[][]
  rng: RngState
  events: GameEvent[]
}

// Shallow clone per row; cells themselves are not cloned because the
// pure flag helpers always return a new Cell when they mutate. Preserves
// `flags` so the burning/petrified/etc. state carries through a swap.
const cloneBoard = (board: Cell[][]): Cell[][] =>
  board.map((row) => row.slice())

const swapInPlace = (board: Cell[][], a: Pos, b: Pos) => {
  const rowA = board[a.y]
  const rowB = board[b.y]
  if (!rowA || !rowB) throw new Error('swap: oob row')
  const ca = rowA[a.x]
  const cb = rowB[b.x]
  if (!ca || !cb) throw new Error('swap: oob cell')
  rowA[a.x] = cb
  rowB[b.x] = ca
}

const keyOf = (p: Pos) => `${p.x},${p.y}`

// Compute the full set of cells to clear for a cascade step, including
// special-clear extensions: T clears a 3×3 area around the intersection;
// L clears a +-shape around the intersection. Line-5 used to extend to
// the whole row/col but now flags the cleared cells as Blessed instead
// (see resolveSwap and PLANNING/01-design.md §Blessed cells).
function expandClears(
  board: Cell[][],
  matches: ReturnType<typeof detectMatches>,
): Set<string> {
  const out = new Set<string>()
  const h = board.length
  const firstRow = board[0]
  const w = firstRow?.length ?? 0
  for (const m of matches) {
    for (const c of m.cells) out.add(keyOf(c))

    if (m.shape === 'T' || m.shape === 'L') {
      // Intersection = the cell shared by H and V runs. Recover it as the
      // cell that has at least one same-color neighbor in BOTH axes within
      // the match-cell set.
      const set = new Set(m.cells.map(keyOf))
      const has = (p: Pos) => set.has(keyOf(p))
      let intersection: Pos | null = null
      for (const c of m.cells) {
        const horizNeighbor =
          has({ x: c.x - 1, y: c.y }) || has({ x: c.x + 1, y: c.y })
        const vertNeighbor =
          has({ x: c.x, y: c.y - 1 }) || has({ x: c.x, y: c.y + 1 })
        if (horizNeighbor && vertNeighbor) {
          intersection = c
          break
        }
      }
      if (intersection) {
        if (m.shape === 'T') {
          // 3×3 area around intersection.
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const x = intersection.x + dx
              const y = intersection.y + dy
              if (x >= 0 && y >= 0 && x < w && y < h) {
                out.add(keyOf({ x, y }))
              }
            }
          }
        } else {
          // +-shape: intersection + 4 cardinal neighbors.
          const offsets = [
            { dx: 0, dy: 0 },
            { dx: 1, dy: 0 },
            { dx: -1, dy: 0 },
            { dx: 0, dy: 1 },
            { dx: 0, dy: -1 },
          ]
          for (const { dx, dy } of offsets) {
            const x = intersection.x + dx
            const y = intersection.y + dy
            if (x >= 0 && y >= 0 && x < w && y < h) {
              out.add(keyOf({ x, y }))
            }
          }
        }
      }
    }
  }
  return out
}

export function resolveSwap(
  startBoard: Cell[][],
  rng: RngState,
  from: Pos,
  to: Pos,
  // H2b: petrified rows are a SWAP gate. Gems on a locked row are
  // stuck — neither the swap origin nor the swap target may sit on
  // such a row. Matches still cascade THROUGH petrified rows when
  // anchored elsewhere; only the swap itself is gated.
  petrifiedRows: Readonly<Record<number, number>> = {},
): SwapResolution {
  const events: GameEvent[] = [{ kind: 'swap', from, to }]
  // Reject the swap up-front if either end is on a locked row. The
  // revert event lets the UI play the same "snap back" animation as
  // a no-match swap; gameplay-wise this is just another invalid swap.
  if (
    (petrifiedRows[from.y] ?? 0) > 0 ||
    (petrifiedRows[to.y] ?? 0) > 0
  ) {
    events.push({ kind: 'swap-reverted', from, to })
    return { valid: false, board: startBoard, rng, events }
  }
  const trial = cloneBoard(startBoard)
  swapInPlace(trial, from, to)
  const initialMatches = detectMatches(trial)
  if (initialMatches.length === 0) {
    events.push({ kind: 'swap-reverted', from, to })
    return { valid: false, board: startBoard, rng, events }
  }

  let board = trial
  let curRng = rng
  let level = 0
  let matches = initialMatches
  while (matches.length > 0) {
    events.push({ kind: 'cascade-start', level })
    for (const m of matches) {
      // `blessed` is computed against the pre-clear board because the flag
      // is wiped by the upcoming clear step. The store reads this flag to
      // apply the 2× pool-delta multiplier on the per-match payload.
      const hasBlessed = m.cells.some((c) => hasFlag(board[c.y]?.[c.x], 'blessed'))
      events.push({
        kind: 'match-found',
        cells: m.cells,
        color: m.color,
        size: m.size,
        shape: m.shape,
        ...(hasBlessed ? { blessed: true } : {}),
      })
    }

    // Line-5 matches flag the cleared cells as Blessed. Collected here so
    // we can re-apply the flag after gravity + refill — the cleared cells
    // are null at the moment of clear, so the flag can only attach once a
    // gem has dropped into / been spawned into the position. Multiple
    // line-5s in the same step union their positions naturally via the
    // Set semantics (a position is either targeted or not, no stacking).
    const blessTargets: Pos[] = []
    for (const m of matches) {
      if (m.shape === 'line' && m.size >= 5) {
        blessTargets.push(...m.cells)
      }
    }

    const clearSet = expandClears(board, matches)
    const clearedCells: Pos[] = []
    // Burning cells cleared this step → each applies 1 stack of Burn to
    // the player (02-scope §Smolder verb). Sum during the same walk to
    // avoid a second pass.
    const burningCleared: Pos[] = []
    // Blessed cells cleared this step → emit blessed-match-triggered for
    // the FX/audio layer. The math-side 2× lives on match-found.blessed
    // above; this event is purely a consumption notification (mirrors
    // tile-burn-triggered's role).
    const blessedCleared: Pos[] = []
    const cleared: (Cell | null)[][] = board.map((row, y) =>
      row.map((c, x) => {
        if (clearSet.has(keyOf({ x, y }))) {
          clearedCells.push({ x, y })
          if (c?.flags?.burning && c.flags.burning > 0) {
            burningCleared.push({ x, y })
          }
          if (c?.flags?.blessed) {
            blessedCleared.push({ x, y })
          }
          return null
        }
        return c
      }),
    )
    events.push({ kind: 'gems-cleared', cells: clearedCells })
    if (burningCleared.length > 0) {
      events.push({
        kind: 'tile-burn-triggered',
        cells: burningCleared,
      })
    }
    if (blessedCleared.length > 0) {
      events.push({
        kind: 'blessed-match-triggered',
        cells: blessedCleared,
        count: blessedCleared.length,
      })
    }

    const { board: fallen, movements } = applyGravity(cleared)
    if (movements.length > 0) events.push({ kind: 'gems-fell', movements })

    const spawns: { at: Pos; color: GemColor }[] = []
    // Inlined nextInt for refill — saves one allocation per gem (the
    // pickColor wrapper used to return its own [color, rng] tuple on top
    // of nextInt's tuple). A full 8×8 board refill on a cascade walks 64
    // gems, so this matters during deep chains.
    const refilled: Cell[][] = fallen.map((row, y) =>
      row.map((c, x): Cell => {
        if (c) return c
        const [idx, nr] = nextInt(curRng, GEM_COLORS.length)
        curRng = nr
        const color = GEM_COLORS[idx]
        if (!color) throw new Error('cascade: refill color oob')
        spawns.push({ at: { x, y }, color })
        return { gemColor: color }
      }),
    )
    if (spawns.length > 0) events.push({ kind: 'gems-spawned', spawns })

    // Apply blessed flag to the line-5 target positions on the freshly
    // refilled board. The match-found event for each line-5 carries the
    // color, but for FX purposes a single tile-blessed-placed per cascade
    // step is enough — group by color when there's exactly one line-5,
    // fall back to the first match's color when multiple line-5s of
    // different colors land together (rare; FX layer can still anchor on
    // positions regardless of color).
    let blessedBoard = refilled
    if (blessTargets.length > 0) {
      blessedBoard = applyFlagToCells(refilled, blessTargets, 'blessed', true)
      const fiveLines = matches.filter((m) => m.shape === 'line' && m.size >= 5)
      const color = fiveLines[0]?.color ?? matches[0]?.color
      if (color) {
        events.push({
          kind: 'tile-blessed-placed',
          cells: blessTargets,
          color,
        })
      }
    }

    board = blessedBoard
    level++
    matches = detectMatches(board)
  }

  // `level` was post-incremented at the bottom of every iteration, so it
  // equals the total chain depth: 1 = just the initial match, 2+ = chain.
  events.push({ kind: 'cascade-complete', levels: level })

  return { valid: true, board, rng: curRng, events }
}
