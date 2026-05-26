import { describe, it, expect } from 'vitest'
import type { Match, Player, RelicInstance } from '../../types'
import { runOnMatch, runOnDamageTaken, snapshotOf } from './engine'
import { listRelics } from './registry'
// Side-effect import: registers all five relics before the describe block
// computes the pair list. Async beforeAll runs too late for it.each.
import '../../content/relics'

// Relic-pair property test (per 04-roadmap Phase G acceptance + J2 scaling).
// For every unordered pair, run a deterministic scenario in each
// acquisition order. If neither relic in the pair declares `orderHint`,
// outputs must be identical (commutative). If either declares one,
// divergence is allowed (and surfaced in the test report) — the orderHint
// is the documented promise that order matters.

const makePlayer = (relics: RelicInstance[]): Player => ({
  hp: 40,
  maxHp: 40,
  block: 0,
  mana: { red: 0, blue: 0, green: 0, yellow: 0 },
  skillCharge: 0,
  phasePools: { red: 0, blue: 0, green: 0 },
  statuses: [],
  pendingSpells: [],
  carryBlockNextPhase: false,
  relics,
  gold: 0,
  ownedSpellIds: [],
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

// A scripted match sequence spans all colors + varied cascade levels so
// every relic's onMatch finds something to do.
const SCENARIO: { match: Match; cascadeLevel: number }[] = [
  { match: match('red', 3), cascadeLevel: 0 },
  { match: match('blue', 4), cascadeLevel: 0 },
  { match: match('green', 3), cascadeLevel: 1 },
  { match: match('yellow', 3), cascadeLevel: 1 },
  { match: match('purple', 5), cascadeLevel: 2 },
  { match: match('red', 5), cascadeLevel: 1 },
  { match: match('blue', 3), cascadeLevel: 2 },
]

// Run all onMatch events plus a single onDamageTaken in fixed order. Returns
// final aggregated deltas + emitted event count as the comparison vector.
function simulate(relics: RelicInstance[]) {
  const player = makePlayer(relics)
  const snap = snapshotOf(player, [], null, 0)
  const totals = { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 }
  for (const step of SCENARIO) {
    const initial = {
      red: 0,
      blue: 0,
      green: 0,
      yellow: 0,
      purple: 0,
      gold: 0,
      [step.match.color]: step.match.size, // simplified: raw amount = size
    }
    const result = runOnMatch(
      { match: step.match, deltas: initial, cascadeLevel: step.cascadeLevel },
      relics,
      snap,
    )
    totals.red += result.payload.deltas.red
    totals.blue += result.payload.deltas.blue
    totals.green += result.payload.deltas.green
    totals.yellow += result.payload.deltas.yellow
    totals.purple += result.payload.deltas.purple
  }
  const dtEvents = runOnDamageTaken(
    { amount: 4, blocked: 0, source: 'enemy-attack', attackerId: 'enemy-1' },
    relics,
    snap,
  )
  return { totals, damageTakenEventCount: dtEvents.length }
}

describe('relic pair acquisition-order property', () => {
  const defs = listRelics()
  const pairs: [string, string][] = []
  for (let i = 0; i < defs.length; i++) {
    for (let j = i + 1; j < defs.length; j++) {
      pairs.push([defs[i]!.id, defs[j]!.id])
    }
  }

  it.each(pairs)(
    'pair %s × %s: commutative iff neither declares orderHint',
    (a, b) => {
      const ra = listRelics().find((r) => r.id === a)!
      const rb = listRelics().find((r) => r.id === b)!
      const orderSensitive =
        ra.orderHint !== undefined || rb.orderHint !== undefined

      const ab = simulate([inst(a), inst(b)])
      const ba = simulate([inst(b), inst(a)])

      if (!orderSensitive) {
        expect(ab.totals).toEqual(ba.totals)
        expect(ab.damageTakenEventCount).toBe(ba.damageTakenEventCount)
      } else {
        // Divergence is allowed when one relic declares orderHint, but
        // both orders must still produce valid (non-negative integer) deltas.
        for (const color of ['red', 'blue', 'green', 'yellow', 'purple'] as const) {
          expect(Number.isInteger(ab.totals[color])).toBe(true)
          expect(Number.isInteger(ba.totals[color])).toBe(true)
          expect(ab.totals[color]).toBeGreaterThanOrEqual(0)
          expect(ba.totals[color]).toBeGreaterThanOrEqual(0)
        }
      }
    },
  )

  it('Sharp Edge × Cascade Crystal is one of the non-commutative pairs', () => {
    // Direct check that the orderHint we promise actually shows up under
    // the harness. Catches the case where someone removes the hint
    // without also making the relic actually commutative.
    const ab = simulate([inst('sharp-edge'), inst('cascade-crystal')])
    const ba = simulate([inst('cascade-crystal'), inst('sharp-edge')])
    expect(ab.totals).not.toEqual(ba.totals)
  })
})
