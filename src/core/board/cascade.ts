import {
  type Cell,
  type GameEvent,
  type GemColor,
  type Pos,
  GEM_COLORS,
} from '../../types'
import { detectMatches } from './detectMatches'
import { applyGravity } from './gravity'
import { nextInt, type RngState } from '../rng/mulberry32'

export type SwapResolution = {
  valid: boolean
  board: Cell[][]
  rng: RngState
  events: GameEvent[]
}

const cloneBoard = (board: Cell[][]): Cell[][] =>
  board.map((row) => row.map((c) => ({ gemColor: c.gemColor })))

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
// special-clear extensions: 5-line clears whole row/col of that color;
// T clears a 3×3 area around the intersection; L clears a +-shape
// around the intersection.
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

    if (m.shape === 'line' && m.size >= 5) {
      // Determine orientation.
      const horizontal = m.cells.every((c) => c.y === m.cells[0]?.y)
      if (horizontal && m.cells[0]) {
        const y = m.cells[0].y
        for (let x = 0; x < w; x++) {
          if (board[y]?.[x]?.gemColor === m.color) out.add(keyOf({ x, y }))
        }
      } else if (m.cells[0]) {
        const x = m.cells[0].x
        for (let y = 0; y < h; y++) {
          if (board[y]?.[x]?.gemColor === m.color) out.add(keyOf({ x, y }))
        }
      }
    }

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
): SwapResolution {
  const events: GameEvent[] = [{ kind: 'swap', from, to }]
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
      events.push({
        kind: 'match-found',
        cells: m.cells,
        color: m.color,
        size: m.size,
        shape: m.shape,
      })
    }

    const clearSet = expandClears(board, matches)
    const clearedCells: Pos[] = []
    const cleared: (Cell | null)[][] = board.map((row, y) =>
      row.map((c, x) => {
        if (clearSet.has(keyOf({ x, y }))) {
          clearedCells.push({ x, y })
          return null
        }
        return c
      }),
    )
    events.push({ kind: 'gems-cleared', cells: clearedCells })

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

    board = refilled
    level++
    matches = detectMatches(board)
  }

  // `level` was post-incremented at the bottom of every iteration, so it
  // equals the total chain depth: 1 = just the initial match, 2+ = chain.
  events.push({ kind: 'cascade-complete', levels: level })

  return { valid: true, board, rng: curRng, events }
}
