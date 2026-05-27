import { describe, expect, it } from 'vitest'
import { manaColorsSpentOnCast } from '../core/combat/mana'
import { spellManaClassName } from './spellManaTheme'

describe('spellManaTheme', () => {
  it('classifies single- and multi-colour costs', () => {
    expect(spellManaClassName({ red: 3 })).toBe('spell-mana-red')
    expect(spellManaClassName({ red: 2, green: 1 })).toBe('spell-mana-mixed')
    expect(spellManaClassName({})).toBe('spell-mana-free')
  })

  it('lists pools touched when paying (including wild shortfall)', () => {
    expect(manaColorsSpentOnCast({ red: 0, blue: 0, green: 0, yellow: 3 }, { red: 3 })).toEqual([
      'red',
      'yellow',
    ])
    expect(manaColorsSpentOnCast({ red: 4, blue: 0, green: 0, yellow: 0 }, { red: 3 })).toEqual([
      'red',
    ])
  })
})
