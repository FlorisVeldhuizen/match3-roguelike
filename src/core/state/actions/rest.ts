import { tryGetRelic } from '../../relics/registry'
import { REST_HEAL_PERCENT } from './nodes'
import type { StoreSet, StoreGet } from './types'

export function makeRestHeal(set: StoreSet, get: StoreGet) {
  return (): { ok: boolean } => {
    const current = get()
    if (current.runPhase !== 'rest') return { ok: false }
    set((s) => {
      const p = s.fight.player
      const amount = Math.round(p.maxHp * REST_HEAL_PERCENT)
      p.hp = Math.min(p.maxHp, p.hp + amount)
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
    set((s) => {
      s.runPhase = 'map'
    })
  }
}
