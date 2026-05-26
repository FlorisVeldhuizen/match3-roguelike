import { beforeAll, describe, expect, it } from 'vitest'
import { applyIntentTelegraph, rollIntent } from './intents'
import {
  resolveClusterShoveIntent,
  resolveColorHexIntent,
} from './intentResolvers'
import { processCascadeEvents } from './cascadeProcessor'
import { executeEnemyTurn } from './enemyTurn'
import { registerArchetype } from './archetypeRegistry'
import { tickHexedColors } from '../board/flags'
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  type Cell,
  type Enemy,
  type HexedColor,
  type Intent,
  type Player,
} from '../../types'

// Local archetype registration so the test doesn't depend on
// `content/enemies.ts` loading. Mirrors the H2b test setup.
beforeAll(() => {
  registerArchetype({
    id: 'caster',
    name: 'Caster',
    maxHp: 12,
    pattern: ['attack', 'color-hex'],
    attackRange: { min: 1, max: 2 },
    blockRange: { min: 0, max: 0 },
    colorHexDuration: 2,
    hexWeakStacksPerCell: 1,
  })
  registerArchetype({
    id: 'swarmer',
    name: 'Swarmer',
    maxHp: 8,
    pattern: ['attack', 'cluster-shove'],
    attackRange: { min: 1, max: 2 },
    blockRange: { min: 0, max: 0 },
    clusterShoveLength: 2,
  })
})

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
  ...overrides,
})

const makeCaster = (overrides: Partial<Enemy> = {}): Enemy => ({
  id: 'caster-1',
  name: 'Caster',
  archetype: 'caster',
  hp: 12,
  maxHp: 12,
  block: 0,
  currentIntent: { kind: 'attack', amount: 1 },
  nextIntentIndex: 0,
  statuses: [],
  ...overrides,
})

const makeSwarmer = (overrides: Partial<Enemy> = {}): Enemy => ({
  id: 'swarmer-1',
  name: 'Swarmer',
  archetype: 'swarmer',
  hp: 8,
  maxHp: 8,
  block: 0,
  currentIntent: { kind: 'attack', amount: 1 },
  nextIntentIndex: 0,
  statuses: [],
  ...overrides,
})

// 8x8 board factory; row pattern avoids any pre-existing 3-in-a-row.
const mkBoard8 = (): Cell[][] => {
  const colors: Array<Cell['gemColor']> = ['red', 'blue', 'green', 'yellow']
  return Array.from({ length: 8 }, (_, y) =>
    Array.from(
      { length: 8 },
      (_, x): Cell => ({
        gemColor: colors[(x + (y % 2 === 0 ? 0 : 2)) % 4]!,
      }),
    ),
  )
}

// ----------------------------------------------------------------------
// Intent rolling — color-hex + cluster-shove
// ----------------------------------------------------------------------
describe('rollIntent — H2c board verbs', () => {
  it('color-hex picks a valid gem colour', () => {
    let rng = { seed: 31 }
    const valid = new Set(['red', 'blue', 'green', 'yellow', 'purple'])
    for (let i = 0; i < 30; i++) {
      const r = rollIntent('caster', 1, rng)
      expect(r.intent.kind).toBe('color-hex')
      if (r.intent.kind === 'color-hex') {
        expect(valid.has(r.intent.color)).toBe(true)
      }
      rng = r.rng
    }
  })

  it('cluster-shove produces in-bounds, non-overlapping source + destination runs of length 2', () => {
    let rng = { seed: 7 }
    for (let i = 0; i < 30; i++) {
      const r = rollIntent('swarmer', 1, rng)
      expect(r.intent.kind).toBe('cluster-shove')
      if (r.intent.kind === 'cluster-shove') {
        expect(r.intent.sources.length).toBe(2)
        expect(r.intent.destinations.length).toBe(2)
        for (const p of [...r.intent.sources, ...r.intent.destinations]) {
          expect(p.x).toBeGreaterThanOrEqual(0)
          expect(p.x).toBeLessThan(BOARD_WIDTH)
          expect(p.y).toBeGreaterThanOrEqual(0)
          expect(p.y).toBeLessThan(BOARD_HEIGHT)
        }
        // No source overlaps a destination.
        for (const s of r.intent.sources) {
          for (const d of r.intent.destinations) {
            expect(s.x === d.x && s.y === d.y).toBe(false)
          }
        }
      }
      rng = r.rng
    }
  })
})

// ----------------------------------------------------------------------
// applyIntentTelegraph
// ----------------------------------------------------------------------
describe('applyIntentTelegraph — color-hex', () => {
  it('emits color-hex-placed without mutating the board', () => {
    const board = mkBoard8()
    const intent: Intent = { kind: 'color-hex', color: 'red' }
    const res = applyIntentTelegraph(board, {}, intent, 'caster-1', 'caster')
    expect(res.board).toBe(board)
    expect(
      res.events.some(
        (e) => e.kind === 'color-hex-placed' && e.color === 'red',
      ),
    ).toBe(true)
  })
})

describe('applyIntentTelegraph — cluster-shove', () => {
  it('flags each source cell with a pendingShove pointing to its destination', () => {
    const board = mkBoard8()
    const intent: Intent = {
      kind: 'cluster-shove',
      sources: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      destinations: [
        { x: 4, y: 4 },
        { x: 5, y: 4 },
      ],
    }
    const res = applyIntentTelegraph(board, {}, intent, 'swarmer-1', 'swarmer')
    expect(res.board[0]?.[0]?.flags?.pendingShove?.dst).toEqual({ x: 4, y: 4 })
    expect(res.board[0]?.[0]?.flags?.pendingShove?.sourceEnemyId).toBe(
      'swarmer-1',
    )
    expect(res.board[0]?.[1]?.flags?.pendingShove?.dst).toEqual({ x: 5, y: 4 })
    expect(res.board[0]?.[1]?.flags?.pendingShove?.sourceEnemyId).toBe(
      'swarmer-1',
    )
    // Unflagged cells stay clean.
    expect(res.board[0]?.[2]?.flags?.pendingShove).toBeUndefined()
    expect(
      res.events.some((e) => e.kind === 'cluster-shove-placed'),
    ).toBe(true)
  })
})

// ----------------------------------------------------------------------
// resolveColorHexIntent
// ----------------------------------------------------------------------
describe('resolveColorHexIntent', () => {
  it('pushes a new entry with the archetype duration', () => {
    const r = resolveColorHexIntent(
      { kind: 'color-hex', color: 'red' },
      makeCaster(),
      [],
    )
    expect(r.hexedColors).toEqual([{ color: 'red', turnsLeft: 2 }])
    expect(
      r.events.some(
        (e) =>
          e.kind === 'color-hex-fired' &&
          e.color === 'red' &&
          e.turnsLeft === 2,
      ),
    ).toBe(true)
  })

  it('refreshes to max(turnsLeft) when the same colour is already hexed', () => {
    const existing: HexedColor[] = [{ color: 'blue', turnsLeft: 3 }]
    const r = resolveColorHexIntent(
      { kind: 'color-hex', color: 'blue' },
      makeCaster(),
      existing,
    )
    // 3 (existing) > 2 (incoming) → keeps 3.
    expect(r.hexedColors).toEqual([{ color: 'blue', turnsLeft: 3 }])
  })

  it('keeps independent entries for different colours', () => {
    const existing: HexedColor[] = [{ color: 'red', turnsLeft: 1 }]
    const r = resolveColorHexIntent(
      { kind: 'color-hex', color: 'green' },
      makeCaster(),
      existing,
    )
    expect(r.hexedColors).toEqual([
      { color: 'red', turnsLeft: 1 },
      { color: 'green', turnsLeft: 2 },
    ])
  })
})

// ----------------------------------------------------------------------
// tickHexedColors
// ----------------------------------------------------------------------
describe('tickHexedColors', () => {
  it('decrements each entry; removes entries at 0', () => {
    const input: HexedColor[] = [
      { color: 'red', turnsLeft: 2 },
      { color: 'blue', turnsLeft: 1 },
    ]
    const r = tickHexedColors(input)
    expect(r.hexedColors).toEqual([{ color: 'red', turnsLeft: 1 }])
    // Both ticks emit an event; the blue one has remaining=0.
    const blueTick = r.events.find(
      (e) => e.kind === 'color-hex-ticked' && e.color === 'blue',
    )
    expect(blueTick).toBeDefined()
    if (blueTick?.kind === 'color-hex-ticked') {
      expect(blueTick.remaining).toBe(0)
    }
  })

  it('no-op on empty list', () => {
    const r = tickHexedColors([])
    expect(r.hexedColors).toEqual([])
    expect(r.events).toEqual([])
  })
})

// ----------------------------------------------------------------------
// processCascadeEvents — hex match side-effect
// ----------------------------------------------------------------------
describe('processCascadeEvents — color-hex Weak application', () => {
  it('applies Weak = match.cells.length when a hexed-colour match resolves', () => {
    const player = makePlayer()
    const cells = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]
    const stream = [
      { kind: 'cascade-start' as const, level: 0 },
      {
        kind: 'match-found' as const,
        cells,
        color: 'red' as const,
        size: 3,
        shape: 'line' as const,
        blessed: false,
      },
    ]
    const r = processCascadeEvents(stream, player, [], null, [
      { color: 'red', turnsLeft: 2 },
    ])
    const weak = r.player.statuses.find((s) => s.kind === 'weak')
    expect(weak).toBeDefined()
    expect(weak?.stacks).toBe(3)
    // hex-triggered event surfaces for FX layer.
    expect(
      r.events.some((e) => e.kind === 'hex-triggered' && e.color === 'red'),
    ).toBe(true)
  })

  it('does not apply Weak when the matched colour is not hexed', () => {
    const player = makePlayer()
    const cells = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]
    const stream = [
      { kind: 'cascade-start' as const, level: 0 },
      {
        kind: 'match-found' as const,
        cells,
        color: 'blue' as const,
        size: 3,
        shape: 'line' as const,
        blessed: false,
      },
    ]
    const r = processCascadeEvents(stream, player, [], null, [
      { color: 'red', turnsLeft: 2 },
    ])
    expect(r.player.statuses.find((s) => s.kind === 'weak')).toBeUndefined()
  })

  it('stacks additively onto existing Weak on repeated hex matches (H2c rule)', () => {
    const player = makePlayer({
      statuses: [{ kind: 'weak', stacks: 5 }],
    })
    const cells = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]
    const stream = [
      { kind: 'cascade-start' as const, level: 0 },
      {
        kind: 'match-found' as const,
        cells,
        color: 'red' as const,
        size: 3,
        shape: 'line' as const,
        blessed: false,
      },
    ]
    const r = processCascadeEvents(stream, player, [], null, [
      { color: 'red', turnsLeft: 2 },
    ])
    // 5 (existing) + 3 (incoming, per-cell of the 3-match) = 8.
    expect(r.player.statuses.find((s) => s.kind === 'weak')?.stacks).toBe(8)
  })
})

// ----------------------------------------------------------------------
// resolveClusterShoveIntent
// ----------------------------------------------------------------------
describe('resolveClusterShoveIntent', () => {
  it('shoves every flagged source to its destination; destinations carry the source colour', () => {
    const board = mkBoard8()
    // Stamp known colours on the source cells so we can verify the
    // destination cells inherit them.
    board[0]![0] = {
      gemColor: 'red',
      flags: {
        pendingShove: { dst: { x: 4, y: 4 }, sourceEnemyId: 'swarmer-1' },
      },
    }
    board[0]![1] = {
      gemColor: 'green',
      flags: {
        pendingShove: { dst: { x: 5, y: 4 }, sourceEnemyId: 'swarmer-1' },
      },
    }
    const res = resolveClusterShoveIntent(
      makeSwarmer(),
      board,
      { seed: 1 },
    )
    expect(res.board[4]?.[4]?.gemColor).toBe('red')
    expect(res.board[4]?.[5]?.gemColor).toBe('green')
    const resolved = res.events.find((e) => e.kind === 'cluster-shove-resolved')
    expect(resolved).toBeTruthy()
    if (resolved?.kind === 'cluster-shove-resolved') {
      expect(resolved.moves.length).toBe(2)
    }
  })

  it('counter-play: a source cell without its flag is not shoved', () => {
    const board = mkBoard8()
    // Only flag one of the two original sources — simulating the
    // player matching the other away before fire.
    board[0]![0] = {
      gemColor: 'red',
      flags: {
        pendingShove: { dst: { x: 4, y: 4 }, sourceEnemyId: 'swarmer-1' },
      },
    }
    // The cell at (1,0) has NO flag (already auto-cleared by a match).
    const res = resolveClusterShoveIntent(
      makeSwarmer(),
      board,
      { seed: 1 },
    )
    // Only the flagged cell shoved.
    expect(res.board[4]?.[4]?.gemColor).toBe('red')
    const resolved = res.events.find((e) => e.kind === 'cluster-shove-resolved')
    if (resolved?.kind === 'cluster-shove-resolved') {
      expect(resolved.moves.length).toBe(1)
    }
  })

  it('no-op when every source flag was cleared', () => {
    const board = mkBoard8()
    // No pendingShove flags anywhere.
    const res = resolveClusterShoveIntent(
      makeSwarmer(),
      board,
      { seed: 1 },
    )
    // Board reference unchanged on the no-op path.
    expect(res.board).toBe(board)
    const resolved = res.events.find((e) => e.kind === 'cluster-shove-resolved')
    if (resolved?.kind === 'cluster-shove-resolved') {
      expect(resolved.moves.length).toBe(0)
    }
  })

  it('only resolves flags belonging to the firing enemy (other swarmers wait their turn)', () => {
    const board = mkBoard8()
    // Two flagged sources: one for swarmer-1, one for swarmer-2.
    board[0]![0] = {
      gemColor: 'red',
      flags: {
        pendingShove: { dst: { x: 4, y: 4 }, sourceEnemyId: 'swarmer-1' },
      },
    }
    board[0]![1] = {
      gemColor: 'green',
      flags: {
        pendingShove: { dst: { x: 5, y: 4 }, sourceEnemyId: 'swarmer-2' },
      },
    }
    const res = resolveClusterShoveIntent(
      makeSwarmer({ id: 'swarmer-1' }),
      board,
      { seed: 1 },
    )
    // swarmer-1's shove fired …
    expect(res.board[4]?.[4]?.gemColor).toBe('red')
    // … swarmer-2's flag is untouched, ready for its own turn. (The
    // y-index isn't necessarily 0 anymore because gravity ran in the
    // intervening refill, so locate the flag by scanning the board.)
    let foundSwarmer2 = false
    for (let y = 0; y < res.board.length; y++) {
      for (let x = 0; x < (res.board[y]?.length ?? 0); x++) {
        const flag = res.board[y]?.[x]?.flags?.pendingShove
        if (flag && flag.sourceEnemyId === 'swarmer-2') foundSwarmer2 = true
      }
    }
    expect(foundSwarmer2).toBe(true)
    const resolved = res.events.find((e) => e.kind === 'cluster-shove-resolved')
    if (resolved?.kind === 'cluster-shove-resolved') {
      expect(resolved.moves.length).toBe(1)
    }
  })
})

// ----------------------------------------------------------------------
// executeEnemyTurn — H2c verbs
// ----------------------------------------------------------------------
describe('executeEnemyTurn — H2c verbs', () => {
  it('fires color-hex and pushes the colour into the returned hexedColors', () => {
    const board = mkBoard8()
    const player = makePlayer()
    const caster = makeCaster({
      id: 'caster-1',
      currentIntent: { kind: 'color-hex', color: 'green' },
    })
    const res = executeEnemyTurn(player, [caster], board, { seed: 1 }, {}, [])
    expect(res.hexedColors.find((h) => h.color === 'green')).toBeDefined()
    expect(
      res.events.some(
        (e) => e.kind === 'color-hex-fired' && e.color === 'green',
      ),
    ).toBe(true)
  })

  it('fires cluster-shove and emits cluster-shove-resolved', () => {
    const board = mkBoard8()
    // Pre-flag a source cell so the resolver has something to shove.
    board[0]![0] = {
      gemColor: 'red',
      flags: {
        pendingShove: { dst: { x: 4, y: 4 }, sourceEnemyId: 'swarmer-1' },
      },
    }
    const player = makePlayer()
    const swarmer = makeSwarmer({
      id: 'swarmer-1',
      currentIntent: {
        kind: 'cluster-shove',
        sources: [{ x: 0, y: 0 }],
        destinations: [{ x: 4, y: 4 }],
      },
    })
    const res = executeEnemyTurn(
      player,
      [swarmer],
      board,
      { seed: 1 },
      {},
      [],
    )
    expect(
      res.events.some((e) => e.kind === 'cluster-shove-resolved'),
    ).toBe(true)
  })
})
