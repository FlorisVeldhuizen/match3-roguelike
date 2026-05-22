import { describe, it, expect, beforeAll } from 'vitest'
import type { GameEvent } from '../../types'
import {
  computeMatchPayouts,
  hasExtraTurnMatch,
  withPoolGainedEvents,
  ZERO_DELTAS,
} from './pools'
import { setCascadeMultipliers } from './multipliers'

beforeAll(() => {
  // Match the content table (`content/cascade.ts`) explicitly so tests don't
  // depend on import-side-effect ordering.
  setCascadeMultipliers([1, 1.5, 2, 3])
})

const cascadeStart = (level: number): GameEvent => ({
  kind: 'cascade-start',
  level,
})

const match = (
  color: 'red' | 'blue' | 'green' | 'yellow' | 'purple',
  size: number,
): GameEvent => ({
  kind: 'match-found',
  cells: [],
  color,
  size,
  shape: 'line',
})

describe('computeMatchPayouts', () => {
  it('returns zero deltas for an empty stream', () => {
    expect(computeMatchPayouts([])).toEqual(ZERO_DELTAS)
  })

  it('credits match.size to the matched color at cascade 0', () => {
    const events: GameEvent[] = [cascadeStart(0), match('red', 3)]
    expect(computeMatchPayouts(events)).toEqual({ ...ZERO_DELTAS, red: 3 })
  })

  it('applies the cascade multiplier floored', () => {
    // level 1 = 1.5x; 3 * 1.5 = 4.5 → floor 4
    const events: GameEvent[] = [cascadeStart(1), match('blue', 3)]
    expect(computeMatchPayouts(events)).toEqual({ ...ZERO_DELTAS, blue: 4 })
  })

  it('sums across multiple cascade levels and colors', () => {
    const events: GameEvent[] = [
      cascadeStart(0),
      match('red', 3), // 3
      match('blue', 4), // 4
      cascadeStart(1),
      match('green', 3), // floor(3 * 1.5) = 4
      cascadeStart(2),
      match('yellow', 5), // 5 * 2 = 10
      cascadeStart(3),
      match('purple', 3), // 3 * 3 = 9
      cascadeStart(4),
      match('red', 3), // clamps to last entry (3) → 9
    ]
    expect(computeMatchPayouts(events)).toEqual({
      red: 12,
      blue: 4,
      green: 4,
      yellow: 10,
      purple: 9,
    })
  })
})

describe('hasExtraTurnMatch', () => {
  it('false on no matches', () => {
    expect(hasExtraTurnMatch([cascadeStart(0)])).toBe(false)
  })

  it('false when all matches are size 3', () => {
    expect(hasExtraTurnMatch([match('red', 3), match('blue', 3)])).toBe(false)
  })

  it('true when any match is size >= 4', () => {
    expect(hasExtraTurnMatch([match('red', 3), match('blue', 4)])).toBe(true)
    expect(hasExtraTurnMatch([match('green', 5)])).toBe(true)
  })
})

describe('withPoolGainedEvents', () => {
  it('inserts pool-gained after each match-found', () => {
    const input: GameEvent[] = [
      cascadeStart(0),
      match('red', 3),
      match('blue', 4),
    ]
    const out = withPoolGainedEvents(input)
    expect(out.map((e) => e.kind)).toEqual([
      'cascade-start',
      'match-found',
      'pool-gained',
      'match-found',
      'pool-gained',
    ])
    const pools = out.filter((e) => e.kind === 'pool-gained')
    expect(pools[0]).toMatchObject({ color: 'red', amount: 3 })
    expect(pools[1]).toMatchObject({ color: 'blue', amount: 4 })
  })

  it('reflects cascade-level multipliers', () => {
    const input: GameEvent[] = [cascadeStart(2), match('red', 3)]
    const out = withPoolGainedEvents(input)
    expect(out[out.length - 1]).toMatchObject({
      kind: 'pool-gained',
      color: 'red',
      amount: 6, // 3 * 2.0
    })
  })
})
