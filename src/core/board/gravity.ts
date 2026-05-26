import type { Cell, Pos } from '../../types'

export type GravityResult = {
  board: (Cell | null)[][]
  movements: { from: Pos; to: Pos }[]
}

export function applyGravity(board: (Cell | null)[][]): GravityResult {
  const h = board.length
  if (h === 0) return { board: [], movements: [] }
  const firstRow = board[0]
  if (!firstRow) return { board: [], movements: [] }
  const w = firstRow.length

  const out: (Cell | null)[][] = Array.from({ length: h }, () =>
    Array.from({ length: w }, () => null as Cell | null),
  )
  const movements: { from: Pos; to: Pos }[] = []

  for (let x = 0; x < w; x++) {
    let writeY = h - 1
    for (let y = h - 1; y >= 0; y--) {
      const row = board[y]
      if (!row) continue
      const cell = row[x]
      if (!cell) continue
      const targetRow = out[writeY]
      if (!targetRow) continue
      targetRow[x] = cell
      if (writeY !== y) movements.push({ from: { x, y }, to: { x, y: writeY } })
      writeY--
    }
  }

  return { board: out, movements }
}
