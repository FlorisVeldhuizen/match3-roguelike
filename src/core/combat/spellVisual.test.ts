import { describe, expect, it } from 'vitest'
import '../../content/spells'
import {
  immediateSpellBeat,
  pendingSpellBeat,
  withImmediateSpellVisuals,
  withPendingSpellVisuals,
} from './spellVisual'
import { SPEND_TRAIL_ARRIVAL_MS, SPELL_EFFECT_TRAIL_ARRIVAL_MS } from '../../timing'

describe('spellVisual', () => {
  it('immediate beat starts after mana spend lands on spell', () => {
    const beat = immediateSpellBeat('ignite')
    expect(beat.trailStartMs).toBe(SPEND_TRAIL_ARRIVAL_MS)
    expect(beat.arriveMs).toBe(
      SPEND_TRAIL_ARRIVAL_MS + SPELL_EFFECT_TRAIL_ARRIVAL_MS,
    )
  })

  it('pending beat resolves on effect moment', () => {
    const beat = pendingSpellBeat('volley')
    expect(beat.trailStartMs).toBe(0)
    expect(beat.arriveMs).toBe(SPELL_EFFECT_TRAIL_ARRIVAL_MS)
  })

  it('prepends spell-effect-trail and tags combat events', () => {
    const out = withImmediateSpellVisuals('ignite', [
      {
        kind: 'spell-cast',
        spellId: 'ignite',
        spentColors: ['red'],
      },
      {
        kind: 'status-applied',
        target: 'e1',
        status: { kind: 'burn', stacks: 3 },
        source: { kind: 'player' },
      },
    ])
    expect(out[0]?.kind).toBe('spell-effect-trail')
    const status = out.find((e) => e.kind === 'status-applied')
    expect(status && 'spellVisual' in status && status.spellVisual?.spellId).toBe(
      'ignite',
    )
  })

  it('tags volley damage for pending resolve', () => {
    const out = withPendingSpellVisuals('volley', [
      {
        kind: 'damage-dealt',
        targetId: 'e1',
        amount: 2,
        blocked: 0,
        source: 'player-attack',
      },
    ])
    expect(out[0]?.kind).toBe('spell-effect-trail')
    const dmg = out.find((e) => e.kind === 'damage-dealt')
    expect(dmg && 'spellVisual' in dmg && dmg.spellVisual?.spellId).toBe('volley')
  })
})
