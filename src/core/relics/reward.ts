import type { PendingReward, RelicInstance, RelicRarity, SpellId } from '../../types'
import { nextInt, type RngState } from '../rng/mulberry32'
import { listSpells } from '../combat/spellRegistry'
import { listRelics } from './registry'

export function rollReward(
  ownedRelics: readonly RelicInstance[],
  rarity: RelicRarity,
  rng: RngState,
  gold = 0,
): { reward: PendingReward; rng: RngState } {
  const ownedIds = new Set(ownedRelics.map((r) => r.id))
  const ladder: RelicRarity[] =
    rarity === 'common'
      ? ['common', 'uncommon', 'rare']
      : rarity === 'uncommon'
        ? ['uncommon', 'rare']
        : ['rare']

  const offered: string[] = []
  let nextRng = rng
  for (const tier of ladder) {
    if (offered.length >= 3) break
    const tierPool = listRelics({ rarity: tier })
      .map((r) => r.id)
      .filter((id) => !ownedIds.has(id) && !offered.includes(id))
    while (tierPool.length > 0 && offered.length < 3) {
      const [idx, advanced] = nextInt(nextRng, tierPool.length)
      nextRng = advanced
      offered.push(tierPool.splice(idx, 1)[0]!)
    }
  }

  return {
    reward: { kind: 'relic', rarity, offeredRelicIds: offered, gold },
    rng: nextRng,
  }
}

export function rollSpellReward(
  ownedSpellIds: readonly SpellId[],
  rng: RngState,
  gold = 0,
): { reward: PendingReward; rng: RngState } {
  const owned = new Set(ownedSpellIds)
  const pool = listSpells()
    .filter((s) => s.starter !== true && !owned.has(s.id))
    .map((s) => s.id)
  const offered: SpellId[] = []
  let nextRng = rng
  while (pool.length > 0 && offered.length < 3) {
    const [idx, advanced] = nextInt(nextRng, pool.length)
    nextRng = advanced
    offered.push(pool.splice(idx, 1)[0]!)
  }
  return {
    reward: { kind: 'spell', offeredSpellIds: offered, gold },
    rng: nextRng,
  }
}

// 30% spell offers, 70% relic offers
const SPELL_OFFER_NUMERATOR = 3
const SPELL_OFFER_DENOMINATOR = 10

export function rollPostFightReward(args: {
  ownedRelics: readonly RelicInstance[]
  ownedSpellIds: readonly SpellId[]
  rarity: RelicRarity
  rng: RngState
  gold: number
}): { reward: PendingReward; rng: RngState } {
  const [pick, advanced] = nextInt(args.rng, SPELL_OFFER_DENOMINATOR)
  if (pick < SPELL_OFFER_NUMERATOR) {
    const spell = rollSpellReward(args.ownedSpellIds, advanced, args.gold)
    if (
      spell.reward.kind === 'spell' &&
      spell.reward.offeredSpellIds.length > 0
    ) {
      return spell
    }
    return rollReward(args.ownedRelics, args.rarity, spell.rng, args.gold)
  }
  return rollReward(args.ownedRelics, args.rarity, advanced, args.gold)
}
