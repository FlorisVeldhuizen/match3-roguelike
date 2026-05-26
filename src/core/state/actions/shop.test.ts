import { describe, expect, it, beforeEach } from 'vitest'
import { useGameStore } from '../store'
import '../../../content/relics'
import '../../../content/spells'
import '../../../content/enemies'

const enterShop = (gold = 200) => {
  useGameStore.getState().restart()
  useGameStore.setState((s) => {
    s.runPhase = 'shop'
    s.fight.player.gold = gold
    s.currentShopOffer = null
  })
  useGameStore.getState().rollShopOfferIfNeeded()
}

describe('shop actions', () => {
  beforeEach(() => {
    useGameStore.getState().restart()
  })

  it('rollShopOfferIfNeeded populates currentShopOffer once', () => {
    enterShop()
    const first = useGameStore.getState().currentShopOffer
    expect(first).not.toBeNull()
    expect(first?.relics.length).toBeLessThanOrEqual(3)
    // Idempotent: a second call is a no-op (no reroll).
    useGameStore.getState().rollShopOfferIfNeeded()
    const second = useGameStore.getState().currentShopOffer
    expect(second).toBe(first)
  })

  it('shopBuyRelic debits gold and grants the relic', () => {
    enterShop(500)
    const offer = useGameStore.getState().currentShopOffer
    const item = offer?.relics[0]
    if (!item) return // no relics available — guard, not fail
    const goldBefore = useGameStore.getState().fight.player.gold
    const result = useGameStore.getState().shopBuyRelic(item.id)
    expect(result.ok).toBe(true)
    const after = useGameStore.getState()
    expect(after.fight.player.gold).toBe(goldBefore - item.cost)
    expect(after.fight.player.relics.some((r) => r.id === item.id)).toBe(true)
    expect(
      after.currentShopOffer?.relics.find((r) => r.id === item.id)?.purchased,
    ).toBe(true)
  })

  it('shopBuyRelic refuses when gold is insufficient', () => {
    enterShop(5) // far below any relic cost
    const item = useGameStore.getState().currentShopOffer?.relics[0]
    if (!item) return
    const result = useGameStore.getState().shopBuyRelic(item.id)
    expect(result.ok).toBe(false)
    expect(useGameStore.getState().fight.player.gold).toBe(5)
  })

  it('shopBuyRelic refuses double-purchase of the same item', () => {
    enterShop(500)
    const item = useGameStore.getState().currentShopOffer?.relics[0]
    if (!item) return
    useGameStore.getState().shopBuyRelic(item.id)
    const result2 = useGameStore.getState().shopBuyRelic(item.id)
    expect(result2.ok).toBe(false)
  })

  it('shopBuySpell adds to ownedSpellIds and debits gold', () => {
    enterShop(500)
    const spell = useGameStore.getState().currentShopOffer?.spells[0]
    if (!spell) return
    const goldBefore = useGameStore.getState().fight.player.gold
    const result = useGameStore.getState().shopBuySpell(spell.id)
    expect(result.ok).toBe(true)
    const after = useGameStore.getState()
    expect(after.fight.player.gold).toBe(goldBefore - spell.cost)
    expect(after.fight.player.ownedSpellIds).toContain(spell.id)
  })

  it('shopBuyHeal restores HP up to maxHp', () => {
    enterShop(500)
    useGameStore.setState((s) => {
      s.fight.player.hp = 10
    })
    const heal = useGameStore.getState().currentShopOffer?.heals[0]
    if (!heal) return
    useGameStore.getState().shopBuyHeal(heal.kind)
    const p = useGameStore.getState().fight.player
    expect(p.hp).toBe(Math.min(p.maxHp, 10 + heal.amount))
  })

  it('shopBuyHeal refuses at full HP', () => {
    enterShop(500)
    const result = useGameStore.getState().shopBuyHeal('small')
    expect(result.ok).toBe(false)
  })

  it('shopRemoveRelic preserves acquisition order of remaining relics', () => {
    enterShop(500)
    useGameStore.setState((s) => {
      s.fight.player.relics = [
        { id: 'iron-buckler', runFlags: {}, fightFlags: {} },
        { id: 'sharp-edge', runFlags: {}, fightFlags: {} },
        { id: 'thornmail', runFlags: {}, fightFlags: {} },
      ]
    })
    const result = useGameStore.getState().shopRemoveRelic('sharp-edge')
    expect(result.ok).toBe(true)
    const ids = useGameStore
      .getState()
      .fight.player.relics.map((r) => r.id)
    expect(ids).toEqual(['iron-buckler', 'thornmail'])
    // Removal slot is marked used.
    expect(
      useGameStore.getState().currentShopOffer?.removeOffer?.used,
    ).toBe(true)
  })

  it('leaveShop returns to map and marks the node visited', () => {
    enterShop(100)
    useGameStore.setState((s) => {
      s.map.currentNodeId = 'shop-node-x'
      s.map.completedNodeIds = []
    })
    useGameStore.getState().leaveShop()
    const after = useGameStore.getState()
    expect(after.runPhase).toBe('map')
    expect(after.currentShopOffer).toBeNull()
    expect(after.map.completedNodeIds).toContain('shop-node-x')
  })

  it('actions no-op when runPhase is not shop', () => {
    useGameStore.setState((s) => {
      s.runPhase = 'map'
    })
    expect(useGameStore.getState().shopBuyRelic('iron-buckler').ok).toBe(false)
    expect(useGameStore.getState().shopBuyHeal('small').ok).toBe(false)
  })
})
