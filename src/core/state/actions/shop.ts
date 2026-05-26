import { acquireRelic as engineAcquireRelic } from '../../relics/engine'
import { tryGetRelic } from '../../relics/registry'
import { getSpell } from '../../combat/spellRegistry'
import { rollShopOffer } from '../../shop/offer'
import type { SpellId } from '../../../types'
import type { StoreSet, StoreGet } from './types'

export function makeRollShopOffer(set: StoreSet, get: StoreGet) {
  return (): void => {
    const current = get()
    if (current.runPhase !== 'shop') return
    if (current.currentShopOffer != null) return
    const { offer, rng } = rollShopOffer({
      ownedRelics: current.fight.player.relics,
      ownedSpellIds: current.fight.player.ownedSpellIds,
      rng: current.rng.loot,
    })
    set((s) => {
      s.currentShopOffer = offer
      s.rng.loot = rng
    })
  }
}

export function makeShopBuyRelic(set: StoreSet, get: StoreGet) {
  return (relicId: string): { ok: boolean } => {
    const current = get()
    if (current.runPhase !== 'shop') return { ok: false }
    const offer = current.currentShopOffer
    if (!offer) return { ok: false }
    const item = offer.relics.find((r) => r.id === relicId)
    if (!item || item.purchased) return { ok: false }
    if (current.fight.player.gold < item.cost) return { ok: false }
    if (!tryGetRelic(relicId)) return { ok: false }
    const nextRelics = engineAcquireRelic(current.fight.player.relics, relicId)
    set((s) => {
      s.fight.player.gold -= item.cost
      s.fight.player.relics = nextRelics
      const target = s.currentShopOffer?.relics.find((r) => r.id === relicId)
      if (target) target.purchased = true
    })
    return { ok: true }
  }
}

export function makeShopBuySpell(set: StoreSet, get: StoreGet) {
  return (spellId: SpellId): { ok: boolean } => {
    const current = get()
    if (current.runPhase !== 'shop') return { ok: false }
    const offer = current.currentShopOffer
    if (!offer) return { ok: false }
    const item = offer.spells.find((s) => s.id === spellId)
    if (!item || item.purchased) return { ok: false }
    if (current.fight.player.gold < item.cost) return { ok: false }
    try {
      getSpell(spellId)
    } catch {
      return { ok: false }
    }
    set((s) => {
      s.fight.player.gold -= item.cost
      if (!s.fight.player.ownedSpellIds.includes(spellId)) {
        s.fight.player.ownedSpellIds.push(spellId)
      }
      const target = s.currentShopOffer?.spells.find((sp) => sp.id === spellId)
      if (target) target.purchased = true
    })
    return { ok: true }
  }
}

export function makeShopBuyHeal(set: StoreSet, get: StoreGet) {
  return (kind: 'small' | 'big'): { ok: boolean } => {
    const current = get()
    if (current.runPhase !== 'shop') return { ok: false }
    const offer = current.currentShopOffer
    if (!offer) return { ok: false }
    const item = offer.heals.find((h) => h.kind === kind)
    if (!item || item.purchased) return { ok: false }
    if (current.fight.player.gold < item.cost) return { ok: false }
    const p = current.fight.player
    if (p.hp >= p.maxHp) return { ok: false }
    set((s) => {
      s.fight.player.gold -= item.cost
      s.fight.player.hp = Math.min(
        s.fight.player.maxHp,
        s.fight.player.hp + item.amount,
      )
      const target = s.currentShopOffer?.heals.find((h) => h.kind === kind)
      if (target) target.purchased = true
    })
    return { ok: true }
  }
}

export function makeShopRemoveRelic(set: StoreSet, get: StoreGet) {
  return (relicId: string): { ok: boolean } => {
    const current = get()
    if (current.runPhase !== 'shop') return { ok: false }
    const offer = current.currentShopOffer
    if (!offer || !offer.removeOffer || offer.removeOffer.used) {
      return { ok: false }
    }
    if (current.fight.player.gold < offer.removeOffer.cost) {
      return { ok: false }
    }
    if (!current.fight.player.relics.some((r) => r.id === relicId)) {
      return { ok: false }
    }
    const cost = offer.removeOffer.cost
    set((s) => {
      s.fight.player.gold -= cost
      s.fight.player.relics = s.fight.player.relics.filter(
        (r) => r.id !== relicId,
      )
      if (s.currentShopOffer?.removeOffer) {
        s.currentShopOffer.removeOffer.used = true
      }
    })
    return { ok: true }
  }
}

export function makeLeaveShop(set: StoreSet, get: StoreGet) {
  return (): void => {
    if (get().runPhase !== 'shop') return
    set((s) => {
      const cur = s.map.currentNodeId
      if (cur != null && !s.map.completedNodeIds.includes(cur)) {
        s.map.completedNodeIds.push(cur)
      }
      s.currentShopOffer = null
      s.runPhase = 'map'
    })
  }
}
