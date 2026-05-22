import {
  type Cell,
  type GemColor,
  BOARD_HEIGHT,
  BOARD_WIDTH,
  GEM_COLORS,
} from '../../types'

export type Rand = () => number

export function generateBoard(
  width: number = BOARD_WIDTH,
  height: number = BOARD_HEIGHT,
  rand: Rand = Math.random,
): Cell[][] {
  const rows: Cell[][] = []
  for (let y = 0; y < height; y++) {
    const row: Cell[] = []
    for (let x = 0; x < width; x++) {
      row.push({ gemColor: pickColor(rand), flags: {} })
    }
    rows.push(row)
  }
  return rows
}

function pickColor(rand: Rand): GemColor {
  const idx = Math.floor(rand() * GEM_COLORS.length)
  const color = GEM_COLORS[idx]
  if (color === undefined) throw new Error('GEM_COLORS empty')
  return color
}
