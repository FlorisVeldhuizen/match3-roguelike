import { describe, expect, it } from 'vitest'
import { applyMatchRedDamage, pickNextTarget } from './aoe'
import type { Enemy, StatusInstance } from '../../types'

const makeEnemy = (overrides: Partial<Enemy> = {}): Enemy => ({
  id: 'enemy-1',
  name: 'Brute',
  archetype: 'brute',
  hp: 20,
  maxHp: 20,
  block: 0,
  currentIntent: { kind: 'attack', amount: 4 },
  nextIntentIndex: 0,
  statuses: [],
  ...overrides,
})

const vuln: StatusInstance = { kind: 'vulnerable', stacks: 2 }

describe('applyMatchRedDamage', () => {
  it('single-target hits only the target', () => {
    const enemies = [
      makeEnemy({ id: 'a', hp: 20 }),
      makeEnemy({ id: 'b', hp: 20 }),
      makeEnemy({ id: 'c', hp: 20 }),
    ]
    const res = applyMatchRedDamage(enemies, 'b', 5, [], false)
    expect(res.enemies[0]!.hp).toBe(20)
    expect(res.enemies[1]!.hp).toBe(15)
    expect(res.enemies[2]!.hp).toBe(20)
    const damageEvents = res.events.filter((e) => e.kind === 'damage-dealt')
    expect(damageEvents).toHaveLength(1)
  })

  it('AOE hits all living enemies', () => {
    const enemies = [
      makeEnemy({ id: 'a', hp: 20 }),
      makeEnemy({ id: 'b', hp: 20 }),
      makeEnemy({ id: 'c', hp: 20 }),
    ]
    const res = applyMatchRedDamage(enemies, 'b', 5, [], true)
    expect(res.enemies[0]!.hp).toBe(15)
    expect(res.enemies[1]!.hp).toBe(15)
    expect(res.enemies[2]!.hp).toBe(15)
    const damageEvents = res.events.filter((e) => e.kind === 'damage-dealt')
    expect(damageEvents).toHaveLength(3)
  })

  it('AOE skips dead enemies', () => {
    const enemies = [
      makeEnemy({ id: 'a', hp: 0 }),
      makeEnemy({ id: 'b', hp: 20 }),
      makeEnemy({ id: 'c', hp: 0 }),
    ]
    const res = applyMatchRedDamage(enemies, 'b', 5, [], true)
    expect(res.enemies[0]!.hp).toBe(0)
    expect(res.enemies[1]!.hp).toBe(15)
    expect(res.enemies[2]!.hp).toBe(0)
    const damageEvents = res.events.filter((e) => e.kind === 'damage-dealt')
    expect(damageEvents).toHaveLength(1)
  })

  it('per-enemy Vulnerable composes independently in AOE', () => {
    // Vulnerable on enemy-b only — it should take 1.5x damage; the others
    // take base damage. Sharp-Edge-style modifiers already applied to
    // `amount` upstream; this just verifies the per-enemy composition.
    const enemies = [
      makeEnemy({ id: 'a', hp: 20, statuses: [] }),
      makeEnemy({ id: 'b', hp: 20, statuses: [vuln] }),
      makeEnemy({ id: 'c', hp: 20, statuses: [] }),
    ]
    const res = applyMatchRedDamage(enemies, 'b', 4, [], true)
    // Base 4 → a: 4, b: floor(4 * 1.5) = 6, c: 4
    expect(res.enemies[0]!.hp).toBe(16)
    expect(res.enemies[1]!.hp).toBe(14)
    expect(res.enemies[2]!.hp).toBe(16)
  })

  it('reports killed ids for the caller to chain hooks', () => {
    const enemies = [
      makeEnemy({ id: 'a', hp: 3 }),
      makeEnemy({ id: 'b', hp: 20 }),
      makeEnemy({ id: 'c', hp: 2 }),
    ]
    const res = applyMatchRedDamage(enemies, 'b', 10, [], true)
    expect(res.killedIds).toEqual(['a', 'c'])
    // Killed enemies still drop to hp 0 — caller emits enemy-killed.
    expect(res.enemies[0]!.hp).toBe(0)
    expect(res.enemies[2]!.hp).toBe(0)
  })

  it('block absorbs before HP, emits block-absorbed/broken correctly', () => {
    const enemies = [makeEnemy({ id: 'a', hp: 20, block: 3 })]
    const res = applyMatchRedDamage(enemies, 'a', 5, [], false)
    expect(res.enemies[0]!.hp).toBe(18) // 5 - 3 block = 2 to HP
    expect(res.enemies[0]!.block).toBe(0)
    expect(res.events.some((e) => e.kind === 'block-broken')).toBe(true)
  })

  it('single-target with no target is a no-op', () => {
    const enemies = [makeEnemy({ id: 'a', hp: 20 })]
    const res = applyMatchRedDamage(enemies, null, 5, [], false)
    expect(res.enemies[0]!.hp).toBe(20)
    expect(res.events).toHaveLength(0)
  })

  it('amount=0 is a no-op (no events)', () => {
    const enemies = [makeEnemy({ id: 'a', hp: 20 })]
    const res = applyMatchRedDamage(enemies, 'a', 0, [], true)
    expect(res.enemies).toBe(enemies) // identity preserved
    expect(res.events).toHaveLength(0)
  })
})

describe('pickNextTarget', () => {
  it('returns the current target when it is still alive', () => {
    const enemies = [
      makeEnemy({ id: 'a', hp: 10 }),
      makeEnemy({ id: 'b', hp: 10 }),
    ]
    expect(pickNextTarget(enemies, 'b')).toBe('b')
  })

  it('re-points to leftmost living when current target is dead', () => {
    const enemies = [
      makeEnemy({ id: 'a', hp: 10 }),
      makeEnemy({ id: 'b', hp: 0 }),
      makeEnemy({ id: 'c', hp: 10 }),
    ]
    expect(pickNextTarget(enemies, 'b')).toBe('a')
  })

  it('skips dead enemies when re-pointing', () => {
    const enemies = [
      makeEnemy({ id: 'a', hp: 0 }),
      makeEnemy({ id: 'b', hp: 0 }),
      makeEnemy({ id: 'c', hp: 10 }),
    ]
    expect(pickNextTarget(enemies, 'a')).toBe('c')
  })

  it('returns null when no living enemies remain', () => {
    const enemies = [
      makeEnemy({ id: 'a', hp: 0 }),
      makeEnemy({ id: 'b', hp: 0 }),
    ]
    expect(pickNextTarget(enemies, 'a')).toBe(null)
  })

  it('null input picks the leftmost living', () => {
    const enemies = [
      makeEnemy({ id: 'a', hp: 0 }),
      makeEnemy({ id: 'b', hp: 10 }),
      makeEnemy({ id: 'c', hp: 10 }),
    ]
    expect(pickNextTarget(enemies, null)).toBe('b')
  })

  it('treats a missing-id target as needing re-point', () => {
    const enemies = [makeEnemy({ id: 'a', hp: 10 })]
    expect(pickNextTarget(enemies, 'ghost')).toBe('a')
  })
})
