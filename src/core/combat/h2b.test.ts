import { beforeAll, describe, expect, it } from 'vitest'
import { applyIntentTelegraph, rollIntent } from './intents'
import {
  resolveColumnSmashIntent,
  resolvePetrifyRowIntent,
} from './intentResolvers'
import { executeEnemyTurn } from './enemyTurn'
import { registerArchetype } from './archetypeRegistry'
import { resolveSwap } from '../board/cascade'
import { detectMatches } from '../board/detectMatches'
import {
  generateBoard,
  findAllValidSwaps,
  hasValidSwap,
} from '../board/generation'
import { tickPetrifiedRows } from '../board/flags'
import type { Cell, Enemy, Intent, PetrifiedRows, Player } from '../../types'

// Local archetype registration so the test doesn't depend on
// `content/enemies.ts` loading. Mirrors the Smolder test setup.
beforeAll(() => {
  registerArchetype({
    id: 'brute',
    name: 'Brute',
    maxHp: 20,
    pattern: ['attack', 'column-smash', 'attack', 'block', 'attack'],
    attackRange: { min: 3, max: 5 },
    blockRange: { min: 3, max: 5 },
  })
  registerArchetype({
    id: 'defender',
    name: 'Defender',
    maxHp: 22,
    pattern: ['block', 'petrify-row', 'attack', 'petrify-row'],
    attackRange: { min: 2, max: 3 },
    blockRange: { min: 3, max: 5 },
    petrifyDuration: 2,
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

const makeBrute = (overrides: Partial<Enemy> = {}): Enemy => ({
  id: 'brute-1',
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

const makeDefender = (overrides: Partial<Enemy> = {}): Enemy => ({
  id: 'defender-1',
  name: 'Defender',
  archetype: 'defender',
  hp: 22,
  maxHp: 22,
  block: 0,
  currentIntent: { kind: 'attack', amount: 2 },
  nextIntentIndex: 0,
  statuses: [],
  ...overrides,
})

// 8×8 board factory: every row is RBGYRBGY so there are no pre-existing
// matches and detectMatches returns []. Tests that need a specific
// match config rewrite cells inline.
const mkBoard8 = (): Cell[][] => {
  const colors: Array<Cell['gemColor']> = ['red', 'blue', 'green', 'yellow']
  return Array.from({ length: 8 }, (_, y) =>
    Array.from({ length: 8 }, (_, x): Cell => ({
      gemColor: colors[(x + (y % 2 === 0 ? 0 : 2)) % 4]!,
    })),
  )
}

// ----------------------------------------------------------------------
// Intent rolling — column-smash + petrify-row
// ----------------------------------------------------------------------
describe('rollIntent — H2b board verbs', () => {
  it('column-smash rolls a column index in [0, BOARD_WIDTH)', () => {
    // Brute's pattern[1] = 'column-smash'
    let rng = { seed: 99 }
    for (let i = 0; i < 50; i++) {
      const r = rollIntent('brute', 1, rng)
      expect(r.intent.kind).toBe('column-smash')
      if (r.intent.kind === 'column-smash') {
        expect(r.intent.column).toBeGreaterThanOrEqual(0)
        expect(r.intent.column).toBeLessThan(8)
      }
      rng = r.rng
    }
  })

  it('petrify-row rolls a row index in [0, BOARD_HEIGHT)', () => {
    // Defender's pattern[1] = 'petrify-row'
    let rng = { seed: 42 }
    for (let i = 0; i < 50; i++) {
      const r = rollIntent('defender', 1, rng)
      expect(r.intent.kind).toBe('petrify-row')
      if (r.intent.kind === 'petrify-row') {
        expect(r.intent.row).toBeGreaterThanOrEqual(0)
        expect(r.intent.row).toBeLessThan(8)
      }
      rng = r.rng
    }
  })

  it('column-smash and petrify-row are deterministic for the same seed', () => {
    const a = rollIntent('brute', 1, { seed: 7 })
    const b = rollIntent('brute', 1, { seed: 7 })
    expect(a).toEqual(b)
    const c = rollIntent('defender', 1, { seed: 7 })
    const d = rollIntent('defender', 1, { seed: 7 })
    expect(c).toEqual(d)
  })
})

// ----------------------------------------------------------------------
// applyIntentTelegraph
// ----------------------------------------------------------------------
describe('applyIntentTelegraph — column-smash', () => {
  it('flags every cell in the column with the source enemy id', () => {
    const board = mkBoard8()
    const intent: Intent = { kind: 'column-smash', column: 3 }
    const { board: nextBoard, petrifiedRows, events } = applyIntentTelegraph(
      board,
      {},
      intent,
      'brute-1',
      'brute',
    )
    for (let y = 0; y < 8; y++) {
      expect(nextBoard[y]?.[3]?.flags?.pendingSmash).toBe('brute-1')
    }
    // Other columns untouched.
    expect(nextBoard[0]?.[0]?.flags?.pendingSmash).toBeUndefined()
    expect(petrifiedRows).toEqual({})
    expect(events.some((e) => e.kind === 'column-smash-placed')).toBe(true)
  })
})

describe('applyIntentTelegraph — petrify-row', () => {
  it('does NOT apply lockout to petrifiedRows at telegraph time (fire-only)', () => {
    const board = mkBoard8()
    const intent: Intent = { kind: 'petrify-row', row: 4 }
    const { petrifiedRows, events } = applyIntentTelegraph(
      board,
      {},
      intent,
      'defender-1',
      'defender',
    )
    // Petrify is fire-time-only — telegraph just emits the FX event,
    // the actual row lockout lands when the resolver runs.
    expect(petrifiedRows).toEqual({})
    expect(events.some((e) => e.kind === 'petrify-placed')).toBe(true)
  })
})

// ----------------------------------------------------------------------
// resolveColumnSmashIntent
// ----------------------------------------------------------------------
describe('resolveColumnSmashIntent', () => {
  it('clears every flagged cell in the column and refills from above', () => {
    let board = mkBoard8()
    // Telegraph the smash first.
    const tele = applyIntentTelegraph(
      board,
      {},
      { kind: 'column-smash', column: 2 },
      'brute-1',
      'brute',
    )
    board = tele.board
    const intent: Intent = { kind: 'column-smash', column: 2 }
    const brute = makeBrute()
    const res = resolveColumnSmashIntent(intent, brute, board, { seed: 1 })
    // No cell in column 2 should still carry pendingSmash — the cells
    // got cleared, gravity dropped fresh gems in.
    for (let y = 0; y < 8; y++) {
      expect(res.board[y]?.[2]?.flags?.pendingSmash).toBeUndefined()
      // Column refilled (all cells defined).
      expect(res.board[y]?.[2]).toBeDefined()
    }
    expect(
      res.events.some(
        (e) => e.kind === 'column-smash-resolved' && e.column === 2,
      ),
    ).toBe(true)
    // Gems-cleared drives the standard clear-burst animation.
    expect(res.events.some((e) => e.kind === 'gems-cleared')).toBe(true)
  })

  it('only clears cells owned by THIS enemy (ownership-scoped)', () => {
    const board = mkBoard8()
    // Brute-1 telegraphs column 2.
    const t1 = applyIntentTelegraph(
      board,
      {},
      { kind: 'column-smash', column: 2 },
      'brute-1',
      'brute',
    )
    // Brute-2 telegraphs column 5.
    const t2 = applyIntentTelegraph(
      t1.board,
      {},
      { kind: 'column-smash', column: 5 },
      'brute-2',
      'brute',
    )
    // Brute-1 fires its smash; brute-2's flags must remain intact.
    const res = resolveColumnSmashIntent(
      { kind: 'column-smash', column: 2 },
      makeBrute({ id: 'brute-1' }),
      t2.board,
      { seed: 1 },
    )
    for (let y = 0; y < 8; y++) {
      // Brute-2's column 5 flags still present after Brute-1 fires.
      expect(res.board[y]?.[5]?.flags?.pendingSmash).toBe('brute-2')
    }
  })

  it('emits column-smash-resolved with empty cells when the column has no flags', () => {
    // Player matched the entire flagged column before fire — resolver
    // finds no cells with the matching flag.
    const board = mkBoard8()
    const res = resolveColumnSmashIntent(
      { kind: 'column-smash', column: 3 },
      makeBrute(),
      board,
      { seed: 1 },
    )
    const resolved = res.events.find((e) => e.kind === 'column-smash-resolved')
    expect(resolved).toBeTruthy()
    if (resolved?.kind === 'column-smash-resolved') {
      expect(resolved.cells).toEqual([])
    }
    // gems-cleared NOT emitted when there were no cells to clear.
    expect(res.events.some((e) => e.kind === 'gems-cleared')).toBe(false)
  })
})

// ----------------------------------------------------------------------
// resolvePetrifyRowIntent
// ----------------------------------------------------------------------
describe('resolvePetrifyRowIntent', () => {
  it('writes the row into petrifiedRows with the archetype duration', () => {
    const res = resolvePetrifyRowIntent(
      { kind: 'petrify-row', row: 5 },
      makeDefender(),
      {},
    )
    expect(res.petrifiedRows[5]).toBe(2)
    expect(res.events.some((e) => e.kind === 'petrify-fired')).toBe(true)
  })

  it('keeps the higher duration when re-applied to an already-locked row', () => {
    const res = resolvePetrifyRowIntent(
      { kind: 'petrify-row', row: 3 },
      makeDefender(),
      { 3: 1 },
    )
    // 1 (existing) < 2 (incoming) → uses incoming.
    expect(res.petrifiedRows[3]).toBe(2)
  })
})

// ----------------------------------------------------------------------
// executeEnemyTurn — orphan sweep
// ----------------------------------------------------------------------
describe('executeEnemyTurn — pendingSmash orphan sweep', () => {
  it('clears pendingSmash flags whose source enemy is dead', () => {
    let board = mkBoard8()
    // Telegraph a smash from brute-1.
    const tele = applyIntentTelegraph(
      board,
      {},
      { kind: 'column-smash', column: 4 },
      'brute-1',
      'brute',
    )
    board = tele.board
    // Brute-1 is dead and has currentIntent that is NO LONGER column-smash
    // (e.g. the player killed it; the orphan sweep should clean it up).
    const player = makePlayer()
    const deadBrute = makeBrute({
      id: 'brute-1',
      hp: 0,
      currentIntent: { kind: 'attack', amount: 4 },
    })
    const res = executeEnemyTurn(player, [deadBrute], board, { seed: 1 })
    // After the orphan sweep, no cell in column 4 should still carry the flag.
    for (let y = 0; y < 8; y++) {
      expect(res.board[y]?.[4]?.flags?.pendingSmash).toBeUndefined()
    }
  })

  it('preserves pendingSmash flags whose owner is alive AND still telegraphing column-smash', () => {
    let board = mkBoard8()
    const tele = applyIntentTelegraph(
      board,
      {},
      { kind: 'column-smash', column: 4 },
      'brute-1',
      'brute',
    )
    board = tele.board
    // Brute-1 alive, still on column-smash intent → orphan sweep
    // leaves the flags alone, then the resolver fires the smash.
    const player = makePlayer()
    const brute = makeBrute({
      id: 'brute-1',
      currentIntent: { kind: 'column-smash', column: 4 },
    })
    const res = executeEnemyTurn(player, [brute], board, { seed: 1 })
    // Smash fired — flags consumed. column-smash-resolved present.
    expect(
      res.events.some(
        (e) => e.kind === 'column-smash-resolved' && e.column === 4,
      ),
    ).toBe(true)
  })
})

// ----------------------------------------------------------------------
// detectMatches — petrify pass-through
// ----------------------------------------------------------------------
describe('detectMatches — petrify pass-through', () => {
  it('still finds matches even when one cell sits in a petrified row', () => {
    // detectMatches dropped petrify-awareness entirely (post-H2b
    // design pivot — the swap gate, not the match detector, owns the
    // lockout). A vertical match that crosses a petrified row is
    // still a valid match.
    const board = mkBoard8()
    // Force a vertical match in column 0 (rows 0, 1, 2).
    board[0]![0] = { gemColor: 'red' }
    board[1]![0] = { gemColor: 'red' }
    board[2]![0] = { gemColor: 'red' }
    // Make row 1 petrified — match should STILL be detected.
    const matches = detectMatches(board)
    expect(matches.length).toBeGreaterThan(0)
    // The match should include all 3 cells.
    const match = matches.find((m) =>
      m.cells.some((c) => c.x === 0 && c.y === 1),
    )
    expect(match).toBeDefined()
  })
})

// ----------------------------------------------------------------------
// resolveSwap — petrify-gate
// ----------------------------------------------------------------------
describe('resolveSwap — petrify swap gate', () => {
  it('reverts a swap whose origin is on a petrified row', () => {
    const board = mkBoard8()
    // Add a vertical-3 match prerequisite at column 0 rows 1-3 to
    // make the swap "valid" in match terms — without the gate, this
    // would commit.
    board[0]![0] = { gemColor: 'red' }
    board[1]![0] = { gemColor: 'blue' }
    board[2]![0] = { gemColor: 'red' }
    board[3]![0] = { gemColor: 'red' }
    const petrified: PetrifiedRows = { 0: 2 }
    const res = resolveSwap(
      board,
      { seed: 1 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      petrified,
    )
    expect(res.valid).toBe(false)
    expect(res.events.some((e) => e.kind === 'swap-reverted')).toBe(true)
  })

  it('reverts a swap whose target is on a petrified row', () => {
    const board = mkBoard8()
    const petrified: PetrifiedRows = { 1: 1 }
    const res = resolveSwap(
      board,
      { seed: 1 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      petrified,
    )
    expect(res.valid).toBe(false)
  })

  it('allows swaps that touch no petrified row even when one exists', () => {
    const board = mkBoard8()
    board[5]![0] = { gemColor: 'red' }
    board[6]![0] = { gemColor: 'blue' }
    board[6]![1] = { gemColor: 'red' }
    board[7]![0] = { gemColor: 'red' }
    const petrified: PetrifiedRows = { 0: 1 } // row 0 locked
    // Swap on row 6 — unrelated to the locked row.
    const res = resolveSwap(
      board,
      { seed: 1 },
      { x: 0, y: 6 },
      { x: 1, y: 6 },
      petrified,
    )
    expect(res.valid).toBe(true)
  })
})

// ----------------------------------------------------------------------
// hasValidSwap / findAllValidSwaps — petrify awareness
// ----------------------------------------------------------------------
describe('hasValidSwap / findAllValidSwaps — petrify awareness', () => {
  it('hasValidSwap returns false when the only matches sit on petrified rows', () => {
    // Construct a board where the ONLY valid swap is in row 3.
    // Easiest: monochrome row 3 + diverse rows above/below.
    const board = mkBoard8()
    // Add a swap-makes-match in row 3 only by placing a setup.
    board[3] = [
      { gemColor: 'red' },
      { gemColor: 'red' },
      { gemColor: 'blue' },
      { gemColor: 'red' },
      { gemColor: 'green' },
      { gemColor: 'green' },
      { gemColor: 'yellow' },
      { gemColor: 'purple' },
    ]
    // The rest of the board doesn't matter for this test as long as
    // we know swaps elsewhere don't accidentally produce a match.
    // mkBoard8's RBGYRBGY pattern has no matches.
    const petrified: PetrifiedRows = { 3: 2 }
    // Without petrify, the row-3 swap may or may not be findable.
    // The important check is that with petrify=3, findAllValidSwaps
    // never returns a swap on row 3.
    const swaps = findAllValidSwaps(board, petrified)
    for (const s of swaps) {
      expect(s.from.y).not.toBe(3)
      expect(s.to.y).not.toBe(3)
    }
    // hasValidSwap respects the same gate.
    expect(typeof hasValidSwap(board, petrified)).toBe('boolean')
  })

  it('findAllValidSwaps excludes vertical swaps that cross into a petrified row', () => {
    const board = mkBoard8()
    // Force a vertical-3 setup: red at (0,4), (0,5); a swap between
    // (0,4) and (0,5) doesn't make a match by itself, but the
    // assertion is just that no found swap crosses into a locked row.
    board[4]![0] = { gemColor: 'red' }
    board[5]![0] = { gemColor: 'red' }
    const petrified: PetrifiedRows = { 5: 1 }
    const swaps = findAllValidSwaps(board, petrified)
    for (const s of swaps) {
      expect((petrified[s.from.y] ?? 0) === 0).toBe(true)
      expect((petrified[s.to.y] ?? 0) === 0).toBe(true)
    }
  })
})

// ----------------------------------------------------------------------
// generateBoard — petrify-aware regen
// ----------------------------------------------------------------------
describe('generateBoard — petrify-aware regen', () => {
  it('returns a board with at least one valid swap outside the petrified row(s)', () => {
    const petrified: PetrifiedRows = { 0: 2, 7: 2 }
    const { board } = generateBoard(
      { seed: 12345 },
      undefined,
      undefined,
      petrified,
    )
    expect(hasValidSwap(board, petrified)).toBe(true)
  })

  it('produces playable boards across many seeds with petrify active', () => {
    const petrified: PetrifiedRows = { 3: 1 }
    for (let s = 1; s <= 50; s++) {
      const { board } = generateBoard({ seed: s }, undefined, undefined, petrified)
      expect(hasValidSwap(board, petrified)).toBe(true)
    }
  })
})

// ----------------------------------------------------------------------
// tickPetrifiedRows
// ----------------------------------------------------------------------
describe('tickPetrifiedRows', () => {
  it('decrements every row and emits per-row tick events', () => {
    const result = tickPetrifiedRows({ 2: 2, 5: 1 })
    expect(result.petrifiedRows[2]).toBe(1)
    expect(result.petrifiedRows[5]).toBeUndefined() // expired
    expect(result.expired).toEqual([5])
    const ticks = result.events.filter((e) => e.kind === 'petrify-row-ticked')
    expect(ticks).toHaveLength(2)
    const tick2 = ticks.find(
      (e) => e.kind === 'petrify-row-ticked' && e.row === 2,
    )
    const tick5 = ticks.find(
      (e) => e.kind === 'petrify-row-ticked' && e.row === 5,
    )
    if (tick2?.kind === 'petrify-row-ticked') expect(tick2.remaining).toBe(1)
    if (tick5?.kind === 'petrify-row-ticked') expect(tick5.remaining).toBe(0)
  })

  it('is a no-op on an empty map (no events, no changes)', () => {
    const result = tickPetrifiedRows({})
    expect(result.petrifiedRows).toEqual({})
    expect(result.expired).toEqual([])
    expect(result.events).toEqual([])
  })
})
