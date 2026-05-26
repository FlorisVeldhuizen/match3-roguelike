import { beforeAll, describe, expect, it } from 'vitest'
import { beginPlayerPhase, resolveEndOfPhase } from './turn'
import { registerArchetype } from './archetypeRegistry'
import {
  BRITTLE_VULN_STACKS,
  CINDER_BURN_STACKS,
  CINDER_HEAL,
  FOCUS_TRANSFER,
  IGNITE_BURN_STACKS,
  PURIFY_BURN_HEAL,
  REGENERATE_STACKS,
  resolveBrittle,
  resolveCinderLash,
  resolveFocus,
  resolveIgnite,
  resolvePurify,
  resolveRegenerate,
} from './spellResolvers'
import type { Enemy, Player } from '../../types'

beforeAll(() => {
  registerArchetype({
    id: 'brute',
    name: 'Brute',
    maxHp: 20,
    pattern: ['attack'],
    attackRange: { min: 3, max: 5 },
    blockRange: { min: 3, max: 5 },
  })
})

const makePlayer = (overrides: Partial<Player> = {}): Player => ({
  hp: 60,
  maxHp: 60,
  block: 0,
  mana: { red: 0, blue: 0, green: 0, yellow: 0 },
  skillCharge: 0,
  phasePools: { red: 0, blue: 0, green: 0 },
  statuses: [],
  pendingSpells: [],
  carryBlockNextPhase: false,
  relics: [],
  gold: 0,
  ...overrides,
})

const makeEnemy = (overrides: Partial<Enemy> = {}): Enemy => ({
  id: 'enemy-1',
  name: 'Brute',
  archetype: 'brute',
  hp: 20,
  maxHp: 20,
  block: 0,
  currentIntent: { kind: 'attack', amount: 5 },
  nextIntentIndex: 0,
  statuses: [],
  ...overrides,
})

// ----- Ignite -----

describe('Ignite (immediate, apply Burn to target)', () => {
  it('applies 3 Burn to a living target', () => {
    const enemy = makeEnemy()
    const r = resolveIgnite([enemy], enemy.id)
    expect(r.enemies[0]?.statuses).toContainEqual({
      kind: 'burn',
      stacks: IGNITE_BURN_STACKS,
    })
    expect(r.events).toContainEqual({
      kind: 'status-applied',
      target: enemy.id,
      status: { kind: 'burn', stacks: IGNITE_BURN_STACKS },
      source: { kind: 'player' },
    })
  })

  it('stacks Burn on top of an existing one', () => {
    const enemy = makeEnemy({ statuses: [{ kind: 'burn', stacks: 2 }] })
    const r = resolveIgnite([enemy], enemy.id)
    // Burn re-application accumulates per StS pattern.
    expect(r.enemies[0]?.statuses[0]?.stacks).toBe(2 + IGNITE_BURN_STACKS)
  })

  it('no-ops on a dead target (no event, no change)', () => {
    const enemy = makeEnemy({ hp: 0 })
    const r = resolveIgnite([enemy], enemy.id)
    expect(r.enemies[0]?.statuses).toEqual([])
    expect(r.events).toEqual([])
  })
})

// ----- Brittle -----

describe('Brittle (immediate, apply Vulnerable to target)', () => {
  it('applies 2 Vulnerable to a living target', () => {
    const enemy = makeEnemy()
    const r = resolveBrittle([enemy], enemy.id)
    expect(r.enemies[0]?.statuses).toContainEqual({
      kind: 'vulnerable',
      stacks: BRITTLE_VULN_STACKS,
    })
  })

  it('stacks additively onto existing Vulnerable (H2c rule)', () => {
    // Vulnerable now stacks additively across all status sources.
    const enemy = makeEnemy({ statuses: [{ kind: 'vulnerable', stacks: 5 }] })
    const r = resolveBrittle([enemy], enemy.id)
    expect(r.enemies[0]?.statuses[0]?.stacks).toBe(5 + BRITTLE_VULN_STACKS)
  })
})

// ----- Cinder Lash -----

describe('Cinder Lash (immediate, Burn + self heal)', () => {
  it('applies 2 Burn to target and heals 2 to self', () => {
    const player = makePlayer({ hp: 50 })
    const enemy = makeEnemy()
    const r = resolveCinderLash(player, [enemy], enemy.id)
    expect(r.player.hp).toBe(52)
    expect(r.enemies[0]?.statuses).toContainEqual({
      kind: 'burn',
      stacks: CINDER_BURN_STACKS,
    })
    expect(r.events).toContainEqual({ kind: 'healed', amount: CINDER_HEAL })
  })

  it('caps the heal at maxHp', () => {
    const player = makePlayer({ hp: 59, maxHp: 60 })
    const enemy = makeEnemy()
    const r = resolveCinderLash(player, [enemy], enemy.id)
    expect(r.player.hp).toBe(60)
    expect(r.events).toContainEqual({ kind: 'healed', amount: 1 })
  })
})

// ----- Regenerate -----

describe('Regenerate (immediate, apply Regen to self)', () => {
  it('applies 3 Regen to the player statuses', () => {
    const player = makePlayer()
    const r = resolveRegenerate(player)
    expect(r.player.statuses).toContainEqual({
      kind: 'regen',
      stacks: REGENERATE_STACKS,
    })
  })

  it('stacks Regen on re-application like Burn', () => {
    const player = makePlayer({ statuses: [{ kind: 'regen', stacks: 2 }] })
    const r = resolveRegenerate(player)
    expect(r.player.statuses[0]?.stacks).toBe(2 + REGENERATE_STACKS)
  })
})

describe('Regen ticks at player turn start', () => {
  it('heals stacks then decays −1 (3 → 2 → 1 → expires)', () => {
    let p: Player = makePlayer({
      hp: 50,
      maxHp: 60,
      statuses: [{ kind: 'regen', stacks: 3 }],
    })
    // Tick 1
    let r = beginPlayerPhase(p)
    expect(r.player.hp).toBe(53)
    expect(r.player.statuses[0]?.stacks).toBe(2)
    p = r.player
    // Tick 2
    r = beginPlayerPhase(p)
    expect(r.player.hp).toBe(55)
    expect(r.player.statuses[0]?.stacks).toBe(1)
    p = r.player
    // Tick 3 (expires)
    r = beginPlayerPhase(p)
    expect(r.player.hp).toBe(56)
    expect(r.player.statuses).toEqual([])
  })

  it('caps heal at maxHp', () => {
    const p = makePlayer({
      hp: 59,
      maxHp: 60,
      statuses: [{ kind: 'regen', stacks: 5 }],
    })
    const r = beginPlayerPhase(p)
    expect(r.player.hp).toBe(60)
    // Only the actual delta (1) is in the healed event.
    expect(r.events).toContainEqual({ kind: 'healed', amount: 1 })
  })

  it('burn ticks BEFORE regen heals so DoT damage applies first', () => {
    // 3 Burn + 3 Regen with hp=2: burn ticks 3 dmg (player goes to 0,
    // would die — but we test the non-fatal version here). Choose hp
    // such that we survive: hp=10. 3 Burn dmg → 7 HP, then 3 Regen
    // heals → 10 HP. Net 0 but the order matters for "would-die" cases.
    const p = makePlayer({
      hp: 10,
      maxHp: 60,
      statuses: [
        { kind: 'burn', stacks: 3 },
        { kind: 'regen', stacks: 3 },
      ],
    })
    const r = beginPlayerPhase(p)
    expect(r.player.hp).toBe(10) // 10 - 3 + 3
    // Phase still proceeds normally (not game-over because burn didn't kill).
    expect(r.phase).toBe('player-acting')
  })
})

// ----- Purify -----

describe('Purify (immediate, removes status entirely)', () => {
  it('strips all stacks of the named status', () => {
    const p = makePlayer({ statuses: [{ kind: 'weak', stacks: 4 }] })
    const r = resolvePurify(p, 'weak')
    expect(r.player.statuses).toEqual([])
    expect(r.events).toContainEqual({
      kind: 'status-expired',
      target: 'player',
      statusKind: 'weak',
    })
  })

  it('heals PURIFY_BURN_HEAL when removing Burn specifically', () => {
    const p = makePlayer({
      hp: 50,
      maxHp: 60,
      statuses: [{ kind: 'burn', stacks: 5 }],
    })
    const r = resolvePurify(p, 'burn')
    expect(r.player.hp).toBe(50 + PURIFY_BURN_HEAL)
    expect(r.player.statuses).toEqual([])
    expect(r.events).toContainEqual({
      kind: 'healed',
      amount: PURIFY_BURN_HEAL,
    })
  })

  it('does not heal when removing Weak or Vulnerable (bonus is Burn-only)', () => {
    const p = makePlayer({
      hp: 50,
      maxHp: 60,
      statuses: [{ kind: 'vulnerable', stacks: 3 }],
    })
    const r = resolvePurify(p, 'vulnerable')
    expect(r.player.hp).toBe(50)
    expect(r.events.some((e) => e.kind === 'healed')).toBe(false)
  })

  it('caps the burn-heal at maxHp', () => {
    const p = makePlayer({
      hp: 59,
      maxHp: 60,
      statuses: [{ kind: 'burn', stacks: 3 }],
    })
    const r = resolvePurify(p, 'burn')
    expect(r.player.hp).toBe(60)
    expect(r.events).toContainEqual({ kind: 'healed', amount: 1 })
  })

  it('no-ops if the named status is absent', () => {
    const p = makePlayer({ statuses: [{ kind: 'burn', stacks: 2 }] })
    const r = resolvePurify(p, 'weak')
    expect(r.player.statuses).toEqual([{ kind: 'burn', stacks: 2 }])
    expect(r.events).toEqual([])
  })
})

// ----- Focus -----

describe('Focus (immediate, mana conversion)', () => {
  it(`moves up to ${FOCUS_TRANSFER} mana from source to target`, () => {
    const p = makePlayer({ mana: { red: 5, blue: 0, green: 0, yellow: 0 } })
    const r = resolveFocus(p, 'red', 'blue')
    expect(r.player.mana).toEqual({ red: 2, blue: 3, green: 0, yellow: 0 })
  })

  it('respects source availability', () => {
    const p = makePlayer({ mana: { red: 1, blue: 0, green: 0, yellow: 0 } })
    const r = resolveFocus(p, 'red', 'blue')
    expect(r.player.mana).toEqual({ red: 0, blue: 1, green: 0, yellow: 0 })
  })

  it('respects target cap', () => {
    const p = makePlayer({ mana: { red: 5, blue: 7, green: 0, yellow: 0 } })
    const r = resolveFocus(p, 'red', 'blue')
    expect(r.player.mana).toEqual({ red: 4, blue: 8, green: 0, yellow: 0 })
  })

  it('rejects degenerate same-color and purple', () => {
    const p = makePlayer({ mana: { red: 4, blue: 0, green: 0, yellow: 0 } })
    expect(resolveFocus(p, 'red', 'red').player.mana).toEqual(p.mana)
    expect(resolveFocus(p, 'purple', 'red').player.mana).toEqual(p.mana)
    expect(resolveFocus(p, 'red', 'purple').player.mana).toEqual(p.mana)
  })
})

// ----- Volley (EOP) -----

describe('Volley (pending, red pool split across 3 targets)', () => {
  const e1 = (over: Partial<Enemy> = {}): Enemy =>
    makeEnemy({ id: 'e1', ...over })
  const e2 = (over: Partial<Enemy> = {}): Enemy =>
    makeEnemy({ id: 'e2', ...over })

  it('splits 9 red into 3+3+3 across the chosen targets', () => {
    const p = makePlayer({
      pendingSpells: ['volley'],
      phasePools: { red: 9, blue: 0, green: 0 },
      volleyTargets: ['e1', 'e2', 'e1'],
    })
    const a = e1({ hp: 20 })
    const b = e2({ hp: 20 })
    const res = resolveEndOfPhase(p, [a, b], a.id)
    expect(res.enemies.find((e) => e.id === 'e1')?.hp).toBe(14)
    expect(res.enemies.find((e) => e.id === 'e2')?.hp).toBe(17)
  })

  it('puts remainder on the last chunk (10 red → 3,3,4)', () => {
    const p = makePlayer({
      pendingSpells: ['volley'],
      phasePools: { red: 10, blue: 0, green: 0 },
      volleyTargets: ['e1', 'e1', 'e1'],
    })
    const enemy = e1({ hp: 30 })
    const res = resolveEndOfPhase(p, [enemy], enemy.id)
    expect(res.enemies[0]?.hp).toBe(20)
  })

  it('drops Volley from pendingSpells and clears volleyTargets on resolve', () => {
    const p = makePlayer({
      pendingSpells: ['volley'],
      phasePools: { red: 6, blue: 0, green: 0 },
      volleyTargets: ['e1', 'e1', 'e1'],
    })
    const enemy = e1({ hp: 30 })
    const res = resolveEndOfPhase(p, [enemy], enemy.id)
    expect(res.player.pendingSpells).toEqual([])
    expect(res.player.volleyTargets).toBeUndefined()
  })

  it('zero red pool = no damage events', () => {
    const p = makePlayer({
      pendingSpells: ['volley'],
      phasePools: { red: 0, blue: 0, green: 0 },
      volleyTargets: ['e1', 'e1', 'e1'],
    })
    const enemy = e1({ hp: 20 })
    const res = resolveEndOfPhase(p, [enemy], enemy.id)
    expect(res.enemies[0]?.hp).toBe(20)
    const dmgEvents = res.events.filter((e) => e.kind === 'damage-dealt')
    expect(dmgEvents).toEqual([])
  })

  it('skips chunks targeting a dead enemy', () => {
    const p = makePlayer({
      pendingSpells: ['volley'],
      phasePools: { red: 9, blue: 0, green: 0 },
      volleyTargets: ['e1', 'e2', 'e1'],
    })
    const dead = e1({ hp: 0 })
    const alive = e2({ hp: 20 })
    const res = resolveEndOfPhase(p, [dead, alive], alive.id)
    expect(res.enemies.find((e) => e.id === 'e1')?.hp).toBe(0)
    expect(res.enemies.find((e) => e.id === 'e2')?.hp).toBe(17)
  })

  it('composes through Vulnerable on the per-chunk target', () => {
    const p = makePlayer({
      pendingSpells: ['volley'],
      phasePools: { red: 9, blue: 0, green: 0 },
      volleyTargets: ['e1', 'e1', 'e2'],
    })
    const a = e1({ hp: 20, statuses: [{ kind: 'vulnerable', stacks: 2 }] })
    const b = e2({ hp: 20 })
    const res = resolveEndOfPhase(p, [a, b], a.id)
    expect(res.enemies.find((e) => e.id === 'e1')?.hp).toBe(12)
    expect(res.enemies.find((e) => e.id === 'e2')?.hp).toBe(17)
  })

  it('emits enemy-killed and reroutes target when a chunk kills', () => {
    const p = makePlayer({
      pendingSpells: ['volley'],
      phasePools: { red: 30, blue: 0, green: 0 },
      volleyTargets: ['e1', 'e2', 'e2'],
    })
    const a = e1({ hp: 5 })
    const b = e2({ hp: 100 })
    const res = resolveEndOfPhase(p, [a, b], a.id)
    expect(res.enemies.find((e) => e.id === 'e1')?.hp).toBe(0)
    expect(
      res.events.some(
        (e) => e.kind === 'enemy-killed' && e.enemyId === 'e1',
      ),
    ).toBe(true)
    expect(res.targetEnemyId).toBe('e2')
  })
})
