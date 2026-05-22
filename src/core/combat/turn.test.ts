import { describe, it, expect } from 'vitest'
import type { Enemy, Player } from '../../types'
import {
  applyPoolDeltas,
  beginPlayerPhase,
  resolveEndOfPhase,
} from './turn'
import type { PoolDeltas } from './pools'

const makePlayer = (overrides: Partial<Player> = {}): Player => ({
  hp: 60,
  maxHp: 60,
  block: 0,
  mana: 0,
  skillCharge: 0,
  phasePools: { red: 0, blue: 0, green: 0 },
  ...overrides,
})

const makeEnemy = (overrides: Partial<Enemy> = {}): Enemy => ({
  id: 'enemy-1',
  name: 'Brute',
  archetype: 'brute',
  hp: 20,
  maxHp: 20,
  block: 0,
  currentIntent: { kind: 'attack', amount: 4 },
  nextIntentIndex: 0,
  ...overrides,
})

const deltas = (over: Partial<PoolDeltas> = {}): PoolDeltas => ({
  red: 0,
  blue: 0,
  green: 0,
  yellow: 0,
  purple: 0,
  ...over,
})

describe('applyPoolDeltas', () => {
  it('credits yellow/purple immediately, accumulates R/B/G', () => {
    const p = makePlayer()
    const next = applyPoolDeltas(
      p,
      deltas({ red: 3, blue: 2, green: 1, yellow: 4, purple: 5 }),
    )
    expect(next.mana).toBe(4)
    expect(next.skillCharge).toBe(5)
    expect(next.phasePools).toEqual({ red: 3, blue: 2, green: 1 })
  })

  it('accumulates pools across multiple calls (extra-turn cycles)', () => {
    let p = makePlayer()
    p = applyPoolDeltas(p, deltas({ red: 3, blue: 2 }))
    p = applyPoolDeltas(p, deltas({ red: 4, green: 1, yellow: 2 }))
    p = applyPoolDeltas(p, deltas({ blue: 1 }))
    expect(p.phasePools).toEqual({ red: 7, blue: 3, green: 1 })
    expect(p.mana).toBe(2)
  })

  it('does not mutate the input player', () => {
    const p = makePlayer({ mana: 1 })
    applyPoolDeltas(p, deltas({ yellow: 5 }))
    expect(p.mana).toBe(1)
    expect(p.phasePools).toEqual({ red: 0, blue: 0, green: 0 })
  })
})

describe('resolveEndOfPhase', () => {
  it('red pool deals damage to current target', () => {
    const p = makePlayer({ phasePools: { red: 5, blue: 0, green: 0 } })
    const result = resolveEndOfPhase(p, [makeEnemy()], 'enemy-1')
    expect(result.enemies[0]?.hp).toBe(15)
    expect(result.events.some((e) => e.kind === 'damage-dealt')).toBe(true)
    expect(result.phase).toBe('enemy-acting')
  })

  it('blue pool sets the block stat (overwrites prior block)', () => {
    const p = makePlayer({
      block: 99,
      phasePools: { red: 0, blue: 4, green: 0 },
    })
    const result = resolveEndOfPhase(p, [makeEnemy()], 'enemy-1')
    expect(result.player.block).toBe(4)
    expect(result.events.some((e) => e.kind === 'block-gained')).toBe(true)
  })

  it('green pool heals, capped at maxHp', () => {
    const p = makePlayer({
      hp: 55,
      maxHp: 60,
      phasePools: { red: 0, blue: 0, green: 10 },
    })
    const result = resolveEndOfPhase(p, [makeEnemy()], 'enemy-1')
    expect(result.player.hp).toBe(60)
    const heal = result.events.find((e) => e.kind === 'healed')
    expect(heal && heal.kind === 'healed' ? heal.amount : -1).toBe(5)
  })

  it('zeros phasePools regardless of starting block', () => {
    const p = makePlayer({
      phasePools: { red: 1, blue: 1, green: 1 },
    })
    const result = resolveEndOfPhase(p, [makeEnemy()], 'enemy-1')
    expect(result.player.phasePools).toEqual({ red: 0, blue: 0, green: 0 })
  })

  it('keeps block stat set; beginPlayerPhase zeros it next phase', () => {
    const p = makePlayer({ phasePools: { red: 0, blue: 5, green: 0 } })
    const resolved = resolveEndOfPhase(p, [makeEnemy()], 'enemy-1')
    expect(resolved.player.block).toBe(5)
    const next = beginPlayerPhase(resolved.player)
    expect(next.block).toBe(0)
  })

  it('emits enemy-killed and transitions to victory when last target dies', () => {
    const p = makePlayer({ phasePools: { red: 50, blue: 0, green: 0 } })
    const result = resolveEndOfPhase(p, [makeEnemy({ hp: 5 })], 'enemy-1')
    expect(result.enemies[0]?.hp).toBe(0)
    expect(result.events.some((e) => e.kind === 'enemy-killed')).toBe(true)
    expect(result.phase).toBe('victory')
  })

  it('auto-targets next living enemy when current target dies', () => {
    const p = makePlayer({ phasePools: { red: 99, blue: 0, green: 0 } })
    const enemies = [
      makeEnemy({ id: 'a', hp: 5 }),
      makeEnemy({ id: 'b', hp: 10 }),
    ]
    const result = resolveEndOfPhase(p, enemies, 'a')
    expect(result.targetEnemyId).toBe('b')
    expect(result.phase).toBe('enemy-acting')
  })

  it('caps damage at target hp (no negative)', () => {
    const p = makePlayer({ phasePools: { red: 100, blue: 0, green: 0 } })
    const result = resolveEndOfPhase(p, [makeEnemy({ hp: 5 })], 'enemy-1')
    expect(result.enemies[0]?.hp).toBe(0)
    const dmg = result.events.find((e) => e.kind === 'damage-dealt')
    expect(dmg && dmg.kind === 'damage-dealt' ? dmg.amount : -1).toBe(5)
  })

  it('drains enemy block before HP on red attack', () => {
    const p = makePlayer({ phasePools: { red: 8, blue: 0, green: 0 } })
    const result = resolveEndOfPhase(
      p,
      [makeEnemy({ hp: 20, block: 5 })],
      'enemy-1',
    )
    expect(result.enemies[0]?.block).toBe(0)
    expect(result.enemies[0]?.hp).toBe(17)
    const dmg = result.events.find((e) => e.kind === 'damage-dealt')
    expect(dmg && dmg.kind === 'damage-dealt' ? dmg.amount : -1).toBe(8)
  })

  it('absorbs entire attack into enemy block when block is large', () => {
    const p = makePlayer({ phasePools: { red: 3, blue: 0, green: 0 } })
    const result = resolveEndOfPhase(
      p,
      [makeEnemy({ hp: 20, block: 10 })],
      'enemy-1',
    )
    expect(result.enemies[0]?.block).toBe(7)
    expect(result.enemies[0]?.hp).toBe(20)
    const dmg = result.events.find((e) => e.kind === 'damage-dealt')
    expect(dmg && dmg.kind === 'damage-dealt' ? dmg.amount : -1).toBe(3)
  })

  it('does not emit block-gained or damage-dealt when pools are zero', () => {
    const p = makePlayer({ phasePools: { red: 0, blue: 0, green: 0 } })
    const result = resolveEndOfPhase(p, [makeEnemy()], 'enemy-1')
    const kinds = result.events.map((e) => e.kind)
    expect(kinds).not.toContain('damage-dealt')
    expect(kinds).not.toContain('block-gained')
    expect(kinds).not.toContain('healed')
    expect(kinds).toContain('turn-ended')
  })
})

describe('beginPlayerPhase', () => {
  it('zeros block and phasePools, preserves hp/mana/charge', () => {
    const p = makePlayer({
      hp: 40,
      block: 7,
      mana: 3,
      skillCharge: 2,
      phasePools: { red: 1, blue: 1, green: 1 },
    })
    const next = beginPlayerPhase(p)
    expect(next).toEqual({
      ...p,
      block: 0,
      phasePools: { red: 0, blue: 0, green: 0 },
    })
  })
})
