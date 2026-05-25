import { beforeAll, describe, it, expect } from 'vitest'
import { rollIntent } from './intents'
import { getArchetype, registerArchetype } from './archetypeRegistry'
import type { Enemy } from '../../types'

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
  registerArchetype({
    id: 'rallier',
    name: 'Rallier',
    maxHp: 11,
    pattern: ['attack', 'buff-ally', 'attack'],
    attackRange: { min: 1, max: 2 },
    blockRange: { min: 0, max: 0 },
    buffAllyStacks: 2,
  })
})

const makeEnemy = (id: string, archetype: Enemy['archetype'] = 'brute'): Enemy => ({
  id,
  name: 'Test',
  archetype,
  hp: 10,
  maxHp: 10,
  block: 0,
  currentIntent: { kind: 'attack', amount: 3 },
  nextIntentIndex: 0,
  statuses: [],
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

describe('rollIntent — ally-target intents', () => {
  it('buff-ally intent picks a sibling as targetAllyId', () => {
    const roller = makeEnemy('rallier-1', 'rallier')
    const ally = makeEnemy('ally-1')
    // pattern index 1 → 'buff-ally'
    const result = rollIntent('rallier', 1, { seed: 42 }, [roller, ally], roller.id)
    expect(result.intent.kind).toBe('buff-ally')
    if (result.intent.kind === 'buff-ally') {
      expect(result.intent.targetAllyId).toBe('ally-1')
      expect(result.intent.stacks).toBe(2) // buffAllyStacks default
    }
  })

  it('buff-ally falls back to attack when no living siblings', () => {
    const roller = makeEnemy('rallier-1', 'rallier')
    // No siblings passed (or all dead) → fallback to attack.
    const result = rollIntent('rallier', 1, { seed: 42 }, [roller], roller.id)
    expect(result.intent.kind).toBe('attack')
  })

  it('ally-target intent is deterministic for the same seed', () => {
    const roller = makeEnemy('rallier-1', 'rallier')
    const ally = makeEnemy('ally-1')
    const a = rollIntent('rallier', 1, { seed: 7 }, [roller, ally], roller.id)
    const b = rollIntent('rallier', 1, { seed: 7 }, [roller, ally], roller.id)
    expect(a.intent).toEqual(b.intent)
  })
})
