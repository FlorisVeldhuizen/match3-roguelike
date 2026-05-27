import type { ManaCost } from '../types'
import type { ManaSpendColor } from '../core/combat/mana'
export { manaColorsSpentOnCast } from '../core/combat/mana'
export type { ManaSpendColor }

export type ManaThemeColor = Exclude<ManaSpendColor, 'purple'>

export function manaCostEntries(
  cost: ManaCost,
): { color: ManaThemeColor; amount: number }[] {
  const entries: { color: ManaThemeColor; amount: number }[] = []
  if (cost.red) entries.push({ color: 'red', amount: cost.red })
  if (cost.blue) entries.push({ color: 'blue', amount: cost.blue })
  if (cost.green) entries.push({ color: 'green', amount: cost.green })
  if (cost.yellow) entries.push({ color: 'yellow', amount: cost.yellow })
  return entries
}

/** CSS class for spell card border / glow (single colour, mixed, or free). */
export function spellManaClassName(cost: ManaCost): string {
  const entries = manaCostEntries(cost)
  if (entries.length === 0) return 'spell-mana-free'
  if (entries.length === 1) return `spell-mana-${entries[0].color}`
  return 'spell-mana-mixed'
}

/** RGB triplets for CSS custom properties (spell cast flash, mixed tint). */
export const MANA_THEME_RGB: Record<ManaThemeColor, string> = {
  red: '215, 84, 82',
  blue: '74, 143, 207',
  green: '108, 181, 108',
  yellow: '232, 198, 81',
}

export function primaryManaRgb(cost: ManaCost): string {
  const entries = manaCostEntries(cost)
  if (entries.length === 0) return '201, 168, 108'
  return MANA_THEME_RGB[entries[0].color]
}
