import { describe, expect, it } from 'vitest'

import { pickGemColorAvoiding, pickGemColorWeighted } from './gemSpawn'
import type { GemColor } from '../../types'

// Statistical sanity check on the gold/non-gold split. With 50k draws the
// 99.99% binomial interval around p=0.10 is roughly ±0.6% — generous bands
// catch a totally broken weighting (e.g. 16.7% or 0%) without flaking on
// honest variance.
describe('pickGemColorWeighted', () => {
  it('spawns gold at ~10% and other colours at ~18% each', () => {
    const counts: Record<GemColor, number> = {
      red: 0,
      blue: 0,
      green: 0,
      yellow: 0,
      purple: 0,
      gold: 0,
    }
    let rng = { seed: 42 }
    const N = 50_000
    for (let i = 0; i < N; i++) {
      const [color, next] = pickGemColorWeighted(rng)
      counts[color] += 1
      rng = next
    }
    // Gold: 10% ± 1%
    expect(counts.gold / N).toBeGreaterThan(0.085)
    expect(counts.gold / N).toBeLessThan(0.115)
    // Each mana colour: 18% ± 1.5% (slightly wider since 5 buckets share
    // 90% — individual variance is higher than the gold-vs-rest split).
    for (const c of ['red', 'blue', 'green', 'yellow', 'purple'] as const) {
      expect(counts[c] / N).toBeGreaterThan(0.165)
      expect(counts[c] / N).toBeLessThan(0.195)
    }
  })

  it('is deterministic for the same seed', () => {
    const drawN = (seed: number, n: number): GemColor[] => {
      let rng = { seed }
      const out: GemColor[] = []
      for (let i = 0; i < n; i++) {
        const [color, next] = pickGemColorWeighted(rng)
        out.push(color)
        rng = next
      }
      return out
    }
    expect(drawN(7, 100)).toEqual(drawN(7, 100))
  })

  it('never picks gold when forbidden', () => {
    let rng = { seed: 99 }
    for (let i = 0; i < 1000; i++) {
      const [color, next] = pickGemColorAvoiding(rng, new Set(['gold']))
      expect(color).not.toBe('gold')
      rng = next
    }
  })
})
