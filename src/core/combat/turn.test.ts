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
  hp: 20,
  maxHp: 20,
  block: 0,
  currentIntent: { kind: 'attack', amount: 4 },
  nextIntentIndex: 0,
  statuses: [],
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
  // Per-match commit (plan B): red damage and green heal are applied
  // *during* the cascade by the store walker, not here. EOP only
  // resolves blue → block, which still has to snap into place before
  // the enemy attack.

  it('blue pool sets the block stat (overwrites prior block)', () => {
    const p = makePlayer({
      block: 99,
      phasePools: { red: 0, blue: 4, green: 0 },
    })
    const result = resolveEndOfPhase(p, [makeEnemy()], 'enemy-1')
    expect(result.player.block).toBe(4)
    expect(result.events.some((e) => e.kind === 'block-gained')).toBe(true)
  })

  it('zeros phasePools regardless of starting values', () => {
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
    expect(next.player.block).toBe(0)
  })

  it('transitions to victory when entering EOP with all enemies dead', () => {
    // Walker would have killed the enemy mid-cascade; EOP just reads
    // the settled state and routes to victory.
    const p = makePlayer({ phasePools: { red: 0, blue: 0, green: 0 } })
    const result = resolveEndOfPhase(p, [makeEnemy({ hp: 0 })], 'enemy-1')
    expect(result.phase).toBe('victory')
  })

  it('does not emit damage-dealt or healed regardless of pool state', () => {
    // Per-match commit means EOP never deals damage or heals. The
    // pools are just running meters at this point.
    const p = makePlayer({ phasePools: { red: 99, blue: 0, green: 99 } })
    const result = resolveEndOfPhase(p, [makeEnemy()], 'enemy-1')
    const kinds = result.events.map((e) => e.kind)
    expect(kinds).not.toContain('damage-dealt')
    expect(kinds).not.toContain('healed')
  })

  it('does not emit block-gained when blue pool is zero', () => {
    const p = makePlayer({ phasePools: { red: 0, blue: 0, green: 0 } })
    const result = resolveEndOfPhase(p, [makeEnemy()], 'enemy-1')
    const kinds = result.events.map((e) => e.kind)
    expect(kinds).not.toContain('block-gained')
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
    expect(next.player).toEqual({
      ...p,
      block: 0,
      phasePools: { red: 0, blue: 0, green: 0 },
    })
    expect(next.phase).toBe('player-acting')
  })

  // Locks the FX-pipeline contract: damage-taken (burn proc) must come
  // BEFORE status-ticked / status-expired so the chip → HP particle
  // trail can snapshot the chip's position while it's still mounted.
  // If this order regresses, the chip will disappear before the
  // particles spawn from it.
  it('emits damage-taken before status-ticked/expired on burn proc', () => {
    const p = makePlayer({
      hp: 40,
      // Burn 2 → tick deals 2, stacks decays to 1 (still active).
      statuses: [{ kind: 'burn', stacks: 2 }],
    })
    const result = beginPlayerPhase(p)
    const dtIdx = result.events.findIndex(
      (e) => e.kind === 'damage-taken' && e.source === 'burn',
    )
    const tickedIdx = result.events.findIndex((e) => e.kind === 'status-ticked')
    expect(dtIdx).toBeGreaterThanOrEqual(0)
    expect(tickedIdx).toBeGreaterThanOrEqual(0)
    expect(dtIdx).toBeLessThan(tickedIdx)
  })

  it('emits damage-taken before status-expired on burn final tick', () => {
    const p = makePlayer({
      hp: 40,
      // Burn 1 → tick deals 1, stacks decays to 0 → expires.
      statuses: [{ kind: 'burn', stacks: 1 }],
    })
    const result = beginPlayerPhase(p)
    const dtIdx = result.events.findIndex(
      (e) => e.kind === 'damage-taken' && e.source === 'burn',
    )
    const expiredIdx = result.events.findIndex((e) => e.kind === 'status-expired')
    expect(dtIdx).toBeGreaterThanOrEqual(0)
    expect(expiredIdx).toBeGreaterThanOrEqual(0)
    expect(dtIdx).toBeLessThan(expiredIdx)
  })

  // Burn routes through applyDamage so leftover block (carried over via
  // Reinforce, or in any future relic that preserves block into the
  // player phase) eats burn ticks first — armor protects from fire too.
  it('routes burn through block: full absorb leaves HP untouched', () => {
    const p = makePlayer({
      hp: 40,
      block: 5,
      // Burn 3 → 3 dmg, all absorbed by 5 block (2 block survives).
      statuses: [{ kind: 'burn', stacks: 3 }],
      carryBlockNextPhase: true,
    })
    const result = beginPlayerPhase(p)
    expect(result.player.hp).toBe(40)
    expect(result.player.block).toBe(2)
    const dt = result.events.find(
      (e) => e.kind === 'damage-taken' && e.source === 'burn',
    )
    expect(dt).toMatchObject({ amount: 0, blocked: 3 })
    expect(result.events.some((e) => e.kind === 'block-absorbed')).toBe(true)
    expect(result.events.some((e) => e.kind === 'block-broken')).toBe(false)
  })

  it('routes burn through block: partial absorb splits across block + HP', () => {
    const p = makePlayer({
      hp: 40,
      block: 2,
      // Burn 5 → 2 absorbed, 3 to HP; block breaks.
      statuses: [{ kind: 'burn', stacks: 5 }],
      carryBlockNextPhase: true,
    })
    const result = beginPlayerPhase(p)
    expect(result.player.hp).toBe(37)
    expect(result.player.block).toBe(0)
    const dt = result.events.find(
      (e) => e.kind === 'damage-taken' && e.source === 'burn',
    )
    expect(dt).toMatchObject({ amount: 3, blocked: 2 })
    expect(result.events.some((e) => e.kind === 'block-broken')).toBe(true)
  })

  it('zeros surviving-burn block when carryBlockNextPhase is false', () => {
    // Block absorbs the burn, but the wall is still spent at phase
    // start — the survivor goes to 0 just like an unburned wall would.
    const p = makePlayer({
      hp: 40,
      block: 5,
      statuses: [{ kind: 'burn', stacks: 3 }],
      carryBlockNextPhase: false,
    })
    const result = beginPlayerPhase(p)
    expect(result.player.hp).toBe(40)
    expect(result.player.block).toBe(0)
  })
})
