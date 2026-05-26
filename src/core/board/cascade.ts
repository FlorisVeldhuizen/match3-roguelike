import {
  type Cell,
  type GameEvent,
  type GemColor,
  type Match,
  type Pos,
} from '../../types'
import { detectMatches } from './detectMatches'
import { applyFlagToCells, hasFlag } from './flags'
import { pickGemColorWeighted } from './gemSpawn'
import { applyGravity } from './gravity'
import { type RngState } from '../rng/mulberry32'

export type SwapResolution = {
  valid: boolean
  board: Cell[][]
  rng: RngState
  events: GameEvent[]
}

// Shallow clone — flag helpers always return new Cells, so row.slice() suffices.
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
      // Intersection = cell with same-color neighbors in both axes.
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
  petrifiedRows: Readonly<Record<number, number>> = {},
): SwapResolution {
  const events: GameEvent[] = [{ kind: 'swap', from, to }]
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

  const cascadeResult = runCascade(trial, rng, initialMatches)
  events.push(...cascadeResult.events)
  return {
    valid: true,
    board: cascadeResult.board,
    rng: cascadeResult.rng,
    events,
  }
}

export function runCascade(
  startBoard: Cell[][],
  rng: RngState,
  initialMatches: Match[],
): { board: Cell[][]; rng: RngState; events: GameEvent[] } {
  const events: GameEvent[] = []
  let board = startBoard
  let curRng = rng
  let level = 0
  let matches = initialMatches
  while (matches.length > 0) {
    events.push({ kind: 'cascade-start', level })
    for (const m of matches) {
      // Read blessed before clear wipes the flag (drives 2× multiplier).
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

    // Collect line-5 blessed targets now; flag applied after gravity+refill.
    // Shatter matches excluded — they'd bless the entire refilled set.
    const blessTargets: Pos[] = []
    for (const m of matches) {
      if (m.shape === 'line' && m.size >= 5) {
        blessTargets.push(...m.cells)
      }
    }

    const clearSet = expandClears(board, matches)
    const clearedCells: Pos[] = []
    const burningCleared: Pos[] = []
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
    const refilled: Cell[][] = fallen.map((row, y) =>
      row.map((c, x): Cell => {
        if (c) return c
        const [color, nr] = pickGemColorWeighted(curRng)
        curRng = nr
        spawns.push({ at: { x, y }, color })
        return { gemColor: color }
      }),
    )
    if (spawns.length > 0) events.push({ kind: 'gems-spawned', spawns })

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

  // level = total chain depth (1 = initial match only, 2+ = chain).
  events.push({ kind: 'cascade-complete', levels: level })

  return { board, rng: curRng, events }
}
