import { beforeAll, describe, expect, it } from 'vitest'
import { rollAttackIntent } from './intentRollers'
import { registerArchetype } from './archetypeRegistry'
import { resolveAttackIntent } from './intentResolvers'
import type { Enemy, Player } from '../../types'

beforeAll(() => {
  registerArchetype({
    id: 'shade',
    name: 'Shade',
    maxHp: 10,
    pattern: ['attack', 'attack', 'attack'],
    attackRange: { min: 4, max: 6 },
    blockRange: { min: 0, max: 0 },
    onHitSelfHeal: 0.5,
  })
})

const makePlayer = (): Player => ({
  hp: 40,
  maxHp: 40,
  block: 0,
  mana: { red: 0, blue: 0, green: 0, yellow: 0 },
  skillCharge: 0,
  phasePools: { red: 0, blue: 0, green: 0 },
  statuses: [],
  pendingSpells: [],
  carryBlockNextPhase: false,
  relics: [],
  gold: 0,
  ownedSpellIds: [],
})

const makeShade = (hp = 6): Enemy => ({
  id: 'shade-1',
  name: 'Shade',
  archetype: 'shade',
  hp,
  maxHp: 10,
  block: 0,
  currentIntent: { kind: 'attack', amount: 4, lifesteal: 0.5 },
  nextIntentIndex: 0,
  statuses: [],
})

describe('Shade — lifesteal telegraph + resolution', () => {
  it('rolls lifesteal onto attack intents', () => {
    const { intent } = rollAttackIntent(
      {
        id: 'shade',
        name: 'Shade',
        maxHp: 10,
        pattern: ['attack'],
        attackRange: { min: 4, max: 4 },
        blockRange: { min: 0, max: 0 },
        onHitSelfHeal: 0.5,
      },
      { seed: 1 },
    )
    expect(intent.kind).toBe('attack')
    if (intent.kind === 'attack') {
      expect(intent.lifesteal).toBe(0.5)
    }
  })

  it('heals for half of HP damage dealt (rounded up)', () => {
    const player = makePlayer()
    const shade = makeShade(6)
    const res = resolveAttackIntent(
      { kind: 'attack', amount: 4, lifesteal: 0.5 },
      shade,
      player,
      [],
    )
    expect(res.player.hp).toBe(36)
    expect(res.source.hp).toBe(8)
    expect(res.events.some((e) => e.kind === 'ally-healed' && e.amount === 2)).toBe(true)
  })

  it('heals from damage absorbed by player armor', () => {
    const player = { ...makePlayer(), block: 10 }
    const shade = makeShade(6)
    const res = resolveAttackIntent(
      { kind: 'attack', amount: 4, lifesteal: 0.5 },
      shade,
      player,
      [],
    )
    expect(res.player.hp).toBe(40)
    expect(res.source.hp).toBe(8)
    expect(res.events.some((e) => e.kind === 'ally-healed' && e.amount === 2)).toBe(true)
  })

  it('heals from HP damage and blocked damage combined', () => {
    const player = { ...makePlayer(), block: 2 }
    const shade = makeShade(6)
    const res = resolveAttackIntent(
      { kind: 'attack', amount: 4, lifesteal: 0.5 },
      shade,
      player,
      [],
    )
    expect(res.player.hp).toBe(38)
    expect(res.source.hp).toBe(8)
    expect(res.events.some((e) => e.kind === 'ally-healed' && e.amount === 2)).toBe(true)
  })
})
