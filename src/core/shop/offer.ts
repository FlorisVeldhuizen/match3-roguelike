import type { RelicInstance, RelicRarity, ShopOffer, SpellId } from '../../types'
import { listSpells } from '../combat/spellRegistry'
import { listRelics } from '../relics/registry'
import { nextInt, type RngState } from '../rng/mulberry32'

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
/** ~50% of shop buy price — merchant buys back, not full retail. */
const RELIC_PAWN_PAYOUT: Record<RelicRarity, number> = {
  common: 30,
  uncommon: 50,
  rare: 75,
}
const RELIC_PAWN_UPGRADED_BONUS = 15

export function relicPawnGold(rarity: RelicRarity, upgraded = false): number {
  const base = RELIC_PAWN_PAYOUT[rarity]
  return upgraded ? base + RELIC_PAWN_UPGRADED_BONUS : base
}

export function rollShopOffer(args: {
  ownedRelics: readonly RelicInstance[]
  ownedSpellIds: readonly SpellId[]
  rng: RngState
}): { offer: ShopOffer; rng: RngState } {
  let rng = args.rng
  const ownedRelicIds = new Set(args.ownedRelics.map((r) => r.id))
  const ownedSpellSet = new Set(args.ownedSpellIds)

  // 70/25/5 common/uncommon/rare rarity split.
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
    let picked: { id: string; rarity: 'common' | 'uncommon' | 'rare' } | null = null
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
      pawnOffer: { used: false },
    },
    rng,
  }
}

export const SHOP_PRICES = {
  relic: RELIC_COSTS,
  spell: SPELL_COST,
  healSmall: { cost: HEAL_SMALL_COST, amount: HEAL_SMALL_AMOUNT },
  healBig: { cost: HEAL_BIG_COST, amount: HEAL_BIG_AMOUNT },
  relicPawn: RELIC_PAWN_PAYOUT,
  relicPawnUpgradedBonus: RELIC_PAWN_UPGRADED_BONUS,
} as const
