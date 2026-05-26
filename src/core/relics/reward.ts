import type { PendingReward, RelicInstance, RelicRarity, SpellId } from '../../types'
import { nextInt, type RngState } from '../rng/mulberry32'
import { listSpells } from '../combat/spellRegistry'
import { listRelics } from './registry'

// Roll a 3-pick reward set per architecture §4.relic-pick-offer-generation:
//   1. unowned at target rarity
//   2. if <3, promote: fill from next-rarer tier (rare > uncommon > common)
//   3. if all tiers exhausted, returns offered: [] (UI shows skip-for-gold)
//
// Deterministic from the passed rng.loot — caller must thread the returned
// rng back into GameState.
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

// Phase I: discoverable-spell reward pool. Returns up to 3 non-starter
// spells the player doesn't already own. Empty pool case returns `[]` so
// the UI can present "skip for gold" the same way the relic roller does.
export function rollSpellReward(
  ownedSpellIds: readonly SpellId[],
  rng: RngState,
  gold = 0,
): { reward: PendingReward; rng: RngState } {
  const owned = new Set(ownedSpellIds)
  // Discoverable = registered + not in the player's owned set. We also
  // exclude `starter: true` spells defensively — they should already be
  // in ownedSpellIds at run start, but a save-file from before the
  // owned-set system could leak the starter flag back in here.
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

// Phase I: top-level reward roll. Rolls offer-type (relic vs spell) from
// rng.loot before delegating to the per-kind roller. 30% spell-offers
// keeps relics as the primary acquisition surface — the spell pool is
// smaller and stops paying out the moment all spells are owned, while
// relics keep coming back at higher rarities via the ladder.
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
    // Try spell first. If the pool is empty (run-end state: all spells
    // owned), fall through to a relic offer so the reward beat doesn't
    // collapse to "skip only".
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
