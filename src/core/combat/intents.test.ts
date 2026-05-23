import { beforeAll, describe, it, expect } from 'vitest'
import { rollIntent } from './intents'
import { getArchetype, registerArchetype } from './archetypeRegistry'

// Match the content def (`content/enemies.ts`) explicitly so tests don't
// cross the content/ boundary. Same pattern as pools.test mirroring the
// cascade table.
beforeAll(() => {
  registerArchetype({
    id: 'brute',
    name: 'Brute',
    maxHp: 20,
    pattern: ['attack', 'attack', 'block', 'attack'],
    attackRange: { min: 3, max: 5 },
    blockRange: { min: 3, max: 5 },
  })
})

const seed = { seed: 12345 }

describe('rollIntent', () => {
  it('follows the Brute pattern by index', () => {
    const pattern = getArchetype('brute').pattern
    // Walk one full pattern cycle plus a wrap.
    for (let i = 0; i < pattern.length * 2; i++) {
      const result = rollIntent('brute', i, { seed: 1 + i })
      expect(result.intent.kind).toBe(pattern[i % pattern.length])
    }
  })

  it('rolls numeric value inside archetype range', () => {
    const def = getArchetype('brute')
    let rng = seed
    for (let i = 0; i < 100; i++) {
      const result = rollIntent('brute', i, rng)
      rng = result.rng
      // Brute only rolls attack/block — no tile-burn in its pattern.
      if (result.intent.kind === 'tile-burn') {
        throw new Error('unexpected tile-burn from brute')
      }
      const range =
        result.intent.kind === 'attack' ? def.attackRange : def.blockRange
      expect(result.intent.amount).toBeGreaterThanOrEqual(range.min)
      expect(result.intent.amount).toBeLessThanOrEqual(range.max)
    }
  })

  it('is deterministic for the same seed', () => {
    const a = rollIntent('brute', 0, { seed: 42 })
    const b = rollIntent('brute', 0, { seed: 42 })
    expect(a).toEqual(b)
  })

  it('advances rng between calls', () => {
    const first = rollIntent('brute', 0, { seed: 7 })
    const second = rollIntent('brute', 1, first.rng)
    expect(second.rng.seed).not.toBe(first.rng.seed)
  })
})
