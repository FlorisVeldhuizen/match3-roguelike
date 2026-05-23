import { describe, it, expect } from 'vitest'
import type {
  Enemy,
  Match,
  Player,
  RelicInstance,
} from '../../types'
import {
  runOnMatch,
  runOnDamageTaken,
  interceptFatalDamage,
  acquireRelic,
  snapshotOf,
} from './engine'
import { tryGetRelic } from './registry'
// Side-effect import: registers all five relics before tests run.
// (vitest doesn't go through main.tsx.)
import '../../content/relics'

const makePlayer = (overrides: Partial<Player> = {}): Player => ({
  hp: 40,
  maxHp: 40,
  block: 0,
  mana: 0,
  skillCharge: 0,
  phasePools: { red: 0, blue: 0, green: 0 },
  statuses: [],
  pendingSpells: [],
  carryBlockNextPhase: false,
  relics: [],
  ...overrides,
})

const makeEnemy = (overrides: Partial<Enemy> = {}): Enemy => ({
  id: 'enemy-1',
  name: 'Brute',
  archetype: 'brute',
  hp: 30,
  maxHp: 30,
  block: 0,
  currentIntent: { kind: 'attack', amount: 5 },
  nextIntentIndex: 0,
  statuses: [],
  ...overrides,
})

const inst = (id: string): RelicInstance => ({
  id,
  runFlags: {},
  fightFlags: {},
})

const match = (color: Match['color'], size: number): Match => ({
  cells: Array.from({ length: size }, (_, i) => ({ x: i, y: 0 })),
  color,
  size,
  shape: 'line',
})

const baseDeltas = {
  red: 0,
  blue: 0,
  green: 0,
  yellow: 0,
  purple: 0,
}

const snap = (player: Player) =>
  snapshotOf(player, [makeEnemy()], 'enemy-1', 0)

describe('relic registry & content bootstrap', () => {
  it('content/relics.ts has registered all five', () => {
    for (const id of [
      'iron-buckler',
      'sharp-edge',
      'thornmail',
      'cascade-crystal',
      'stoneheart',
    ]) {
      expect(tryGetRelic(id)).toBeDefined()
    }
  })
})

describe('Iron Buckler', () => {
  it('grants +1 blue delta per blue match', () => {
    const player = makePlayer({ relics: [inst('iron-buckler')] })
    const result = runOnMatch(
      {
        match: match('blue', 3),
        deltas: { ...baseDeltas, blue: 3 },
        cascadeLevel: 0,
      },
      player.relics,
      snap(player),
    )
    expect(result.payload.deltas.blue).toBe(4)
  })
  it('does nothing on non-blue matches', () => {
    const player = makePlayer({ relics: [inst('iron-buckler')] })
    const result = runOnMatch(
      {
        match: match('red', 3),
        deltas: { ...baseDeltas, red: 3 },
        cascadeLevel: 0,
      },
      player.relics,
      snap(player),
    )
    expect(result.payload.deltas.blue).toBe(0)
    expect(result.payload.deltas.red).toBe(3)
  })
})

describe('Sharp Edge', () => {
  it('grants +1 red delta per red match', () => {
    const player = makePlayer({ relics: [inst('sharp-edge')] })
    const result = runOnMatch(
      {
        match: match('red', 4),
        deltas: { ...baseDeltas, red: 4 },
        cascadeLevel: 0,
      },
      player.relics,
      snap(player),
    )
    expect(result.payload.deltas.red).toBe(5)
  })
})

describe('Thornmail', () => {
  it('emits reflect on enemy-attack source', () => {
    const player = makePlayer({ relics: [inst('thornmail')] })
    const events = runOnDamageTaken(
      {
        amount: 3,
        blocked: 0,
        source: 'enemy-attack',
        attackerId: 'enemy-1',
      },
      player.relics,
      snap(player),
    )
    const reflectMarker = events.find(
      (e) => e.kind === 'damage-dealt' && e.source === 'thornmail',
    )
    expect(reflectMarker).toBeDefined()
    const triggered = events.find(
      (e) => e.kind === 'relic-triggered' && e.relicId === 'thornmail',
    )
    expect(triggered).toBeDefined()
  })
  it('does not reflect on burn source', () => {
    const player = makePlayer({ relics: [inst('thornmail')] })
    const events = runOnDamageTaken(
      { amount: 3, blocked: 0, source: 'burn', attackerId: null },
      player.relics,
      snap(player),
    )
    expect(events).toHaveLength(0)
  })
})

describe('Cascade Crystal', () => {
  it('does nothing at cascade level 0', () => {
    const player = makePlayer({ relics: [inst('cascade-crystal')] })
    const result = runOnMatch(
      {
        match: match('red', 4),
        deltas: { ...baseDeltas, red: 4 },
        cascadeLevel: 0,
      },
      player.relics,
      snap(player),
    )
    expect(result.payload.deltas.red).toBe(4)
  })
  it('multiplies all five colors by 1.5 (floored) at level 1+', () => {
    const player = makePlayer({ relics: [inst('cascade-crystal')] })
    const result = runOnMatch(
      {
        match: match('red', 4),
        deltas: { ...baseDeltas, red: 5 },
        cascadeLevel: 1,
      },
      player.relics,
      snap(player),
    )
    expect(result.payload.deltas.red).toBe(7) // floor(5 * 1.5) = 7
  })
})

describe('Stoneheart', () => {
  it('prevents fatal damage once per run', () => {
    const player = makePlayer({ relics: [inst('stoneheart')] })
    const cloned = player.relics.map((r) => ({
      ...r,
      runFlags: { ...r.runFlags },
      fightFlags: { ...r.fightFlags },
    }))
    const r1 = interceptFatalDamage(
      { incoming: 100, source: 'enemy-attack' },
      cloned,
      snap({ ...player, relics: cloned }),
    )
    expect(r1.result?.prevented).toBe(true)
    expect(r1.result?.hpFloor).toBe(1)
    expect(cloned[0]!.runFlags.triggered).toBe(true)
    // Second lethal — does NOT save.
    const r2 = interceptFatalDamage(
      { incoming: 100, source: 'enemy-attack' },
      cloned,
      snap({ ...player, relics: cloned }),
    )
    expect(r2.result).toBeNull()
  })
  it('triggers regardless of source (burn, etc.)', () => {
    const player = makePlayer({ relics: [inst('stoneheart')] })
    const cloned = player.relics.map((r) => ({
      ...r,
      runFlags: { ...r.runFlags },
      fightFlags: { ...r.fightFlags },
    }))
    const r = interceptFatalDamage(
      { incoming: 100, source: 'burn' },
      cloned,
      snap({ ...player, relics: cloned }),
    )
    expect(r.result?.prevented).toBe(true)
  })
})

describe('modifier acquisition order', () => {
  it('Sharp Edge + Crystal: order changes outcome on 5-red match', () => {
    // sharp-edge then crystal: (5 + 1) × 1.5 = 9
    const player1 = makePlayer({
      relics: [inst('sharp-edge'), inst('cascade-crystal')],
    })
    const r1 = runOnMatch(
      {
        match: match('red', 5),
        deltas: { ...baseDeltas, red: 5 },
        cascadeLevel: 1,
      },
      player1.relics,
      snap(player1),
    )
    expect(r1.payload.deltas.red).toBe(9)
    // crystal then sharp-edge: floor(5 × 1.5) + 1 = 7 + 1 = 8
    const player2 = makePlayer({
      relics: [inst('cascade-crystal'), inst('sharp-edge')],
    })
    const r2 = runOnMatch(
      {
        match: match('red', 5),
        deltas: { ...baseDeltas, red: 5 },
        cascadeLevel: 1,
      },
      player2.relics,
      snap(player2),
    )
    expect(r2.payload.deltas.red).toBe(8)
  })
})

describe('acquireRelic helper', () => {
  it('appends in acquisition order, no duplicates', () => {
    let relics: RelicInstance[] = []
    relics = acquireRelic(relics, 'iron-buckler')
    relics = acquireRelic(relics, 'sharp-edge')
    relics = acquireRelic(relics, 'iron-buckler') // duplicate
    expect(relics.map((r) => r.id)).toEqual(['iron-buckler', 'sharp-edge'])
  })
})
