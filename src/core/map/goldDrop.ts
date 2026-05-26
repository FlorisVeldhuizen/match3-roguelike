import type { MapNode } from '../../types'
import { nextInt, type RngState } from '../rng/mulberry32'

const GOLD_DROP_RANGES: Record<string, { min: number; max: number }> = {
  'fight-col0': { min: 10, max: 15 },
  'fight-col1': { min: 10, max: 15 },
  'fight-col2': { min: 15, max: 20 },
  'fight-col3': { min: 20, max: 25 },
  elite: { min: 35, max: 50 },
  boss: { min: 0, max: 0 },
}

export function rollGoldDrop(
  node: MapNode,
  rng: RngState,
): { gold: number; rng: RngState } {
  const key = keyFor(node)
  const range = GOLD_DROP_RANGES[key]
  if (!range || range.max === 0) return { gold: range?.min ?? 0, rng }
  const span = range.max - range.min + 1
  const [n, advanced] = nextInt(rng, span)
  return { gold: range.min + n, rng: advanced }
}

function keyFor(node: MapNode): string {
  if (node.kind === 'boss') return 'boss'
  if (node.kind === 'elite') return 'elite'
  if (node.kind === 'fight') {
    if (node.column <= 1) return 'fight-col0'
    if (node.column === 2) return 'fight-col2'
    return 'fight-col3'
  }
  return 'shop-rest'
}
