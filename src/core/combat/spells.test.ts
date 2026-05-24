import { beforeAll, describe, expect, it } from 'vitest'
import { resolveEndOfPhase, applyPoolDeltas } from './turn'
import { executeEnemyTurn } from './enemyTurn'
import { registerArchetype } from './archetypeRegistry'
import type { Enemy, Player, StatusInstance } from '../../types'

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

const makePlayer = (overrides: Partial<Player> = {}): Player => ({
  hp: 60,
  maxHp: 60,
  block: 0,
  mana: { red: 0, blue: 10, green: 0, yellow: 0 },
  skillCharge: 8,
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
  currentIntent: { kind: 'attack', amount: 5 },
  nextIntentIndex: 0,
  statuses: [],
  ...overrides,
})

const vuln: StatusInstance = { kind: 'vulnerable', stacks: 2 }
const weak: StatusInstance = { kind: 'weak', stacks: 2 }

describe('Bulwark at end of phase', () => {
  it('converts entire blue pool to attack at floor(blue/2) and zeros block', () => {
    const player = makePlayer({
      pendingSpells: ['bulwark'],
      phasePools: { red: 0, blue: 7, green: 0 },
    })
    const enemy = makeEnemy()
    const res = resolveEndOfPhase(player, [enemy], enemy.id)
    expect(res.player.block).toBe(0)
    // floor(7/2) = 3; hits a 20 HP target with no block → 17 HP
    expect(res.enemies[0]?.hp).toBe(17)
    const dmgEvent = res.events.find((e) => e.kind === 'damage-dealt')
    expect(dmgEvent).toMatchObject({ amount: 3, source: 'player-attack' })
  })

  it('credits Bulwark conversion through Vulnerable on the target', () => {
    // floor(7/2) = 3; ×1.5 with Vulnerable target = floor(4.5) = 4
    const player = makePlayer({
      pendingSpells: ['bulwark'],
      phasePools: { red: 0, blue: 7, green: 0 },
    })
    const enemy = makeEnemy({ statuses: [vuln] })
    const res = resolveEndOfPhase(player, [enemy], enemy.id)
    expect(res.enemies[0]?.hp).toBe(16)
  })

  it('Reinforce empowers Bulwark — strike hits at full blue, block 0, no carry', () => {
    const player = makePlayer({
      pendingSpells: ['bulwark', 'reinforce'],
      phasePools: { red: 0, blue: 6, green: 0 },
    })
    const enemy = makeEnemy()
    const res = resolveEndOfPhase(player, [enemy], enemy.id)
    expect(res.player.block).toBe(0)
    // full blue (6), not floor(6/2)=3, since Reinforce empowers the swing
    expect(res.enemies[0]?.hp).toBe(14)
    const dmgEvent = res.events.find((e) => e.kind === 'damage-dealt')
    expect(dmgEvent).toMatchObject({ amount: 6, source: 'player-attack' })
    // Reinforce is spent on the swing — no carry-over for next phase
    expect(res.player.carryBlockNextPhase).toBe(false)
    // both pending effects resolve and are cleared (riposte not queued)
    const resolved = res.events.filter((e) => e.kind === 'pending-effect-resolved')
    expect(resolved.map((e) => (e.kind === 'pending-effect-resolved' ? e.spellId : '')).sort()).toEqual(['bulwark', 'reinforce'])
    expect(res.player.pendingSpells).toEqual([])
  })

  it('Reinforce alone doubles block from blue pool and carries it', () => {
    const player = makePlayer({
      pendingSpells: ['reinforce'],
      phasePools: { red: 0, blue: 4, green: 0 },
    })
    const enemy = makeEnemy()
    const res = resolveEndOfPhase(player, [enemy], enemy.id)
    expect(res.player.block).toBe(8)
    expect(res.player.carryBlockNextPhase).toBe(true)
  })

  it('keeps Riposte queued across the phase boundary', () => {
    const player = makePlayer({
      pendingSpells: ['bulwark', 'riposte'],
      phasePools: { red: 0, blue: 4, green: 0 },
    })
    const enemy = makeEnemy()
    const res = resolveEndOfPhase(player, [enemy], enemy.id)
    expect(res.player.pendingSpells).toEqual(['riposte'])
  })

  it('Bulwark accumulates blue across extra-turn cycles via applyPoolDeltas', () => {
    let player = makePlayer({ pendingSpells: ['bulwark'] })
    player = applyPoolDeltas(player, { red: 0, blue: 3, green: 0, yellow: 0, purple: 0 })
    player = applyPoolDeltas(player, { red: 0, blue: 4, green: 0, yellow: 0, purple: 0 })
    expect(player.phasePools.blue).toBe(7)
    const enemy = makeEnemy()
    const res = resolveEndOfPhase(player, [enemy], enemy.id)
    // floor(7/2)=3
    expect(res.enemies[0]?.hp).toBe(17)
  })
})

describe('damage pipeline composition (Vulnerable + Weak)', () => {
  it('enemy attack on a Vulnerable player is amplified', () => {
    // intent 5, player Vulnerable → floor(5 × 1.5) = 7 incoming
    const player = makePlayer({ statuses: [vuln] })
    const enemy = makeEnemy({ currentIntent: { kind: 'attack', amount: 5 } })
    const res = executeEnemyTurn(player, [enemy], [], { seed: 1 })
    expect(res.player.hp).toBe(53)
  })

  it('Weak on the attacking enemy halves outgoing', () => {
    // intent 5, enemy Weak → floor(5 × 0.5) = 2 incoming
    const player = makePlayer()
    const enemy = makeEnemy({
      currentIntent: { kind: 'attack', amount: 5 },
      statuses: [weak],
    })
    const res = executeEnemyTurn(player, [enemy], [], { seed: 1 })
    expect(res.player.hp).toBe(58)
  })

  it('Weak + Vulnerable compose (0.5 × 1.5 = 0.75)', () => {
    // intent 8, both → floor(8 × 0.75) = 6
    const player = makePlayer({ statuses: [vuln] })
    const enemy = makeEnemy({
      currentIntent: { kind: 'attack', amount: 8 },
      statuses: [weak],
    })
    const res = executeEnemyTurn(player, [enemy], [], { seed: 1 })
    expect(res.player.hp).toBe(54)
  })
})

describe('Riposte', () => {
  it('parries incoming attack to 0 and counters for the pre-block amount', () => {
    const player = makePlayer({ pendingSpells: ['riposte'] })
    const enemy = makeEnemy({ currentIntent: { kind: 'attack', amount: 6 } })
    const res = executeEnemyTurn(player, [enemy], [], { seed: 1 })
    expect(res.player.hp).toBe(60)
    expect(res.enemies[0]?.hp).toBe(14)
    expect(res.player.pendingSpells).not.toContain('riposte')
    expect(res.events.some((e) => e.kind === 'riposte-counter')).toBe(true)
  })

  it('expires unused at end of enemy turn when no attack came', () => {
    // Brute pattern index 2 = block, so currentIntent=block: Riposte never
    // sees an attack this turn and should expire.
    const player = makePlayer({ pendingSpells: ['riposte'] })
    const enemy = makeEnemy({
      currentIntent: { kind: 'block', amount: 4 },
      block: 4,
    })
    const res = executeEnemyTurn(player, [enemy], [], { seed: 1 })
    expect(res.player.pendingSpells).not.toContain('riposte')
    const resolved = res.events.filter(
      (e) => e.kind === 'pending-effect-resolved',
    )
    expect(
      resolved.some(
        (e) => e.kind === 'pending-effect-resolved' && e.spellId === 'riposte',
      ),
    ).toBe(true)
    expect(res.events.some((e) => e.kind === 'riposte-counter')).toBe(false)
  })
})

describe('Burn at turn start', () => {
  it('ticks enemy burn at start of their turn before they act', () => {
    const player = makePlayer()
    const enemy = makeEnemy({
      hp: 10,
      statuses: [{ kind: 'burn', stacks: 3 }],
      currentIntent: { kind: 'attack', amount: 4 },
    })
    const res = executeEnemyTurn(player, [enemy], [], { seed: 1 })
    // Burn deals 3 first, then attack still resolves.
    expect(res.enemies[0]?.hp).toBe(7)
    expect(res.player.hp).toBe(56)
    // Stacks decay by 1 each tick (StS pattern).
    expect(res.enemies[0]?.statuses[0]?.stacks).toBe(2)
  })

  it('burn that kills the enemy emits enemy-killed and skips its intent', () => {
    const player = makePlayer()
    const enemy = makeEnemy({
      hp: 2,
      statuses: [{ kind: 'burn', stacks: 5 }],
      currentIntent: { kind: 'attack', amount: 10 },
    })
    const res = executeEnemyTurn(player, [enemy], [], { seed: 1 })
    expect(res.enemies[0]?.hp).toBe(0)
    // Player took no damage — the enemy died before attacking.
    expect(res.player.hp).toBe(60)
    expect(res.events.some((e) => e.kind === 'enemy-killed')).toBe(true)
  })

  // FX-pipeline contract: damage-dealt (burn proc on enemy) must come
  // BEFORE the status-ticked / status-expired events, so the chip →
  // enemy-frame particle trail can snapshot the chip's position while
  // it's still mounted. Mirrors the player-side ordering in
  // turn.test.ts.
  it('emits damage-dealt before status-ticked/expired on enemy burn proc', () => {
    const enemy = makeEnemy({
      hp: 10,
      // Burn 2 → ticks (dmg 2), then stacks decays to 1 (status-ticked).
      // Burn 1 would expire (status-expired) — choose 2 so we test both
      // the dealt-then-ticked ordering case.
      statuses: [{ kind: 'burn', stacks: 2 }],
      currentIntent: { kind: 'attack', amount: 4 },
    })
    const res = executeEnemyTurn(makePlayer(), [enemy], [], { seed: 1 })
    const burnDealtIdx = res.events.findIndex(
      (e) => e.kind === 'damage-dealt' && e.source === 'burn',
    )
    const tickedIdx = res.events.findIndex((e) => e.kind === 'status-ticked')
    expect(burnDealtIdx).toBeGreaterThanOrEqual(0)
    expect(tickedIdx).toBeGreaterThanOrEqual(0)
    expect(burnDealtIdx).toBeLessThan(tickedIdx)
  })
})
