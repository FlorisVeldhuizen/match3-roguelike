import { describe, expect, it } from 'vitest'
import { listSpellsForTray } from './spellRegistry'
// Side-effect: registers the Phase H4a spell roster.
import '../../content/spells'

describe('listSpellsForTray', () => {
  it('returns only the owned spells when unlockAll=false', () => {
    const owned = ['bulwark', 'ignite']
    const tray = listSpellsForTray(owned, false)
    expect(tray.map((s) => s.id).sort()).toEqual(['bulwark', 'ignite'])
  })

  it('returns the empty list for an empty owned set', () => {
    expect(listSpellsForTray([], false)).toEqual([])
  })

  it('unlockAll=true ignores the owned set and returns every registered spell', () => {
    const tray = listSpellsForTray(['bulwark'], true)
    // Dev override must surface every spell, not just bulwark.
    expect(tray.length).toBeGreaterThan(1)
    expect(tray.find((s) => s.id === 'shatter')).toBeDefined()
  })

  it('preserves registry order regardless of owned-set order', () => {
    // Reverse the owned-set order; tray order should still match
    // registry insertion order.
    const ownedReversed = ['ignite', 'reinforce', 'bulwark']
    const ownedNatural = ['bulwark', 'reinforce', 'ignite']
    const a = listSpellsForTray(ownedReversed, false).map((s) => s.id)
    const b = listSpellsForTray(ownedNatural, false).map((s) => s.id)
    expect(a).toEqual(b)
  })

  it('silently drops ids that are not registered', () => {
    // Forward-compat: a save file from a future version that has
    // additional spell ids shouldn't crash the tray.
    const tray = listSpellsForTray(['bulwark', 'no-such-spell'], false)
    expect(tray.map((s) => s.id)).toEqual(['bulwark'])
  })
})
