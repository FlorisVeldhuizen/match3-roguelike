import type { Cell, GemColor, Match, MatchShape, Pos } from '../../types'

type Run = {
  cells: Pos[]
  orientation: 'h' | 'v'
  color: GemColor
}

const keyOf = (p: Pos) => `${p.x},${p.y}`

function findRuns(board: Cell[][]): Run[] {
  const runs: Run[] = []
  const h = board.length
  if (h === 0) return runs
  const firstRow = board[0]
  if (!firstRow) return runs
  const w = firstRow.length

  for (let y = 0; y < h; y++) {
    const row = board[y]
    if (!row) continue
    let x = 0
    while (x < w) {
      const startCell = row[x]
      if (!startCell) {
        x++
        continue
      }
      const color = startCell.gemColor
      const start = x
      while (x < w) {
        const c = row[x]
        if (!c || c.gemColor !== color) break
        x++
      }
      if (x - start >= 3) {
        const cells: Pos[] = []
        for (let xi = start; xi < x; xi++) cells.push({ x: xi, y })
        runs.push({ cells, orientation: 'h', color })
      }
    }
  }

  for (let x = 0; x < w; x++) {
    let y = 0
    while (y < h) {
      const row = board[y]
      if (!row) {
        y++
        continue
      }
      const startCell = row[x]
      if (!startCell) {
        y++
        continue
      }
      const color = startCell.gemColor
      const start = y
      while (y < h) {
        const r = board[y]
        if (!r) break
        const c = r[x]
        if (!c || c.gemColor !== color) break
        y++
      }
      if (y - start >= 3) {
        const cells: Pos[] = []
        for (let yi = start; yi < y; yi++) cells.push({ x, y: yi })
        runs.push({ cells, orientation: 'v', color })
      }
    }
  }
  return runs
}

// Union-find on runs that share cells of the same color.
function groupRuns(runs: Run[]): Run[][] {
  const parent: number[] = runs.map((_, i) => i)
  const find = (i: number): number => {
    let n = i
    while (parent[n] !== undefined && parent[n] !== n) {
      const p = parent[n]
      if (p === undefined) break
      n = p
    }
    return n
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }

  // cellKey → runIndex (first run that owns it; subsequent are unioned).
  const cellToRun = new Map<string, number>()
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]
    if (!run) continue
    for (const c of run.cells) {
      const k = keyOf(c)
      const owner = cellToRun.get(k)
      if (owner === undefined) {
        cellToRun.set(k, i)
      } else {
        const ownerRun = runs[owner]
        if (ownerRun && ownerRun.color === run.color) union(owner, i)
      }
    }
  }

  const groups = new Map<number, Run[]>()
  for (let i = 0; i < runs.length; i++) {
    const root = find(i)
    const list = groups.get(root) ?? []
    const r = runs[i]
    if (r) list.push(r)
    groups.set(root, list)
  }
  return [...groups.values()]
}

function isEndCell(run: Run, cell: Pos): boolean {
  const first = run.cells[0]
  const last = run.cells[run.cells.length - 1]
  if (!first || !last) return false
  const k = keyOf(cell)
  return keyOf(first) === k || keyOf(last) === k
}

function classify(group: Run[]): { shape: MatchShape; cells: Pos[] } {
  const cellMap = new Map<string, Pos>()
  for (const r of group) for (const c of r.cells) cellMap.set(keyOf(c), c)
  const cells = [...cellMap.values()]

  if (group.length === 1) {
    return { shape: 'line', cells }
  }

  // Find any H/V intersection. Classify T vs L by whether the intersection
  // is at the end of BOTH runs (L) or interior of at least one (T).
  const hs = group.filter((r) => r.orientation === 'h')
  const vs = group.filter((r) => r.orientation === 'v')
  let sawInterior = false
  for (const hr of hs) {
    const hSet = new Set(hr.cells.map(keyOf))
    for (const vr of vs) {
      for (const c of vr.cells) {
        if (!hSet.has(keyOf(c))) continue
        const endOfH = isEndCell(hr, c)
        const endOfV = isEndCell(vr, c)
        if (!(endOfH && endOfV)) sawInterior = true
      }
    }
  }
  return { shape: sawInterior ? 'T' : 'L', cells }
}

export function detectMatches(board: Cell[][]): Match[] {
  const runs = findRuns(board)
  const groups = groupRuns(runs)
  const matches: Match[] = []
  for (const group of groups) {
    const first = group[0]
    if (!first) continue
    const { shape, cells } = classify(group)
    matches.push({ cells, color: first.color, size: cells.length, shape })
  }
  return matches
}

export function hasAnyMatch(board: Cell[][]): boolean {
  return findRuns(board).length > 0
}
