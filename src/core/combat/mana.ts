import type { ManaCost, ManaPools } from '../../types'

// H3: multi-colour mana economy helpers. Spell costs are per-colour
// (`{ red?, blue?, green?, yellow? }`). Yellow mana is the WILD colour —
// it can pay for any colour's shortfall at 1:1. So a cost of `{ blue: 3 }`
// is affordable iff `mana.blue + mana.yellow >= 3` (using yellow as
// substitute when blue is short). When consuming, we pay exact-colour
// first, then yellow for any remainder.
//
// Edge case: a cost with multiple non-yellow colours (e.g. `{ red: 2,
// blue: 1 }`) cannot double-count yellow between requirements. We track
// the total wild-shortfall across all colours and only succeed if the
// player's yellow mana covers that total. This is enforced by
// `canAffordSpell`'s aggregate-shortfall calculation.
//
// When the cost specifies yellow explicitly (e.g. `{ yellow: 2 }`), that
// is required yellow — no wild substitution for it.

const COLOURED: ReadonlyArray<keyof Omit<ManaCost, 'yellow'>> = [
  'red',
  'blue',
  'green',
] as const

// Returns true iff the player can afford the cost using current mana
// pools plus wild-substitution from yellow.
export function canAffordSpell(mana: ManaPools, cost: ManaCost): boolean {
  let wildShortfall = 0
  for (const colour of COLOURED) {
    const need = cost[colour] ?? 0
    if (need <= 0) continue
    const have = mana[colour]
    if (have < need) wildShortfall += need - have
  }
  const yellowNeed = cost.yellow ?? 0
  // Yellow used for: explicit yellow cost + the wild shortfall on other
  // colours. The player's yellow mana has to cover both.
  return mana.yellow >= yellowNeed + wildShortfall
}

// Returns the new mana pools after paying `cost`. Caller MUST verify
// affordability with `canAffordSpell` first — this function does not
// re-check and will return negative values if invariants are broken.
// Consumption order: exact colour first, then yellow (wild) for shortfall.
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

// Total mana cost (across all colours) — for UI display ("costs 3 mana"
// at a glance, where the player can hover to see the colour breakdown).
export function totalCost(cost: ManaCost): number {
  return (
    (cost.red ?? 0) + (cost.blue ?? 0) + (cost.green ?? 0) + (cost.yellow ?? 0)
  )
}
