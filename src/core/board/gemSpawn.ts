import { type GemColor, MANA_GEM_COLORS } from '../../types'
import { nextInt, type RngState } from '../rng/mulberry32'

// Spawn-rate tuning for the 6th gem colour. Gold is a rare "lucky drop":
// matching it pays gold directly (no mana). Tuned so a typical fight surfaces
// gold a handful of times — common enough to plan around, rare enough that
// non-gold matches stay the dominant economy.
//
// Distribution: 5/50 = 10% gold; remaining 45/50 split evenly across the 5
// mana colours = 9/50 = 18% each. Single RNG draw keeps the sequence tight
// (one nextInt per gem, same as the pre-gold code path).
const GOLD_WEIGHT = 5
const MANA_WEIGHT = 9 // 9 buckets × 5 colours = 45; 45 + 5 = 50 total

export function pickGemColorWeighted(rng: RngState): [GemColor, RngState] {
  const total = GOLD_WEIGHT + MANA_WEIGHT * MANA_GEM_COLORS.length
  const [n, advanced] = nextInt(rng, total)
  if (n < GOLD_WEIGHT) return ['gold', advanced]
  const idx = Math.floor((n - GOLD_WEIGHT) / MANA_WEIGHT)
  const color = MANA_GEM_COLORS[idx]
  if (!color) throw new Error('pickGemColorWeighted: oob index')
  return [color, advanced]
}

// Variant for sites that must avoid certain colours (board-gen anti-match,
// force-place pair generation). Falls back to the first allowed colour if
// the weighted draw landed on a forbidden one; this slightly reweights
// against gold in those tight spots, but those sites already need to pick
// freely without spawning a match, so consistency beats perfect uniformity.
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
