import { tryGetRelic } from '../../relics/registry'
import { REST_HEAL_PERCENT } from './nodes'
import type { StoreSet, StoreGet } from './types'

// Phase I rest-node actions. Rest is a one-pick interaction: either heal
// or upgrade one owned relic, then auto-return to the map. The screen
// gates which buttons are available; these actions add a defensive
// runPhase check so a stale button can't fire from somewhere else.

export function makeRestHeal(set: StoreSet, get: StoreGet) {
  return (): { ok: boolean } => {
    const current = get()
    if (current.runPhase !== 'rest') return { ok: false }
    set((s) => {
      const p = s.fight.player
      const amount = Math.round(p.maxHp * REST_HEAL_PERCENT)
      p.hp = Math.min(p.maxHp, p.hp + amount)
      // Mark the node visited only when the player commits to an action.
      const cur = s.map.currentNodeId
      if (cur != null && !s.map.completedNodeIds.includes(cur)) {
        s.map.completedNodeIds.push(cur)
      }
      s.runPhase = 'map'
    })
    return { ok: true }
  }
}

export function makeRestUpgrade(set: StoreSet, get: StoreGet) {
  return (relicId: string): { ok: boolean } => {
    const current = get()
    if (current.runPhase !== 'rest') return { ok: false }
    const inst = current.fight.player.relics.find((r) => r.id === relicId)
    if (!inst) return { ok: false }
    const def = tryGetRelic(relicId)
    if (!def || def.upgradable !== true) return { ok: false }
    // Idempotent: already-upgraded relic still consumes the rest pick.
    // The UI gates against listing already-upgraded relics, so this
    // only matters if a double-click slips through.
    if (inst.upgraded === true) return { ok: false }
    set((s) => {
      const target = s.fight.player.relics.find((r) => r.id === relicId)
      if (target) target.upgraded = true
      const cur = s.map.currentNodeId
      if (cur != null && !s.map.completedNodeIds.includes(cur)) {
        s.map.completedNodeIds.push(cur)
      }
      s.runPhase = 'map'
    })
    return { ok: true }
  }
}

export function makeLeaveRest(set: StoreSet, get: StoreGet) {
  return (): void => {
    if (get().runPhase !== 'rest') return
    // Leaving without picking does NOT mark the node visited — the
    // player can come back if they walk a path that loops past it. Map
    // gen today doesn't produce loops, but the rule is forward-compat.
    set((s) => {
      s.runPhase = 'map'
    })
  }
}
