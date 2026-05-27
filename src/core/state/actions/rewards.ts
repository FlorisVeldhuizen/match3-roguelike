import { applyCombatEvents } from '../../combat/applyCombatEvents'
import {
  cloneRelicsForHooks,
  runOnRelicGained,
  snapshotOf,
  acquireRelic as engineAcquireRelic,
} from '../../relics/engine'
import { getSpell } from '../../combat/spellRegistry'
import type { GameEvent, SpellId } from '../../../types'
import type { StoreSet, StoreGet } from './types'

export function makeAcquireRelic(set: StoreSet, get: StoreGet) {
  return (id: string): { ok: boolean; events: GameEvent[] } => {
    const current = get()
    if (current.pendingReward == null) {
      return { ok: false, events: [] }
    }
    if (current.pendingReward.kind !== 'relic') {
      return { ok: false, events: [] }
    }
    if (!current.pendingReward.offeredRelicIds.includes(id)) {
      return { ok: false, events: [] }
    }
    const nextRelics = engineAcquireRelic(
      cloneRelicsForHooks(current.fight.player.relics),
      id,
    )
    const events: GameEvent[] = [{ kind: 'relic-gained', relicId: id }]
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
    const healed = applyCombatEvents(
      gainEvents,
      { ...current.fight.player, relics: nextRelics },
      current.fight.enemies,
      current.fight.targetEnemyId,
    )

    const goldDrop = current.pendingReward.gold
    set((s) => {
      s.pendingReward = null
      s.fight.player = healed.player
      s.fight.player.gold += goldDrop
      s.runPhase = 'map'
    })
    return { ok: true, events }
  }
}

export function makeAcquireSpellReward(set: StoreSet, get: StoreGet) {
  return (id: SpellId): { ok: boolean } => {
    const current = get()
    if (current.pendingReward == null) return { ok: false }
    if (current.pendingReward.kind !== 'spell') return { ok: false }
    if (!current.pendingReward.offeredSpellIds.includes(id)) {
      return { ok: false }
    }
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
    const goldDrop = current.pendingReward.gold
    set((s) => {
      s.pendingReward = null
      s.fight.player.gold += goldDrop
      s.runPhase = 'map'
    })
  }
}
