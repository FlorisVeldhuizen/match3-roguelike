import type {
  Cell,
  CellFlags,
  DrainedColor,
  GameEvent,
  HexedColor,
  PetrifiedRows,
  Pos,
} from '../../types'
import { nextInt, type RngState } from '../rng/mulberry32'

type FlagKey = keyof CellFlags

export function getFlag<K extends FlagKey>(
  cell: Cell | null | undefined,
  flag: K,
): NonNullable<CellFlags[K]> | undefined {
  return cell?.flags?.[flag] ?? undefined
}

export function hasFlag(cell: Cell | null | undefined, flag: FlagKey): boolean {
  return getFlag(cell, flag) !== undefined
}

export function setFlag<K extends FlagKey>(
  cell: Cell,
  flag: K,
  value: NonNullable<CellFlags[K]>,
): Cell {
  return { ...cell, flags: { ...cell.flags, [flag]: value } }
}

// Drops the `flags` bag entirely when empty (cleaner equality checks).
export function clearFlag<K extends FlagKey>(cell: Cell, flag: K): Cell {
  if (cell.flags === undefined) return cell
  if (cell.flags[flag] === undefined) return cell
  const { [flag]: _removed, ...rest } = cell.flags
  void _removed
  const hasOthers = Object.keys(rest).length > 0
  if (hasOthers) return { ...cell, flags: rest as CellFlags }
  const { flags: _f, ...cellWithoutFlags } = cell
  void _f
  return cellWithoutFlags
}

export function findFlaggedCells(
  board: readonly Cell[][],
  flag: FlagKey,
): Pos[] {
  const out: Pos[] = []
  for (let y = 0; y < board.length; y++) {
    const row = board[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      if (hasFlag(row[x], flag)) out.push({ x, y })
    }
  }
  return out
}

export type TickFlagResult = {
  board: Cell[][]
  events: GameEvent[]
}

export function tickFlagDuration(
  board: readonly Cell[][],
  flag: FlagKey,
): TickFlagResult {
  const touched: Pos[] = []
  const expired: Pos[] = []
  let anyChange = false
  const out: Cell[][] = board.map((row, y) =>
    row.map((cell, x) => {
      const current = getFlag(cell, flag)
      if (current === undefined) return cell
      anyChange = true
      touched.push({ x, y })
      const next = (current as number) - 1
      if (next <= 0) {
        expired.push({ x, y })
        return clearFlag(cell, flag)
      }
      return setFlag(cell, flag, next as NonNullable<CellFlags[FlagKey]>)
    }),
  )
  const events: GameEvent[] = []
  if (anyChange && touched.length > 0) {
    events.push({
      kind: 'cell-flag-ticked',
      positions: touched,
      expired,
      flag,
    })
  }
  return { board: anyChange ? out : (board as Cell[][]), events }
}

export function tickPetrifiedRows(
  petrifiedRows: PetrifiedRows,
): {
  petrifiedRows: PetrifiedRows
  expired: number[]
  events: GameEvent[]
} {
  const next: PetrifiedRows = {}
  const expired: number[] = []
  const events: GameEvent[] = []
  for (const [rowStr, turns] of Object.entries(petrifiedRows)) {
    const remaining = turns - 1
    const row = Number(rowStr)
    if (remaining > 0) next[row] = remaining
    else expired.push(row)
    events.push({ kind: 'petrify-row-ticked', row, remaining: Math.max(0, remaining) })
  }
  return { petrifiedRows: next, expired, events }
}

export function tickHexedColors(
  hexedColors: readonly HexedColor[],
): {
  hexedColors: HexedColor[]
  events: GameEvent[]
} {
  const next: HexedColor[] = []
  const events: GameEvent[] = []
  for (const h of hexedColors) {
    const remaining = h.turnsLeft - 1
    if (remaining > 0) next.push({ color: h.color, turnsLeft: remaining })
    events.push({
      kind: 'color-hex-ticked',
      color: h.color,
      remaining: Math.max(0, remaining),
    })
  }
  return { hexedColors: next, events }
}

export function tickDrainedColors(
  drainedColors: readonly DrainedColor[],
): {
  drainedColors: DrainedColor[]
  events: GameEvent[]
} {
  const next: DrainedColor[] = []
  const events: GameEvent[] = []
  for (const d of drainedColors) {
    const remaining = d.turnsLeft - 1
    if (remaining > 0) next.push({ ...d, turnsLeft: remaining })
    events.push({
      kind: 'color-drain-ticked',
      color: d.color,
      remaining: Math.max(0, remaining),
    })
  }
  return { drainedColors: next, events }
}

export function pickRandomCellsWithoutFlag(
  board: readonly Cell[][],
  flag: FlagKey,
  count: number,
  rng: RngState,
): { cells: Pos[]; rng: RngState } {
  const candidates: Pos[] = []
  for (let y = 0; y < board.length; y++) {
    const row = board[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      if (!hasFlag(row[x], flag)) candidates.push({ x, y })
    }
  }
  let curRng = rng
  const picked: Pos[] = []
  const remaining = candidates.slice()
  const target = Math.min(count, remaining.length)
  while (picked.length < target) {
    const [idx, nextR] = nextInt(curRng, remaining.length)
    curRng = nextR
    const chosen = remaining[idx]
    if (chosen) picked.push(chosen)
    remaining.splice(idx, 1)
  }
  return { cells: picked, rng: curRng }
}

export function pickClusterCellsWithoutFlag(
  board: readonly Cell[][],
  flag: FlagKey,
  count: number,
  rng: RngState,
): { cells: Pos[]; rng: RngState } {
  const candidates: Pos[] = []
  for (let y = 0; y < board.length; y++) {
    const row = board[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      if (!hasFlag(row[x], flag)) candidates.push({ x, y })
    }
  }
  if (candidates.length === 0 || count <= 0) {
    return { cells: [], rng }
  }
  let curRng = rng
  const target = Math.min(count, candidates.length)
  const candidateSet = new Set(candidates.map((p) => `${p.x},${p.y}`))
  const picked: Pos[] = []
  const pickedSet = new Set<string>()
  const frontier: Pos[] = []
  const [seedIdx, afterSeed] = nextInt(curRng, candidates.length)
  curRng = afterSeed
  const seed = candidates[seedIdx]
  if (!seed) return { cells: [], rng: curRng }
  picked.push(seed)
  pickedSet.add(`${seed.x},${seed.y}`)
  pushNeighbours(seed, candidateSet, pickedSet, frontier)

  while (picked.length < target && frontier.length > 0) {
    const [fIdx, afterPick] = nextInt(curRng, frontier.length)
    curRng = afterPick
    const next = frontier[fIdx]
    // O(1) swap-pop removal preserves the random-pick distribution.
    const lastF = frontier[frontier.length - 1]
    if (lastF) frontier[fIdx] = lastF
    frontier.pop()
    if (!next) continue
    const key = `${next.x},${next.y}`
    if (pickedSet.has(key)) continue
    picked.push(next)
    pickedSet.add(key)
    pushNeighbours(next, candidateSet, pickedSet, frontier)
  }

  // Fallback: fill remaining slots randomly if cluster can't grow.
  if (picked.length < target) {
    const remaining = candidates.filter((p) => !pickedSet.has(`${p.x},${p.y}`))
    while (picked.length < target && remaining.length > 0) {
      const [rIdx, afterR] = nextInt(curRng, remaining.length)
      curRng = afterR
      const r = remaining[rIdx]
      remaining.splice(rIdx, 1)
      if (r) {
        picked.push(r)
        pickedSet.add(`${r.x},${r.y}`)
      }
    }
  }
  return { cells: picked, rng: curRng }
}

function pushNeighbours(
  p: Pos,
  candidateSet: Set<string>,
  pickedSet: Set<string>,
  frontier: Pos[],
): void {
  const deltas = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const
  for (const [dx, dy] of deltas) {
    const nx = p.x + dx
    const ny = p.y + dy
    const key = `${nx},${ny}`
    if (!candidateSet.has(key)) continue
    if (pickedSet.has(key)) continue
    frontier.push({ x: nx, y: ny })
  }
}

export function applyFlagToCells<K extends FlagKey>(
  board: readonly Cell[][],
  positions: readonly Pos[],
  flag: K,
  value: NonNullable<CellFlags[K]>,
): Cell[][] {
  if (positions.length === 0) return board as Cell[][]
  const lookup = new Set(positions.map((p) => `${p.x},${p.y}`))
  return board.map((row, y) =>
    row.map((cell, x) => {
      if (!lookup.has(`${x},${y}`)) return cell
      return setFlag(cell, flag, value)
    }),
  )
}
