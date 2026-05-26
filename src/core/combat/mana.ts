import type { ManaCost, ManaPools } from '../../types'

const COLOURED: ReadonlyArray<keyof Omit<ManaCost, 'yellow'>> = [
  'red',
  'blue',
  'green',
] as const

// Yellow is wild — it can pay for any colour's shortfall at 1:1.
export function canAffordSpell(mana: ManaPools, cost: ManaCost): boolean {
  let wildShortfall = 0
  for (const colour of COLOURED) {
    const need = cost[colour] ?? 0
    if (need <= 0) continue
    const have = mana[colour]
    if (have < need) wildShortfall += need - have
  }
  const yellowNeed = cost.yellow ?? 0
  return mana.yellow >= yellowNeed + wildShortfall
}

// Exact colour first, then yellow (wild) for shortfall.
export function consumeSpellCost(mana: ManaPools, cost: ManaCost): ManaPools {
  const result: ManaPools = { ...mana }
  let yellowToSpend = cost.yellow ?? 0
  for (const colour of COLOURED) {
    const need = cost[colour] ?? 0
    if (need <= 0) continue
    const fromColour = Math.min(result[colour], need)
    result[colour] -= fromColour
    const shortfall = need - fromColour
    if (shortfall > 0) yellowToSpend += shortfall
  }
  result.yellow -= yellowToSpend
  return result
}

export function totalCost(cost: ManaCost): number {
  return (
    (cost.red ?? 0) + (cost.blue ?? 0) + (cost.green ?? 0) + (cost.yellow ?? 0)
  )
}
