import { describe, expect, it } from 'vitest'
import {
  TRAIL_MAX_MS,
  TRAIL_MIN_MS,
  TRAIL_SHORT_HOP_MIN_MS,
  trailDurationBetween,
  trailDurationMs,
} from './timing'

describe('trailDurationMs', () => {
  it('uses a lower floor for very short hops (status chip → bar)', () => {
    expect(trailDurationMs(70)).toBe(TRAIL_SHORT_HOP_MIN_MS)
    expect(trailDurationMs(70, 'status-proc')).toBe(TRAIL_SHORT_HOP_MIN_MS)
  })

  it('slows pool-earn trails so board → HUD reads clearly', () => {
    const base = trailDurationMs(420)
    const pool = trailDurationMs(420, 'pool-earn')
    expect(pool).toBeGreaterThan(base)
    expect(pool).toBeGreaterThanOrEqual(580)
  })

  it('speeds spell-effect trails relative to pool-earn at same distance', () => {
    const pool = trailDurationMs(380, 'pool-earn')
    const spell = trailDurationMs(380, 'spell-effect')
    expect(spell).toBeLessThan(pool)
  })

  it('scales mid-range distances toward TRAIL_ARRIVAL_MS', () => {
    expect(trailDurationMs(400)).toBeGreaterThanOrEqual(490)
    expect(trailDurationMs(680, 'pool-earn')).toBe(TRAIL_MAX_MS)
  })

  it('clamps to TRAIL_MAX_MS for long flights', () => {
    expect(trailDurationMs(1200, 'pool-earn')).toBe(TRAIL_MAX_MS)
  })

  it('respects the standard minimum above the short-hop threshold', () => {
    expect(trailDurationMs(150)).toBeGreaterThanOrEqual(TRAIL_MIN_MS)
  })
})

describe('trailDurationBetween', () => {
  it('matches straight-line distance', () => {
    expect(trailDurationBetween({ x: 0, y: 0 }, { x: 300, y: 400 })).toBe(
      trailDurationMs(500),
    )
  })
})
