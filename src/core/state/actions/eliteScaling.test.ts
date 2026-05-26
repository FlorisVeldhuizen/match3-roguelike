import { describe, expect, it } from 'vitest'
import { freshFight } from './helpers'
import { registerArchetype } from '../../combat/archetypeRegistry'
import '../../../content/enemies'
import '../../../content/intentDisplays'

// Phase I: elite scaling — same archetype, +40% HP and +1 to attack /
// block telegraphs. Test by rolling the same archetype under both
// scenarios and comparing.

describe('freshFight elite scaling', () => {
  it('scales HP by ~1.4× when isElite=true', () => {
    const baseline = freshFight({ seed: 42 }, [], { archetypes: ['brute'] })
    const elite = freshFight({ seed: 42 }, [], {
      archetypes: ['brute'],
      isElite: true,
    })
    const baseHp = baseline.fight.enemies[0]?.maxHp ?? 0
    const eliteHp = elite.fight.enemies[0]?.maxHp ?? 0
    expect(eliteHp).toBe(Math.round(baseHp * 1.4))
  })

  it('adds +1 to attack-intent amount when isElite=true', () => {
    // Seed picked so freshFight's first intent rolls 'attack' for brute.
    // If the seed shifts, find another that does — the assertion is only
    // checked when the intent is actually an attack.
    let foundAttackPair = false
    for (let seed = 1; seed < 50 && !foundAttackPair; seed++) {
      const baseline = freshFight({ seed }, [], { archetypes: ['brute'] })
      const elite = freshFight({ seed }, [], {
        archetypes: ['brute'],
        isElite: true,
      })
      const bi = baseline.fight.enemies[0]?.currentIntent
      const ei = elite.fight.enemies[0]?.currentIntent
      if (bi && ei && bi.kind === 'attack' && ei.kind === 'attack') {
        expect(ei.amount).toBe(bi.amount + 1)
        foundAttackPair = true
      }
    }
    expect(foundAttackPair).toBe(true)
  })

  it('sets isElite on the FightState', () => {
    const elite = freshFight({ seed: 1 }, [], {
      archetypes: ['brute'],
      isElite: true,
    })
    expect(elite.fight.isElite).toBe(true)
    const baseline = freshFight({ seed: 1 }, [], { archetypes: ['brute'] })
    expect(baseline.fight.isElite).toBeUndefined()
  })

  it('does not affect a normal (non-elite, non-boss) fight', () => {
    const baseline = freshFight({ seed: 1 }, [], { archetypes: ['brute'] })
    const e = baseline.fight.enemies[0]
    expect(e).toBeDefined()
    // HP equals the archetype default (no scaler)
    expect(e?.hp).toBe(e?.maxHp)
    expect(baseline.fight.isElite).toBeUndefined()
    expect(baseline.fight.isBoss).toBeUndefined()
  })
})

// Side-effect import: registers archetypes so freshFight works in
// isolation. Imports below run before the describe block above.
void registerArchetype
