import { type GemColor, MANA_GEM_COLORS } from '../../types'
import { nextInt, type RngState } from '../rng/mulberry32'

// 10% gold (5/50), 18% each mana colour (9/50). Single RNG draw per gem.
const GOLD_WEIGHT = 5
const MANA_WEIGHT = 9

export function pickGemColorWeighted(rng: RngState): [GemColor, RngState] {
  const total = GOLD_WEIGHT + MANA_WEIGHT * MANA_GEM_COLORS.length
  const [n, advanced] = nextInt(rng, total)
  if (n < GOLD_WEIGHT) return ['gold', advanced]
  const idx = Math.floor((n - GOLD_WEIGHT) / MANA_WEIGHT)
  const color = MANA_GEM_COLORS[idx]
  if (!color) throw new Error('pickGemColorWeighted: oob index')
  return [color, advanced]
}

export function pickGemColorAvoiding(
  rng: RngState,
  forbidden: ReadonlySet<GemColor>,
): [GemColor, RngState] {
  const [picked, advanced] = pickGemColorWeighted(rng)
  if (!forbidden.has(picked)) return [picked, advanced]
  for (const c of MANA_GEM_COLORS) {
    if (!forbidden.has(c)) return [c, advanced]
  }
  if (!forbidden.has('gold')) return ['gold', advanced]
  throw new Error('pickGemColorAvoiding: all colours forbidden')
}
