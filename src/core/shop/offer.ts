import type { RelicInstance, ShopOffer, SpellId } from '../../types'
import { listSpells } from '../combat/spellRegistry'
import { listRelics } from '../relics/registry'
import { nextInt, type RngState } from '../rng/mulberry32'

// Phase I shop pricing. Hand-tuned to bracket the gold-drop curve:
//   - 4-fight run with avg 14g/fight ≈ 56g pre-shop (col-3 fight at col-4
//     shop) → buys exactly one common relic or both small heals or one
//     spell. The player decides what to spend the first wallet on.
//   - Elite run ≈ 95g+ pre-shop → one uncommon relic, OR a small heal +
//     common relic, OR a spell + small heal. Real tension between
//     options instead of "pick the cheapest".
const RELIC_COSTS: Record<'common' | 'uncommon' | 'rare', number> = {
  common: 60,
  uncommon: 100,
  rare: 150,
}
const SPELL_COST = 80
const HEAL_SMALL_COST = 25
const HEAL_SMALL_AMOUNT = 15
const HEAL_BIG_COST = 50
const HEAL_BIG_AMOUNT = 35
const RELIC_REMOVE_COST = 75

// Roll one shop's contents. Deterministic from rng.loot — caller threads
// the returned rng back into the store. 3 relics (weighted to common,
// promote up if pool exhausted), 2 unowned non-starter spells, 2 heals
// (both always present), 1 relic-remove (always present, gated by
// "player owns at least one relic" at point-of-purchase).
export function rollShopOffer(args: {
  ownedRelics: readonly RelicInstance[]
  ownedSpellIds: readonly SpellId[]
  rng: RngState
}): { offer: ShopOffer; rng: RngState } {
  let rng = args.rng
  const ownedRelicIds = new Set(args.ownedRelics.map((r) => r.id))
  const ownedSpellSet = new Set(args.ownedSpellIds)

  // Relics: 70/25/5 common/uncommon/rare split. Each pick re-rolls
  // against the chosen rarity's pool with promote-up if exhausted —
  // same ladder rollReward already uses.
  const relicPicks: ShopOffer['relics'] = []
  const rarityWeights: ('common' | 'uncommon' | 'rare')[] = [
    'common',
    'common',
    'common',
    'common',
    'common',
    'common',
    'common',
    'uncommon',
    'uncommon',
    'rare',
  ]
  const alreadyOffered = new Set<string>()
  for (let i = 0; i < 3; i++) {
    const [w, advanced] = nextInt(rng, rarityWeights.length)
    rng = advanced
    const desiredRarity = rarityWeights[w] ?? 'common'
    const ladder: ('common' | 'uncommon' | 'rare')[] =
      desiredRarity === 'common'
        ? ['common', 'uncommon', 'rare']
        : desiredRarity === 'uncommon'
          ? ['uncommon', 'rare']
          : ['rare']
    let picked: { id: string; rarity: 'common' | 'uncommon' | 'rare' } | null =
      null
    for (const tier of ladder) {
      const pool = listRelics({ rarity: tier })
        .map((r) => r.id)
        .filter((id) => !ownedRelicIds.has(id) && !alreadyOffered.has(id))
      if (pool.length === 0) continue
      const [idx, nr] = nextInt(rng, pool.length)
      rng = nr
      picked = { id: pool[idx]!, rarity: tier }
      break
    }
    if (picked) {
      alreadyOffered.add(picked.id)
      relicPicks.push({
        id: picked.id,
        cost: RELIC_COSTS[picked.rarity],
        purchased: false,
      })
    }
  }

  // Spells: 2 unowned non-starter spells, flat price.
  const spellPicks: ShopOffer['spells'] = []
  const spellPool = listSpells()
    .filter((s) => s.starter !== true && !ownedSpellSet.has(s.id))
    .map((s) => s.id)
  while (spellPicks.length < 2 && spellPool.length > 0) {
    const [idx, nr] = nextInt(rng, spellPool.length)
    rng = nr
    spellPicks.push({
      id: spellPool.splice(idx, 1)[0]!,
      cost: SPELL_COST,
      purchased: false,
    })
  }

  return {
    offer: {
      relics: relicPicks,
      spells: spellPicks,
      heals: [
        { kind: 'small', cost: HEAL_SMALL_COST, amount: HEAL_SMALL_AMOUNT, purchased: false },
        { kind: 'big', cost: HEAL_BIG_COST, amount: HEAL_BIG_AMOUNT, purchased: false },
      ],
      removeOffer: { cost: RELIC_REMOVE_COST, used: false },
    },
    rng,
  }
}

// Exported for tests / UI so prices stay declared once.
export const SHOP_PRICES = {
  relic: RELIC_COSTS,
  spell: SPELL_COST,
  healSmall: { cost: HEAL_SMALL_COST, amount: HEAL_SMALL_AMOUNT },
  healBig: { cost: HEAL_BIG_COST, amount: HEAL_BIG_AMOUNT },
  relicRemove: RELIC_REMOVE_COST,
} as const
