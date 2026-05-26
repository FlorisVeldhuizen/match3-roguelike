import type { Cell, CellFlags, GameEvent, PetrifiedRows, Pos } from '../../types'
import { nextInt, type RngState } from '../rng/mulberry32'

// Generic read/write/tick layer over `Cell.flags`. Phase F only uses the
// `burning` flag (Smolder's tile-burn verb), but the helpers stay flag-
// agnostic so Caster's hex, Defender's petrify, Swarmer's pending-shove,
// and J1's cursed all plug in via the same calls.

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

// Pure setter. Returns a new Cell with the flag set; never mutates input.
export function setFlag<K extends FlagKey>(
  cell: Cell,
  flag: K,
  value: NonNullable<CellFlags[K]>,
): Cell {
  return { ...cell, flags: { ...cell.flags, [flag]: value } }
}

// Pure clearer. Returns a new Cell with the flag removed. If no other
// flags remain, the `flags` bag itself is dropped to keep the shape tidy
// for equality checks in tests.
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

// Walks a board's cells; returns positions where the flag is set.
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

// Decrement a numeric flag's remaining duration by 1 across the whole
// board. Cells reaching 0 have the flag cleared. Returns an updated
// board and a list of positions where the flag was present before this
// tick (for UI animation / debug log purposes).
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

// H2b: tick the position-bound petrifiedRows map by one phase. Rows
// that hit 0 are removed from the map. Emits per-row `petrify-row-
// ticked` events (with the new `remaining` count) so the FX layer can
// drive its weakening → released animation hand-off on the animator's
// playback timeline rather than the synchronous store commit.
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

// Pick N cells from `rng` that don't already carry `flag` (Smolder won't
// re-burn cells that are already burning). Returns positions; caller
// applies the flag. If fewer than N unflagged cells exist, returns what
// it could find.
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

// Pick N cells in a CLUSTER without `flag` — seed at a random unflagged
// cell, then greedily pull in unflagged 4-neighbours (up/down/left/right)
// in random order until `count` cells are picked or no more reachable
// cells exist. Reads as "fireball lands HERE" rather than the spritzed
// look of N independent random picks. Falls back to filling from the
// rest of the unflagged pool at random if the cluster can't grow large
// enough (e.g. seed picked in an isolated pocket of flagged cells).
export function pickClusterCellsWithoutFlag(
  board: readonly Cell[][],
  flag: FlagKey,
  count: number,
  rng: RngState,
): { cells: Pos[]; rng: RngState } {
  // Build the unflagged candidate set up front (same scan as
  // pickRandomCellsWithoutFlag) so we can fall back to random picks if
  // the cluster growth gets stuck.
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
  // Build a lookup for "is (x,y) unflagged candidate" so neighbour
  // expansion can check membership in O(1).
  const candidateSet = new Set(candidates.map((p) => `${p.x},${p.y}`))
  const picked: Pos[] = []
  const pickedSet = new Set<string>()
  const frontier: Pos[] = []
  // Seed: pick a random candidate.
  const [seedIdx, afterSeed] = nextInt(curRng, candidates.length)
  curRng = afterSeed
  const seed = candidates[seedIdx]
  if (!seed) return { cells: [], rng: curRng }
  picked.push(seed)
  pickedSet.add(`${seed.x},${seed.y}`)
  pushNeighbours(seed, candidateSet, pickedSet, frontier)

  // Cluster growth: repeatedly pick a random cell from the frontier
  // (unflagged neighbours of already-picked cells). Random-from-frontier
  // gives the cluster an irregular, organic shape rather than a tight
  // BFS square — closer to how a real fireball would spread.
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

  // Fallback: cluster couldn't grow large enough (e.g. seed was
  // surrounded by flagged cells). Fill the remaining slots with random
  // unflagged cells from the rest of the board. Preserves the "we
  // promised N tiles" contract while still favouring cluster shape
  // when the board allows.
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

// Helper for pickClusterCellsWithoutFlag: push the 4-neighbours of
// `p` onto `frontier` if they're unflagged and not already picked.
// Duplicates within the frontier are allowed (cheap, harmless — the
// picked-set check above filters them out at expansion time).
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

// Apply a flag to multiple cells at once. Pure; returns a new board.
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
