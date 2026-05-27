import { describe, expect, it } from 'vitest'
import '../../content/spells'
import {
  canAffordSpell,
  consumeSpellCost,
  makeSpellCastEvent,
  manaColorsSpentOnCast,
  totalCost,
} from './mana'
import type { ManaPools } from '../../types'

const pools = (over: Partial<ManaPools> = {}): ManaPools => ({
  red: 0,
  blue: 0,
  green: 0,
  yellow: 0,
  ...over,
})

describe('canAffordSpell', () => {
  it('exact-colour cost: paid with same colour', () => {
    expect(canAffordSpell(pools({ blue: 3 }), { blue: 3 })).toBe(true)
    expect(canAffordSpell(pools({ blue: 2 }), { blue: 3 })).toBe(false)
  })

  it('wild substitution: yellow covers colour shortfall', () => {
    // 2 blue + 1 yellow covers a cost of 3 blue
    expect(canAffordSpell(pools({ blue: 2, yellow: 1 }), { blue: 3 })).toBe(true)
    // 0 blue + 3 yellow covers a cost of 3 blue
    expect(canAffordSpell(pools({ yellow: 3 }), { blue: 3 })).toBe(true)
    // 0 blue + 2 yellow short of 3 blue
    expect(canAffordSpell(pools({ yellow: 2 }), { blue: 3 })).toBe(false)
  })

  it('multi-colour cost: yellow does not double-count', () => {
    // Cost {red:2, blue:1}, mana {yellow:3} — total wild shortfall = 3,
    // yellow has 3, so affordable.
    expect(canAffordSpell(pools({ yellow: 3 }), { red: 2, blue: 1 })).toBe(true)
    // Same cost but only 2 yellow — total shortfall 3, yellow has 2,
    // NOT affordable.
    expect(canAffordSpell(pools({ yellow: 2 }), { red: 2, blue: 1 })).toBe(false)
    // Same cost, 1 red + 2 yellow — red short by 1, blue short by 1,
    // total wild shortfall 2, yellow has 2, affordable.
    expect(canAffordSpell(pools({ red: 1, yellow: 2 }), { red: 2, blue: 1 })).toBe(true)
  })

  it('explicit yellow cost: not satisfied by other colours', () => {
    // Cost { yellow: 2 } requires 2 yellow specifically — red can't pay
    expect(canAffordSpell(pools({ red: 5, yellow: 1 }), { yellow: 2 })).toBe(false)
    expect(canAffordSpell(pools({ yellow: 2 }), { yellow: 2 })).toBe(true)
  })

  it('zero-cost spell is always affordable', () => {
    expect(canAffordSpell(pools(), {})).toBe(true)
  })
})

describe('consumeSpellCost', () => {
  it('pays exact colour first', () => {
    const after = consumeSpellCost(pools({ blue: 5, yellow: 3 }), { blue: 3 })
    expect(after).toEqual(pools({ blue: 2, yellow: 3 }))
  })

  it('pays shortfall with wild yellow', () => {
    // Cost { blue: 3 }, mana { blue: 1, yellow: 4 } — pay 1 blue + 2 yellow
    const after = consumeSpellCost(pools({ blue: 1, yellow: 4 }), { blue: 3 })
    expect(after).toEqual(pools({ blue: 0, yellow: 2 }))
  })

  it('pays multi-colour cost with mixed exact + wild', () => {
    // Cost { red: 2, blue: 1 }, mana { red: 1, blue: 0, yellow: 3 }
    // red needs 1 more, blue needs 1 more → 2 wild from yellow.
    const after = consumeSpellCost(pools({ red: 1, blue: 0, yellow: 3 }), { red: 2, blue: 1 })
    expect(after).toEqual(pools({ red: 0, blue: 0, yellow: 1 }))
  })

  it('pays explicit yellow + colour cost together', () => {
    // Cost { yellow: 1, blue: 2 }, mana { blue: 5, yellow: 4 }
    // → 2 blue + 1 yellow consumed.
    const after = consumeSpellCost(pools({ blue: 5, yellow: 4 }), { yellow: 1, blue: 2 })
    expect(after).toEqual(pools({ blue: 3, yellow: 3 }))
  })

  it('zero-cost spell leaves mana untouched', () => {
    const start = pools({ red: 3, blue: 2 })
    const after = consumeSpellCost(start, {})
    expect(after).toEqual(start)
  })
})

describe('manaColorsSpentOnCast', () => {
  it('includes yellow when wild covers a shortfall', () => {
    expect(manaColorsSpentOnCast(pools({ red: 0, yellow: 2 }), { red: 2 })).toEqual([
      'red',
      'yellow',
    ])
  })
})

describe('makeSpellCastEvent', () => {
  it('tags spent colours for HUD trails', () => {
    expect(makeSpellCastEvent('ignite', pools({ red: 3 })).spentColors).toEqual(['red'])
    expect(makeSpellCastEvent('riposte', pools()).spentColors).toEqual(['purple'])
  })
})

describe('totalCost', () => {
  it('sums all colour entries', () => {
    expect(totalCost({ blue: 3 })).toBe(3)
    expect(totalCost({ red: 2, blue: 1 })).toBe(3)
    expect(totalCost({ red: 2, blue: 1, yellow: 1 })).toBe(4)
    expect(totalCost({})).toBe(0)
  })
})
