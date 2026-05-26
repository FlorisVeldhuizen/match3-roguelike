import { runOnRelicGained, snapshotOf, acquireRelic as engineAcquireRelic } from '../../relics/engine'
import type { GameEvent } from '../../../types'
import type { StoreSet, StoreGet } from './types'

export function makeAcquireRelic(set: StoreSet, get: StoreGet) {
  return (id: string): { ok: boolean; events: GameEvent[] } => {
    const current = get()
    if (current.pendingReward == null) {
      return { ok: false, events: [] }
    }
    if (!current.pendingReward.offeredRelicIds.includes(id)) {
      return { ok: false, events: [] }
    }
    const nextRelics = engineAcquireRelic(current.fight.player.relics, id)
    const events: GameEvent[] = [{ kind: 'relic-gained', relicId: id }]
    // onRelicGained listeners (any other relic in your inventory that
    // cares about new acquisitions). Phase G has no consumer; J2 will.
    const gainEvents = runOnRelicGained(
      { relicId: id },
      nextRelics,
      snapshotOf(
        { ...current.fight.player, relics: nextRelics },
        current.fight.enemies,
        current.fight.targetEnemyId,
        0,
      ),
    )
    events.push(...gainEvents)

    // H1: relic pick returns to the map. The next fight (if any) is
    // rolled by enterNode at node selection. Persist the new relic
    // inventory on the lingering fight.player so the relic tray still
    // shows the acquired relic while the player is on the map.
    set((s) => {
      s.pendingReward = null
      s.fight.player.relics = nextRelics
      s.runPhase = 'map'
    })
    return { ok: true, events }
  }
}

export function makeSkipReward(set: StoreSet, get: StoreGet) {
  return (): void => {
    const current = get()
    if (current.pendingReward == null) return
    // H1: skipping the reward returns to the map. Gold-on-skip is a
    // Phase I concern.
    set((s) => {
      s.pendingReward = null
      s.runPhase = 'map'
    })
  }
}
