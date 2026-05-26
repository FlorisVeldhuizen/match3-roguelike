import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { tryGetRelic } from '../../core/relics/registry'
import { getSpell } from '../../core/combat/spellRegistry'
import type { SpellId } from '../../types'

export function ShopScreen() {
  const runPhase = useGameStore((s) => s.runPhase)
  const offer = useGameStore((s) => s.currentShopOffer)
  const gold = useGameStore((s) => s.fight.player.gold)
  const playerHp = useGameStore((s) => s.fight.player.hp)
  const playerMaxHp = useGameStore((s) => s.fight.player.maxHp)
  const relics = useGameStore((s) => s.fight.player.relics)
  const rollShopOfferIfNeeded = useGameStore(
    (s) => s.rollShopOfferIfNeeded,
  )
  const shopBuyRelic = useGameStore((s) => s.shopBuyRelic)
  const shopBuySpell = useGameStore((s) => s.shopBuySpell)
  const shopBuyHeal = useGameStore((s) => s.shopBuyHeal)
  const shopRemoveRelic = useGameStore((s) => s.shopRemoveRelic)
  const leaveShop = useGameStore((s) => s.leaveShop)
  const [removeMode, setRemoveMode] = useState(false)

  useEffect(() => {
    if (runPhase === 'shop') rollShopOfferIfNeeded()
  }, [runPhase, rollShopOfferIfNeeded])

  if (runPhase !== 'shop') return null
  if (!offer) return null

  const isFullHp = playerHp >= playerMaxHp

  return (
    <div className="reward-overlay" role="dialog" aria-label="Shop">
      <div className="reward-card shop-card">
        <h1 className="reward-title">A roadside merchant.</h1>
        <p className="reward-sub">
          Gold: <strong>{gold}</strong>
        </p>

        {!removeMode && (
          <>
            <h2 className="shop-section-title">Relics</h2>
            <div className="reward-grid">
              {offer.relics.length === 0 && (
                <p className="reward-empty">No relics in stock.</p>
              )}
              {offer.relics.map((item) => {
                const def = tryGetRelic(item.id)
                if (!def) return null
                const tooPoor = gold < item.cost
                const disabled = item.purchased || tooPoor
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`reward-relic rarity-${def.rarity}${item.purchased ? ' sold-out' : ''}`}
                    disabled={disabled}
                    onClick={() => shopBuyRelic(item.id)}
                    title={
                      item.purchased
                        ? 'Sold'
                        : tooPoor
                          ? `Need ${item.cost - gold} more gold`
                          : ''
                    }
                  >
                    <span className="reward-relic-icon" aria-hidden>{def.icon}</span>
                    <span className="reward-relic-name">{def.name}</span>
                    <span className="reward-relic-rarity">{def.rarity}</span>
                    <span className="reward-relic-desc">{def.description}</span>
                    <span className="shop-price">
                      {item.purchased ? 'Sold' : `${item.cost} g`}
                    </span>
                  </button>
                )
              })}
            </div>

            <h2 className="shop-section-title">Spells</h2>
            <div className="reward-grid">
              {offer.spells.length === 0 && (
                <p className="reward-empty">No new spells today.</p>
              )}
              {offer.spells.map((item) => (
                <ShopSpellRow
                  key={item.id}
                  id={item.id}
                  cost={item.cost}
                  purchased={item.purchased}
                  gold={gold}
                  onBuy={() => shopBuySpell(item.id)}
                />
              ))}
            </div>

            <h2 className="shop-section-title">Services</h2>
            <div className="reward-grid">
              {offer.heals.map((item) => {
                const tooPoor = gold < item.cost
                const disabled = item.purchased || tooPoor || isFullHp
                return (
                  <button
                    key={item.kind}
                    type="button"
                    className={`reward-relic rarity-common${item.purchased ? ' sold-out' : ''}`}
                    disabled={disabled}
                    onClick={() => shopBuyHeal(item.kind)}
                    title={
                      item.purchased
                        ? 'Sold'
                        : isFullHp
                          ? "You're already at full health"
                          : tooPoor
                            ? `Need ${item.cost - gold} more gold`
                            : ''
                    }
                  >
                    <span className="reward-relic-icon" aria-hidden>🩹</span>
                    <span className="reward-relic-name">
                      {item.kind === 'small' ? 'Bandage' : 'Tonic'}
                    </span>
                    <span className="reward-relic-rarity">heal</span>
                    <span className="reward-relic-desc">
                      Restore {item.amount} HP.
                    </span>
                    <span className="shop-price">
                      {item.purchased ? 'Sold' : `${item.cost} g`}
                    </span>
                  </button>
                )
              })}
              {offer.removeOffer && (
                <button
                  type="button"
                  className={`reward-relic rarity-uncommon${offer.removeOffer.used ? ' sold-out' : ''}`}
                  disabled={
                    offer.removeOffer.used ||
                    gold < offer.removeOffer.cost ||
                    relics.length === 0
                  }
                  onClick={() => setRemoveMode(true)}
                  title={
                    offer.removeOffer.used
                      ? 'Already used'
                      : relics.length === 0
                        ? 'No relics to remove'
                        : gold < offer.removeOffer.cost
                          ? `Need ${offer.removeOffer.cost - gold} more gold`
                          : ''
                  }
                >
                  <span className="reward-relic-icon" aria-hidden>🪓</span>
                  <span className="reward-relic-name">Pawn relic</span>
                  <span className="reward-relic-rarity">service</span>
                  <span className="reward-relic-desc">
                    Permanently discard one of your relics.
                  </span>
                  <span className="shop-price">
                    {offer.removeOffer.used
                      ? 'Used'
                      : `${offer.removeOffer.cost} g`}
                  </span>
                </button>
              )}
            </div>
          </>
        )}

        {removeMode && (
          <>
            <h2 className="shop-section-title">Pick a relic to pawn</h2>
            <div className="reward-grid">
              {relics.length === 0 && (
                <p className="reward-empty">No relics to remove.</p>
              )}
              {relics.map((inst) => {
                const def = tryGetRelic(inst.id)
                if (!def) return null
                return (
                  <button
                    key={inst.id}
                    type="button"
                    className={`reward-relic rarity-${def.rarity}`}
                    onClick={() => {
                      const result = shopRemoveRelic(inst.id)
                      if (result.ok) setRemoveMode(false)
                    }}
                  >
                    <span className="reward-relic-icon" aria-hidden>{def.icon}</span>
                    <span className="reward-relic-name">{def.name}</span>
                    <span className="reward-relic-rarity">{def.rarity}</span>
                    <span className="reward-relic-desc">{def.description}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        <button
          type="button"
          className="reward-skip"
          onClick={() => (removeMode ? setRemoveMode(false) : leaveShop())}
        >
          {removeMode ? 'Back' : 'Leave'}
        </button>
      </div>
    </div>
  )
}

function ShopSpellRow({
  id,
  cost,
  purchased,
  gold,
  onBuy,
}: {
  id: SpellId
  cost: number
  purchased: boolean
  gold: number
  onBuy: () => void
}) {
  let def
  try {
    def = getSpell(id)
  } catch {
    return null
  }
  const tooPoor = gold < cost
  const disabled = purchased || tooPoor
  return (
    <button
      type="button"
      className={`reward-relic rarity-uncommon${purchased ? ' sold-out' : ''}`}
      disabled={disabled}
      onClick={onBuy}
      title={
        purchased ? 'Sold' : tooPoor ? `Need ${cost - gold} more gold` : ''
      }
    >
      <span className="reward-relic-icon" aria-hidden>{def.icon}</span>
      <span className="reward-relic-name">{def.name}</span>
      <span className="reward-relic-rarity">spell</span>
      <span className="reward-relic-desc">{def.description}</span>
      <span className="shop-price">{purchased ? 'Sold' : `${cost} g`}</span>
    </button>
  )
}
