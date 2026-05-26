import { describe, expect, it } from 'vitest'
import type { Player } from '../../types'
import { processCascadeEvents } from './cascadeProcessor'

// Side-effect import so Cascade Crystal is in the relic registry when the
// upgrade-amplification test needs it.
import '../../content/relics'

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
  ...overrides,
})

const goldMatch = (size: number, cascadeLevel = 0, blessed = false) => [
  { kind: 'cascade-start' as const, level: cascadeLevel },
  {
    kind: 'match-found' as const,
    cells: Array.from({ length: size }, (_, i) => ({ x: i, y: 0 })),
    color: 'gold' as const,
    size,
    shape: 'line' as const,
    blessed,
  },
]

describe('cascadeProcessor — gold-color match payout', () => {
  it('credits player.gold at 2g per cleared cell on a 3-match', () => {
    const player = makePlayer()
    const r = processCascadeEvents(goldMatch(3), player, [], null, [])
    expect(r.player.gold).toBe(6)
  })

  it('5-line gold pays 10g', () => {
    const player = makePlayer()
    const r = processCascadeEvents(goldMatch(5), player, [], null, [])
    expect(r.player.gold).toBe(10)
  })

  it('does not credit any mana or skill charge', () => {
    const player = makePlayer()
    const r = processCascadeEvents(goldMatch(4), player, [], null, [])
    expect(r.player.mana).toEqual({ red: 0, blue: 0, green: 0, yellow: 0 })
    expect(r.player.skillCharge).toBe(0)
    expect(r.player.phasePools).toEqual({ red: 0, blue: 0, green: 0 })
  })

  it('emits pool-gained with color=gold for the HUD/SFX layer', () => {
    const player = makePlayer()
    const r = processCascadeEvents(goldMatch(3), player, [], null, [])
    const gained = r.events.find(
      (e) => e.kind === 'pool-gained' && e.color === 'gold',
    )
    expect(gained).toBeDefined()
    expect(gained && gained.kind === 'pool-gained' ? gained.amount : 0).toBe(6)
  })

  it('does not emit damage-dealt or healed (no in-match side effects)', () => {
    const player = makePlayer()
    const r = processCascadeEvents(goldMatch(4), player, [], null, [])
    const kinds = r.events.map((e) => e.kind)
    expect(kinds).not.toContain('damage-dealt')
    expect(kinds).not.toContain('healed')
  })

  it('blessed gold doubles payout (cascade ×2 bless modifier)', () => {
    const player = makePlayer()
    const r = processCascadeEvents(goldMatch(3, 0, true), player, [], null, [])
    // 3 cells × 2 (per-cell) × 2 (blessed) = 12
    expect(r.player.gold).toBe(12)
  })

  it('Cascade Crystal at level ≥1 amplifies gold the same as mana', () => {
    // Cascade-multiplier table isn't registered in this test (no
    // content/cascade.ts import — defaults to [1]). So level-1 gold-3 raw
    // = 3 × 2 × 1 = 6. Cascade Crystal then multiplies ×1.5 → floor(9).
    // The test isolates the relic hook's gold path; the default-table
    // gap is intentional to keep the math falsifiable.
    const player = makePlayer({
      relics: [{ id: 'cascade-crystal', runFlags: {}, fightFlags: {} }],
    })
    const r = processCascadeEvents(goldMatch(3, 1), player, [], null, [])
    expect(r.player.gold).toBe(9)
  })
})
