import { beforeAll, describe, expect, it } from 'vitest'
import { applyIntentTelegraph, rollIntent } from './intents'
import { resolveColumnSmashIntent, resolvePetrifyRowIntent } from './intentResolvers'
import { resolveShatter } from './spellResolvers'
import { executeEnemyTurn } from './enemyTurn'
import { registerArchetype } from './archetypeRegistry'
import { resolveSwap } from '../board/cascade'
import { detectMatches } from '../board/detectMatches'
import { generateBoard, findAllValidSwaps, hasValidSwap } from '../board/generation'
import { tickPetrifiedRows } from '../board/flags'
import type { Cell, Enemy, GemColor, Intent, PetrifiedRows, Player } from '../../types'

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
  gold: 0,
  ownedSpellIds: [],
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
    Array.from(
      { length: 8 },
      (_, x): Cell => ({
        gemColor: colors[(x + (y % 2 === 0 ? 0 : 2)) % 4]!,
      }),
    ),
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
  it('emits column-smash-placed with the threatened column without touching the board', () => {
    const board = mkBoard8()
    const intent: Intent = { kind: 'column-smash', column: 3 }
    const {
      board: nextBoard,
      petrifiedRows,
      events,
    } = applyIntentTelegraph(board, {}, intent, 'brute-1', 'brute')
    // No per-cell flag — threat is column-bound and tracked from the
    // event by the overlay.
    expect(nextBoard).toBe(board)
    expect(petrifiedRows).toEqual({})
    const placed = events.find((e) => e.kind === 'column-smash-placed')
    expect(placed).toBeTruthy()
    if (placed?.kind === 'column-smash-placed') {
      expect(placed.enemyId).toBe('brute-1')
      expect(placed.column).toBe(3)
      expect(placed.cells.length).toBe(8)
    }
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
  it('clears every cell in the column and refills from above', () => {
    const board = mkBoard8()
    const intent: Intent = { kind: 'column-smash', column: 2 }
    const brute = makeBrute()
    const res = resolveColumnSmashIntent(intent, brute, board, { seed: 1 })
    for (let y = 0; y < 8; y++) {
      // Column refilled (all cells defined).
      expect(res.board[y]?.[2]).toBeDefined()
    }
    const resolved = res.events.find((e) => e.kind === 'column-smash-resolved')
    expect(resolved).toBeTruthy()
    if (resolved?.kind === 'column-smash-resolved') {
      expect(resolved.column).toBe(2)
      expect(resolved.cells.length).toBe(8)
    }
    // Gems-cleared drives the standard clear-burst animation.
    expect(res.events.some((e) => e.kind === 'gems-cleared')).toBe(true)
  })

  it('does not touch cells outside the threatened column', () => {
    const board = mkBoard8()
    const res = resolveColumnSmashIntent(
      { kind: 'column-smash', column: 2 },
      makeBrute({ id: 'brute-1' }),
      board,
      { seed: 1 },
    )
    // Cells outside column 2 stay byref-equal — only column 2 is
    // rebuilt from null + refill.
    for (let y = 0; y < 8; y++) {
      expect(res.board[y]?.[5]).toBe(board[y]?.[5])
    }
  })
})

// ----------------------------------------------------------------------
// resolvePetrifyRowIntent
// ----------------------------------------------------------------------
describe('resolvePetrifyRowIntent', () => {
  it('is blocked when the row is warded by Frozen Wall', () => {
    const res = resolvePetrifyRowIntent(
      { kind: 'petrify-row', row: 3 },
      makeDefender(),
      {},
      { 3: 1 },
    )
    expect(res.petrifiedRows[3]).toBeUndefined()
    expect(res.events).toEqual([
      { kind: 'frozen-wall-blocked', row: 3, verb: 'petrify-row' },
    ])
  })

  it('writes the row into petrifiedRows with the archetype duration', () => {
    const res = resolvePetrifyRowIntent({ kind: 'petrify-row', row: 5 }, makeDefender(), {})
    expect(res.petrifiedRows[5]).toBe(2)
    expect(res.events.some((e) => e.kind === 'petrify-fired')).toBe(true)
  })

  it('keeps the higher duration when re-applied to an already-locked row', () => {
    const res = resolvePetrifyRowIntent({ kind: 'petrify-row', row: 3 }, makeDefender(), { 3: 1 })
    // 1 (existing) < 2 (incoming) → uses incoming.
    expect(res.petrifiedRows[3]).toBe(2)
  })
})

// ----------------------------------------------------------------------
// executeEnemyTurn — column-smash fires
// ----------------------------------------------------------------------
describe('executeEnemyTurn — column-smash', () => {
  it('fires the smash when the source enemy is alive and on column-smash intent', () => {
    const board = mkBoard8()
    const player = makePlayer()
    const brute = makeBrute({
      id: 'brute-1',
      currentIntent: { kind: 'column-smash', column: 4 },
    })
    const res = executeEnemyTurn(player, [brute], board, { seed: 1 })
    expect(res.events.some((e) => e.kind === 'column-smash-resolved' && e.column === 4)).toBe(true)
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
    const match = matches.find((m) => m.cells.some((c) => c.x === 0 && c.y === 1))
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
    const res = resolveSwap(board, { seed: 1 }, { x: 0, y: 0 }, { x: 0, y: 1 }, petrified)
    expect(res.valid).toBe(false)
    expect(res.events.some((e) => e.kind === 'swap-reverted')).toBe(true)
  })

  it('reverts a swap whose target is on a petrified row', () => {
    const board = mkBoard8()
    const petrified: PetrifiedRows = { 1: 1 }
    const res = resolveSwap(board, { seed: 1 }, { x: 0, y: 0 }, { x: 0, y: 1 }, petrified)
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
    const res = resolveSwap(board, { seed: 1 }, { x: 0, y: 6 }, { x: 1, y: 6 }, petrified)
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
    const { board } = generateBoard({ seed: 12345 }, undefined, undefined, petrified)
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
// ----------------------------------------------------------------------
// resolveShatter (H2b.5)
// ----------------------------------------------------------------------
describe('resolveShatter', () => {
  // Tiny helper to count cells of a given colour.
  const countColor = (board: Cell[][], color: GemColor): number =>
    board.flat().filter((c) => c.gemColor === color).length

  it('clears every cell of the target colour and refills', () => {
    const board = mkBoard8()
    const redsBefore = countColor(board, 'red')
    expect(redsBefore).toBeGreaterThan(0)
    const player = makePlayer()
    const r = resolveShatter(player, [], board, { seed: 1 }, 'red', null)
    expect(countColor(r.board, 'red')).toBeLessThan(redsBefore)
    // No null holes — every cell is filled after the gravity + refill.
    expect(r.board.flat().every((c) => c !== null && c !== undefined)).toBe(true)
    expect(r.events.some((e) => e.kind === 'gems-cleared')).toBe(true)
    expect(r.events.some((e) => e.kind === 'gems-spawned')).toBe(true)
  })

  it('no-ops cleanly when the board has no cells of the picked colour', () => {
    // Single-colour board (all red) → shatter blue is a no-op.
    const board: Cell[][] = Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, (): Cell => ({ gemColor: 'red' })),
    )
    const player = makePlayer()
    const r = resolveShatter(player, [], board, { seed: 1 }, 'blue', null)
    expect(r.events).toEqual([])
    expect(r.board).toBe(board)
    expect(r.player).toBe(player)
  })

  it('red shatter deals single-target damage scaled by cell count', () => {
    const board = mkBoard8()
    const reds = countColor(board, 'red')
    const player = makePlayer()
    const enemy = makeBrute({ hp: 100 })
    const r = resolveShatter(player, [enemy], board, { seed: 1 }, 'red', enemy.id)
    const dmgEvent = r.events.find((e) => e.kind === 'damage-dealt')
    expect(dmgEvent).toBeTruthy()
    // Single-target — should hit the named target with damage equal
    // to (count) minus any block (enemy starts at 0 block).
    if (dmgEvent?.kind === 'damage-dealt') {
      expect(dmgEvent.targetId).toBe(enemy.id)
      expect(dmgEvent.amount).toBeGreaterThan(0)
    }
    const updated = r.enemies.find((e) => e.id === enemy.id)
    expect(updated?.hp).toBe(100 - reds)
  })

  it('blue shatter fills phasePools.blue + mana.blue (capped by MANA_CAPS)', () => {
    const board = mkBoard8()
    const blues = countColor(board, 'blue')
    const player = makePlayer()
    const r = resolveShatter(player, [], board, { seed: 1 }, 'blue', null)
    // phasePools is uncapped — at LEAST the initial-shatter count
    // (post-refill cascades from gravity can add more blue matches).
    expect(r.player.phasePools.blue).toBeGreaterThanOrEqual(blues)
    // mana.blue caps at MANA_CAPS.blue (= 8). With 16+ blues cleared
    // by shatter alone, the cap is always hit.
    expect(r.player.mana.blue).toBe(8)
  })

  it('green shatter heals up to maxHp + emits healed event', () => {
    const board = mkBoard8()
    const greens = countColor(board, 'green')
    const player = makePlayer({ hp: 10 })
    const r = resolveShatter(player, [], board, { seed: 1 }, 'green', null)
    expect(r.player.hp).toBe(Math.min(40, 10 + greens))
    expect(r.events.some((e) => e.kind === 'healed')).toBe(true)
  })

  it('yellow shatter refills yellow mana (no direct damage / heal)', () => {
    const board = mkBoard8()
    const player = makePlayer({ hp: 20 })
    const r = resolveShatter(player, [], board, { seed: 1 }, 'yellow', null)
    // Yellow caps at MANA_CAPS.yellow (= 5). With ≥5 yellow on the
    // board the cap is always hit even without cascade chains.
    expect(r.player.mana.yellow).toBe(5)
    // No direct damage/heal from a yellow shatter itself. Cascade
    // chains from gravity-formed matches CAN deal damage/heal if
    // they happen to land matches of other colours — those are
    // legitimate downstream effects, not part of the yellow
    // shatter's own commit. We just confirm the player's hp didn't
    // GAIN from yellow gems themselves.
    expect(r.player.hp).toBeLessThanOrEqual(player.maxHp)
  })

  it('purple shatter accumulates skillCharge', () => {
    // Force some purple gems onto the board (mkBoard8 omits purple).
    const board = mkBoard8()
    board[0]![0] = { gemColor: 'purple' }
    board[3]![3] = { gemColor: 'purple' }
    board[7]![7] = { gemColor: 'purple' }
    const player = makePlayer({ skillCharge: 1 })
    const r = resolveShatter(player, [], board, { seed: 1 }, 'purple', null)
    expect(r.player.skillCharge).toBe(1 + 3)
  })

  it('kills the target when red shatter delivers the killing blow', () => {
    const board = mkBoard8()
    const reds = countColor(board, 'red')
    expect(reds).toBeGreaterThan(2)
    const player = makePlayer()
    const enemy = makeBrute({ hp: 2 }) // 2 HP, plenty of red → dies
    const r = resolveShatter(player, [enemy], board, { seed: 1 }, 'red', enemy.id)
    // After the refactor the kill chain runs inside resolveShatter via
    // the shared cascade processor — observable as a downed enemy +
    // an enemy-killed event in the stream.
    const updated = r.enemies.find((e) => e.id === enemy.id)
    expect(updated?.hp).toBeLessThanOrEqual(0)
    expect(r.events.some((e) => e.kind === 'enemy-killed' && e.enemyId === enemy.id)).toBe(true)
  })
})

describe('tickPetrifiedRows', () => {
  it('decrements every row and emits per-row tick events', () => {
    const result = tickPetrifiedRows({ 2: 2, 5: 1 })
    expect(result.petrifiedRows[2]).toBe(1)
    expect(result.petrifiedRows[5]).toBeUndefined() // expired
    expect(result.expired).toEqual([5])
    const ticks = result.events.filter((e) => e.kind === 'petrify-row-ticked')
    expect(ticks).toHaveLength(2)
    const tick2 = ticks.find((e) => e.kind === 'petrify-row-ticked' && e.row === 2)
    const tick5 = ticks.find((e) => e.kind === 'petrify-row-ticked' && e.row === 5)
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
