import type { PendingReward, RelicInstance, RelicRarity } from '../../types'
import { nextInt, type RngState } from '../rng/mulberry32'
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
    reward: { rarity, offeredRelicIds: offered, gold },
    rng: nextRng,
  }
}
