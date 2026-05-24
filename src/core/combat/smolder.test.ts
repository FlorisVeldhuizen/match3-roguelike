import { beforeAll, describe, expect, it } from 'vitest'
import { executeEnemyTurn } from './enemyTurn'
import { registerArchetype } from './archetypeRegistry'
import { resolveSwap } from '../board/cascade'
import { applyFlagToCells } from '../board/flags'
import type { Cell, Enemy, Player } from '../../types'

beforeAll(() => {
  registerArchetype({
    id: 'smolder',
    name: 'Smolder',
    maxHp: 18,
    pattern: ['attack', 'tile-burn', 'attack', 'attack'],
    attackRange: { min: 2, max: 4 },
    blockRange: { min: 0, max: 0 },
    tileBurnCount: 2,
    tileBurnDuration: 3,
    onHitStatus: { kind: 'burn', stacks: 2 },
  })
})

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

const makeSmolder = (overrides: Partial<Enemy> = {}): Enemy => ({
  id: 'smolder-1',
  name: 'Smolder',
  archetype: 'smolder',
  hp: 18,
  maxHp: 18,
  block: 0,
  currentIntent: { kind: 'attack', amount: 3 },
  nextIntentIndex: 0,
  statuses: [],
  ...overrides,
})

// Tiny 4×4 board so it's easy to construct + reason about.
const mkBoard = (rows: string[]): Cell[][] => {
  const colorByChar: Record<string, Cell['gemColor']> = {
    R: 'red',
    B: 'blue',
    G: 'green',
    Y: 'yellow',
    P: 'purple',
  }
  return rows.map((r) =>
    r.split('').map((ch) => {
      const color = colorByChar[ch]
      if (!color) throw new Error(`bad gem ${ch}`)
      return { gemColor: color }
    }),
  )
}

describe('Smolder attack — onHitStatus rider', () => {
  it('applies Burn to the player when the attack lands hp damage', () => {
    const player = makePlayer()
    const smolder = makeSmolder({ currentIntent: {
        kind: 'attack',
        amount: 4,
        onHit: { status: 'burn', stacks: 2 },
      } })
    const res = executeEnemyTurn(player, [smolder], [], { seed: 1 })
    expect(res.player.hp).toBe(36)
    const burn = res.player.statuses.find((s) => s.kind === 'burn')
    expect(burn).toMatchObject({ kind: 'burn', stacks: 2 })
    expect(res.events.some((e) => e.kind === 'status-applied')).toBe(true)
  })

  it('does NOT apply Burn when block fully absorbs the attack', () => {
    const player = makePlayer({ block: 10 })
    const smolder = makeSmolder({ currentIntent: {
        kind: 'attack',
        amount: 4,
        onHit: { status: 'burn', stacks: 2 },
      } })
    const res = executeEnemyTurn(player, [smolder], [], { seed: 1 })
    expect(res.player.hp).toBe(40)
    expect(res.player.statuses.find((s) => s.kind === 'burn')).toBeUndefined()
  })
})

describe('Smolder tile-burn intent', () => {
  it('flags `count` previously-unflagged cells as burning on its tile-burn turn', () => {
    const board = mkBoard(['RBRB', 'BRBR', 'RBRB', 'BRBR'])
    const player = makePlayer()
    const smolder = makeSmolder({
      currentIntent: { kind: 'tile-burn', count: 2 },
      // pattern index 0 here so the test does not depend on
      // archetype pattern advancement.
      nextIntentIndex: 0,
    })
    const res = executeEnemyTurn(player, [smolder], board, { seed: 1 })

    const burningCount = res.board
      .flat()
      .filter((c) => (c.flags?.burning ?? 0) > 0).length
    expect(burningCount).toBe(2)

    const placed = res.events.find((e) => e.kind === 'tile-burn-placed')
    expect(placed).toBeTruthy()
    if (placed?.kind === 'tile-burn-placed') {
      expect(placed.cells).toHaveLength(2)
      expect(placed.enemyId).toBe('smolder-1')
    }
  })

  it('skips cells that already carry the burning flag', () => {
    let board = mkBoard(['RBRB', 'BRBR', 'RBRB', 'BRBR'])
    // Pre-flag two corners; tile-burn should pick from the other 14.
    board = applyFlagToCells(
      board,
      [{ x: 0, y: 0 }, { x: 3, y: 3 }],
      'burning',
      2,
    )
    const smolder = makeSmolder({
      currentIntent: { kind: 'tile-burn', count: 2 },
    })
    const res = executeEnemyTurn(makePlayer(), [smolder], board, { seed: 7 })

    const placed = res.events.find((e) => e.kind === 'tile-burn-placed')
    if (placed?.kind !== 'tile-burn-placed') throw new Error('expected placed')
    for (const p of placed.cells) {
      expect(p).not.toEqual({ x: 0, y: 0 })
      expect(p).not.toEqual({ x: 3, y: 3 })
    }
    // Original two are still burning.
    expect(res.board[0]?.[0]?.flags?.burning).toBe(2)
    expect(res.board[3]?.[3]?.flags?.burning).toBe(2)
  })
})

describe('cascade emits tile-burn-triggered on burning cell clears', () => {
  it('emits one stack per cleared burning cell', () => {
    // Row 0: RRG?  We swap col 2 row 0 with col 2 row 1 (G↔R) to make
    // the top row become RRR? — a 3-match clears (0,0),(1,0),(2,0).
    // Wait, we need a row of 3 same colors after the swap. Let me set up
    // a known-good swap: top row "RRBR", row 1 "BBRB"; swap (2,0) with
    // (2,1): top becomes "RRRR" → 4-match line.
    let board = mkBoard(['RRBR', 'BBRB', 'GYGY', 'YGYG'])
    // Flag cells (0,0) and (1,0) as burning — both will be cleared.
    board = applyFlagToCells(
      board,
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      'burning',
      2,
    )
    const res = resolveSwap(board, { seed: 99 }, { x: 2, y: 0 }, { x: 2, y: 1 })
    expect(res.valid).toBe(true)
    const burnEv = res.events.find((e) => e.kind === 'tile-burn-triggered')
    expect(burnEv).toBeTruthy()
    if (burnEv?.kind === 'tile-burn-triggered') {
      // Both flagged cells were in the cleared set. The consumer
      // computes Burn magnitude from cells.length + BURN_FROM_TILE_BONUS;
      // the event itself just carries the cells.
      expect(burnEv.cells).toHaveLength(2)
    }
  })

  it("does NOT emit when no burning cells were among the cleared", () => {
    const board = mkBoard(['RRBR', 'BBRB', 'GYGY', 'YGYG'])
    const res = resolveSwap(board, { seed: 99 }, { x: 2, y: 0 }, { x: 2, y: 1 })
    expect(res.valid).toBe(true)
    expect(res.events.some((e) => e.kind === 'tile-burn-triggered')).toBe(false)
  })
})
