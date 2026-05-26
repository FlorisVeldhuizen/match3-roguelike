import { beforeAll, describe, it, expect } from 'vitest'
import { executeEnemyTurn } from './enemyTurn'
import { registerArchetype } from './archetypeRegistry'
import type { Enemy, Player } from '../../types'

// Match the content def (`content/enemies.ts`) explicitly so tests don't
// cross the content/ boundary.
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

describe('executeEnemyTurn', () => {
  it('drains player block before HP', () => {
    const p = makePlayer({ block: 3 })
    const result = executeEnemyTurn(p, [makeEnemy()], [], { seed: 1 })
    expect(result.player.block).toBe(0)
    expect(result.player.hp).toBe(58)
    const dmg = result.events.find((e) => e.kind === 'damage-taken')
    expect(dmg).toMatchObject({ amount: 2, blocked: 3, source: 'enemy-attack' })
  })

  it('fully absorbs damage when block covers attack', () => {
    const p = makePlayer({ block: 10 })
    const result = executeEnemyTurn(p, [makeEnemy()], [], { seed: 1 })
    expect(result.player.block).toBe(5)
    expect(result.player.hp).toBe(60)
    const dmg = result.events.find((e) => e.kind === 'damage-taken')
    expect(dmg).toMatchObject({ amount: 0, blocked: 5 })
  })

  it('block currentIntent is a no-op (block was pre-applied at telegraph)', () => {
    // currentIntent=block means the block already went up at telegraph
    // time on the previous turn — re-applying it here would double it.
    const e = makeEnemy({
      currentIntent: { kind: 'block', amount: 4 },
      block: 4,
    })
    const result = executeEnemyTurn(makePlayer(), [e], [], { seed: 1 })
    const updated = result.enemies[0]
    // Block is unchanged by the currentIntent. (May still change if the
    // freshly-rolled next intent is also a block — separately tested.)
    expect(updated?.block).toBe(4)
  })

  it('pre-applies block when next rolled intent is block', () => {
    // Brute pattern is ['attack','attack','block','attack']. Starting at
    // nextIntentIndex=1 means executeEnemyTurn will roll pattern[2]='block'
    // for the next turn — that block should be applied to the enemy now.
    const e = makeEnemy({
      currentIntent: { kind: 'attack', amount: 5 },
      nextIntentIndex: 1,
      block: 0,
    })
    const result = executeEnemyTurn(makePlayer(), [e], [], { seed: 1 })
    const updated = result.enemies[0]
    expect(updated?.currentIntent.kind).toBe('block')
    const blockAmount =
      updated?.currentIntent.kind === 'block' ? updated.currentIntent.amount : 0
    expect(updated?.block).toBe(blockAmount)
    const gained = result.events.find((ev) => ev.kind === 'enemy-block-gained')
    expect(gained).toMatchObject({ enemyId: 'enemy-1', amount: blockAmount })
  })

  it('advances pattern index and rolls next intent', () => {
    const e = makeEnemy({ nextIntentIndex: 0 })
    const result = executeEnemyTurn(makePlayer(), [e], [], { seed: 1 })
    const updated = result.enemies[0]
    expect(updated?.nextIntentIndex).toBe(1)
    expect(updated?.currentIntent).toBeDefined()
    expect(result.events.some((ev) => ev.kind === 'intent-telegraphed')).toBe(true)
  })

  it('transitions to game-over when player HP hits 0', () => {
    const p = makePlayer({ hp: 3 })
    const e = makeEnemy({ currentIntent: { kind: 'attack', amount: 10 } })
    const result = executeEnemyTurn(p, [e], [], { seed: 1 })
    expect(result.player.hp).toBe(0)
    expect(result.phase).toBe('game-over')
    expect(result.events.at(-1)).toEqual({
      kind: 'phase-changed',
      phase: 'game-over',
    })
  })

  it('stays on player-acting when player survives', () => {
    const result = executeEnemyTurn(makePlayer(), [makeEnemy()], [], { seed: 1 })
    expect(result.phase).toBe('player-acting')
  })

  // The phase-changed:player-acting transition is deferred to the
  // caller (store.ts) so the HUD-side block-zero lands AFTER the
  // player's burn-tick events. Only the terminal game-over case is
  // emitted from here. If this regresses, block will visually drop to
  // zero before the burn animation finishes hitting it.
  it('does not emit phase-changed when transitioning to player-acting', () => {
    const result = executeEnemyTurn(makePlayer(), [makeEnemy()], [], { seed: 1 })
    expect(result.phase).toBe('player-acting')
    expect(result.events.some((e) => e.kind === 'phase-changed')).toBe(false)
  })

  it('skips dead enemies', () => {
    const dead = makeEnemy({ id: 'a', hp: 0 })
    const alive = makeEnemy({
      id: 'b',
      currentIntent: { kind: 'attack', amount: 4 },
    })
    const result = executeEnemyTurn(makePlayer(), [dead, alive], [], { seed: 1 })
    expect(result.player.hp).toBe(56)
    // Dead enemy's intent index unchanged.
    expect(result.enemies.find((e) => e.id === 'a')?.nextIntentIndex).toBe(0)
    expect(result.enemies.find((e) => e.id === 'b')?.nextIntentIndex).toBe(1)
  })

  it('stops processing once the player is dead', () => {
    const p = makePlayer({ hp: 2 })
    const first = makeEnemy({
      id: 'a',
      currentIntent: { kind: 'attack', amount: 5 },
    })
    const second = makeEnemy({
      id: 'b',
      currentIntent: { kind: 'attack', amount: 5 },
    })
    const result = executeEnemyTurn(p, [first, second], [], { seed: 1 })
    expect(result.player.hp).toBe(0)
    expect(result.phase).toBe('game-over')
    // Second enemy did not act — pattern index unchanged.
    expect(result.enemies.find((e) => e.id === 'b')?.nextIntentIndex).toBe(0)
  })

  it('is deterministic with the same seed', () => {
    const a = executeEnemyTurn(makePlayer(), [makeEnemy()], [], { seed: 99 })
    const b = executeEnemyTurn(makePlayer(), [makeEnemy()], [], { seed: 99 })
    expect(a.enemies[0]?.currentIntent).toEqual(b.enemies[0]?.currentIntent)
    expect(a.rng).toEqual(b.rng)
  })

  // --- Ally-target intent resolution ---

  it('heal-ally adds HP to target ally, capped at maxHp', () => {
    const ally = makeEnemy({ id: 'ally-1', name: 'Brute', hp: 10, maxHp: 20 })
    const healer = makeEnemy({
      id: 'healer-1',
      name: 'Brute',
      currentIntent: { kind: 'heal-ally', amount: 8, targetAllyId: 'ally-1' },
    })
    const result = executeEnemyTurn(makePlayer(), [ally, healer], [], { seed: 1 })
    const updatedAlly = result.enemies.find((e) => e.id === 'ally-1')
    expect(updatedAlly?.hp).toBe(18) // 10 + 8
    const ev = result.events.find((e) => e.kind === 'ally-healed')
    expect(ev).toMatchObject({ sourceId: 'healer-1', targetId: 'ally-1', amount: 8 })
  })

  it('heal-ally is capped at maxHp (no over-healing)', () => {
    const ally = makeEnemy({ id: 'ally-1', name: 'Brute', hp: 18, maxHp: 20 })
    const healer = makeEnemy({
      id: 'healer-1',
      name: 'Brute',
      currentIntent: { kind: 'heal-ally', amount: 10, targetAllyId: 'ally-1' },
    })
    const result = executeEnemyTurn(makePlayer(), [ally, healer], [], { seed: 1 })
    const updatedAlly = result.enemies.find((e) => e.id === 'ally-1')
    expect(updatedAlly?.hp).toBe(20) // capped at maxHp
    const ev = result.events.find((e) => e.kind === 'ally-healed')
    expect(ev).toMatchObject({ amount: 2 }) // only 2 effective healing
  })

  it('buff-ally applies strength stacks to target ally', () => {
    const ally = makeEnemy({ id: 'ally-1', name: 'Brute', statuses: [] })
    const buffer = makeEnemy({
      id: 'buffer-1',
      name: 'Rallier',
      archetype: 'rallier',
      currentIntent: { kind: 'buff-ally', stacks: 2, targetAllyId: 'ally-1' },
    })
    const result = executeEnemyTurn(makePlayer(), [ally, buffer], [], { seed: 1 })
    const updatedAlly = result.enemies.find((e) => e.id === 'ally-1')
    expect(updatedAlly?.statuses).toContainEqual({ kind: 'strength', stacks: 2 })
    const ev = result.events.find((e) => e.kind === 'status-applied')
    expect(ev).toMatchObject({ target: 'ally-1', status: { kind: 'strength', stacks: 2 } })
  })

  it('shield-ally adds block to target ally', () => {
    const ally = makeEnemy({ id: 'ally-1', name: 'Brute', block: 0 })
    const shielder = makeEnemy({
      id: 'shielder-1',
      name: 'Brute',
      currentIntent: { kind: 'shield-ally', amount: 5, targetAllyId: 'ally-1' },
    })
    const result = executeEnemyTurn(makePlayer(), [ally, shielder], [], { seed: 1 })
    const updatedAlly = result.enemies.find((e) => e.id === 'ally-1')
    expect(updatedAlly?.block).toBe(5)
    const ev = result.events.find((e) => e.kind === 'ally-shielded')
    expect(ev).toMatchObject({ sourceId: 'shielder-1', targetId: 'ally-1', amount: 5 })
  })

  it('ally-target intents are no-ops when target is dead', () => {
    const deadAlly = makeEnemy({ id: 'ally-1', name: 'Brute', hp: 0, maxHp: 20 })
    const healer = makeEnemy({
      id: 'healer-1',
      name: 'Brute',
      currentIntent: { kind: 'heal-ally', amount: 8, targetAllyId: 'ally-1' },
    })
    const result = executeEnemyTurn(makePlayer(), [deadAlly, healer], [], { seed: 1 })
    const updatedAlly = result.enemies.find((e) => e.id === 'ally-1')
    expect(updatedAlly?.hp).toBe(0) // dead, unchanged
    expect(result.events.some((e) => e.kind === 'ally-healed')).toBe(false)
  })

  // Burn ticks on enemies route through applyDamage so the enemy's own
  // block eats the burn first — symmetric with the player side.
  it('enemy burn tick is absorbed by enemy block before HP', () => {
    const burningEnemy = makeEnemy({
      hp: 20,
      block: 4,
      // 3 Burn → fully absorbed by 4 block; 1 block survives.
      statuses: [{ kind: 'burn', stacks: 3 }],
    })
    const result = executeEnemyTurn(makePlayer(), [burningEnemy], [], { seed: 1 })
    const e = result.enemies.find((x) => x.id === 'enemy-1')
    expect(e?.hp).toBe(20)
    expect(e?.block).toBe(1)
    const dd = result.events.find(
      (ev) => ev.kind === 'damage-dealt' && ev.source === 'burn',
    )
    expect(dd).toMatchObject({ amount: 0, blocked: 3 })
    expect(
      result.events.some(
        (ev) => ev.kind === 'block-absorbed' && ev.targetId === 'enemy-1',
      ),
    ).toBe(true)
  })
})
