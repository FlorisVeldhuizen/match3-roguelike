import { runOnRelicGained, snapshotOf, acquireRelic as engineAcquireRelic } from '../../relics/engine'
import { getSpell } from '../../combat/spellRegistry'
import type { GameEvent, SpellId } from '../../../types'
import type { StoreSet, StoreGet } from './types'

export function makeAcquireRelic(set: StoreSet, get: StoreGet) {
  return (id: string): { ok: boolean; events: GameEvent[] } => {
    const current = get()
    if (current.pendingReward == null) {
      return { ok: false, events: [] }
    }
    // Phase I: only valid against a relic-kind offer. A spell-kind offer
    // surfaced via the reward screen must be picked through acquireSpellReward.
    if (current.pendingReward.kind !== 'relic') {
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
    // Phase I: gold credit fires on BOTH relic-pick and skip (it's the
    // drop, not the pick reward — see makeSkipReward below).
    const goldDrop = current.pendingReward.gold
    set((s) => {
      s.pendingReward = null
      s.fight.player.relics = nextRelics
      s.fight.player.gold += goldDrop
      s.runPhase = 'map'
    })
    return { ok: true, events }
  }
}

// Phase I: pick a spell from a spell-kind reward offer. Mirrors
// makeAcquireRelic — validates against the offered set, credits gold on
// pick, and routes back to the map. Returns ok=false on invalid pick so
// the UI can keep its presentation honest.
export function makeAcquireSpellReward(set: StoreSet, get: StoreGet) {
  return (id: SpellId): { ok: boolean } => {
    const current = get()
    if (current.pendingReward == null) return { ok: false }
    if (current.pendingReward.kind !== 'spell') return { ok: false }
    if (!current.pendingReward.offeredSpellIds.includes(id)) {
      return { ok: false }
    }
    // Defensive: registry lookup catches malformed save data.
    try {
      getSpell(id)
    } catch {
      return { ok: false }
    }
    const goldDrop = current.pendingReward.gold
    set((s) => {
      s.pendingReward = null
      if (!s.fight.player.ownedSpellIds.includes(id)) {
        s.fight.player.ownedSpellIds.push(id)
      }
      s.fight.player.gold += goldDrop
      s.runPhase = 'map'
    })
    return { ok: true }
  }
}

export function makeSkipReward(set: StoreSet, get: StoreGet) {
  return (): void => {
    const current = get()
    if (current.pendingReward == null) return
    // Phase I: gold is the per-fight drop — player gets it whether they
    // take the relic or skip. Only the relic offer is forfeited on skip.
    const goldDrop = current.pendingReward.gold
    set((s) => {
      s.pendingReward = null
      s.fight.player.gold += goldDrop
      s.runPhase = 'map'
    })
  }
}
