import { describe, expect, it } from 'vitest'
import {
  rollPostFightReward,
  rollSpellReward,
} from './reward'
// Side-effect imports — register the relic and spell pools.
import '../../content/relics'
import '../../content/spells'

describe('rollSpellReward', () => {
  it('returns up to 3 unowned non-starter spells', () => {
    // Knight starts with bulwark/reinforce/ignite; everything else is
    // unowned and rollable.
    const r = rollSpellReward(['bulwark', 'reinforce', 'ignite'], { seed: 1 })
    expect(r.reward.kind).toBe('spell')
    if (r.reward.kind !== 'spell') throw new Error('unreachable')
    expect(r.reward.offeredSpellIds.length).toBeGreaterThan(0)
    expect(r.reward.offeredSpellIds.length).toBeLessThanOrEqual(3)
    // None of the offered are owned.
    for (const id of r.reward.offeredSpellIds) {
      expect(['bulwark', 'reinforce', 'ignite']).not.toContain(id)
    }
  })

  it('returns an empty list when every non-starter spell is owned', () => {
    const allIds = [
      'bulwark',
      'reinforce',
      'ignite',
      'volley',
      'focus',
      'regenerate',
      'purify',
      'skewer',
      'brittle',
      'surge',
      'cinder-lash',
      'shatter',
      'transmute',
      'blessed-ground',
      'frozen-wall',
      'chain-lightning',
    ] as const
    const r = rollSpellReward(allIds, { seed: 2 })
    if (r.reward.kind !== 'spell') throw new Error('unreachable')
    expect(r.reward.offeredSpellIds).toEqual([])
  })

  it('is deterministic for the same seed', () => {
    const a = rollSpellReward([], { seed: 99 })
    const b = rollSpellReward([], { seed: 99 })
    if (a.reward.kind !== 'spell' || b.reward.kind !== 'spell') {
      throw new Error('unreachable')
    }
    expect(a.reward.offeredSpellIds).toEqual(b.reward.offeredSpellIds)
  })

  it('does not duplicate ids within the offer', () => {
    const r = rollSpellReward([], { seed: 7 })
    if (r.reward.kind !== 'spell') throw new Error('unreachable')
    const set = new Set(r.reward.offeredSpellIds)
    expect(set.size).toBe(r.reward.offeredSpellIds.length)
  })

  it('attaches the gold drop to the reward', () => {
    const r = rollSpellReward([], { seed: 1 }, 42)
    expect(r.reward.gold).toBe(42)
  })
})

describe('rollPostFightReward', () => {
  it('produces a spell-kind offer roughly 30% of the time', () => {
    let spellCount = 0
    const N = 2000
    let rng = { seed: 1 }
    for (let i = 0; i < N; i++) {
      const r = rollPostFightReward({
        ownedRelics: [],
        ownedSpellIds: ['bulwark', 'reinforce', 'ignite'],
        rarity: 'common',
        rng,
        gold: 0,
      })
      if (r.reward.kind === 'spell') spellCount += 1
      rng = r.rng
    }
    const ratio = spellCount / N
    // 30% ± 3% — wide enough not to flake on legitimate variance.
    expect(ratio).toBeGreaterThan(0.27)
    expect(ratio).toBeLessThan(0.33)
  })

  it('falls back to a relic offer if every non-starter spell is owned', () => {
    // Pre-roll a seed that lands on the spell branch, then verify it
    // promotes to relic because the spell pool is empty.
    const allSpells = [
      'bulwark',
      'reinforce',
      'ignite',
      'volley',
      'focus',
      'regenerate',
      'purify',
      'skewer',
      'brittle',
      'surge',
      'cinder-lash',
      'shatter',
    ] as const
    let rng = { seed: 3 }
    let sawRelicFallback = false
    for (let i = 0; i < 50; i++) {
      const r = rollPostFightReward({
        ownedRelics: [],
        ownedSpellIds: allSpells,
        rarity: 'common',
        rng,
        gold: 5,
      })
      if (r.reward.kind === 'relic') sawRelicFallback = true
      rng = r.rng
    }
    expect(sawRelicFallback).toBe(true)
  })
})
