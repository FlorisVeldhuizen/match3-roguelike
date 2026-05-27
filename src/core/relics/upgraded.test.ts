import { describe, expect, it } from 'vitest'
import type { Player, RelicInstance } from '../../types'
import { runOnDamageTaken, runOnMatch, snapshotOf } from './engine'
import '../../content/relics'

const makePlayer = (overrides: Partial<Player> = {}): Player => ({
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
  ...overrides,
})

const inst = (id: string, upgraded = false): RelicInstance => ({
  id,
  runFlags: {},
  fightFlags: {},
  upgraded,
})

const baseDeltas = {
  red: 0,
  blue: 0,
  green: 0,
  yellow: 0,
  purple: 0,
  gold: 0,
}

describe('relic upgrade flag', () => {
  it('Iron Buckler grants +2 blue when upgraded (vs +1 base)', () => {
    const baseP = makePlayer({ relics: [inst('iron-buckler', false)] })
    const upgP = makePlayer({ relics: [inst('iron-buckler', true)] })
    const baseSnap = snapshotOf(baseP, [], null, 0)
    const upgSnap = snapshotOf(upgP, [], null, 0)
    const m = {
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      color: 'blue' as const,
      size: 3,
      shape: 'line' as const,
    }
    const baseResult = runOnMatch(
      { match: m, deltas: { ...baseDeltas, blue: 3 }, cascadeLevel: 0 },
      baseP.relics,
      baseSnap,
    )
    const upgResult = runOnMatch(
      { match: m, deltas: { ...baseDeltas, blue: 3 }, cascadeLevel: 0 },
      upgP.relics,
      upgSnap,
    )
    expect(baseResult.payload.deltas.blue).toBe(4) // 3 + 1
    expect(upgResult.payload.deltas.blue).toBe(5) // 3 + 2
  })

  it('Sharp Edge grants +2 red when upgraded', () => {
    const p = makePlayer({ relics: [inst('sharp-edge', true)] })
    const snap = snapshotOf(p, [], null, 0)
    const m = {
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ],
      color: 'red' as const,
      size: 3,
      shape: 'line' as const,
    }
    const result = runOnMatch(
      { match: m, deltas: { ...baseDeltas, red: 3 }, cascadeLevel: 0 },
      p.relics,
      snap,
    )
    expect(result.payload.deltas.red).toBe(5) // 3 + 2
  })

  it('Thornmail reflects 2 damage when upgraded', () => {
    const p = makePlayer({ relics: [inst('thornmail', true)] })
    const snap = snapshotOf(p, [], null, 0)
    const events = runOnDamageTaken(
      { amount: 3, blocked: 0, source: 'enemy-attack', attackerId: 'enemy-1' },
      p.relics,
      snap,
    )
    const reflect = events.find((e) => e.kind === 'damage-dealt' && e.source === 'thornmail')
    expect(reflect).toBeDefined()
    if (reflect && reflect.kind === 'damage-dealt') {
      expect(reflect.amount).toBe(2)
    }
  })
})
