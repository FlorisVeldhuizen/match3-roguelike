import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { tryGetRelic } from '../../core/relics/registry'
import { relicPawnGold } from '../../core/shop/offer'
import { getSpell } from '../../core/combat/spellRegistry'
import type { SpellId } from '../../types'

export function ShopScreen() {
  const runPhase = useGameStore((s) => s.runPhase)
  const offer = useGameStore((s) => s.currentShopOffer)
  const gold = useGameStore((s) => s.fight.player.gold)
  const playerHp = useGameStore((s) => s.fight.player.hp)
  const playerMaxHp = useGameStore((s) => s.fight.player.maxHp)
  const relics = useGameStore((s) => s.fight.player.relics)
  const rollShopOfferIfNeeded = useGameStore((s) => s.rollShopOfferIfNeeded)
  const shopBuyRelic = useGameStore((s) => s.shopBuyRelic)
  const shopBuySpell = useGameStore((s) => s.shopBuySpell)
  const shopBuyHeal = useGameStore((s) => s.shopBuyHeal)
  const shopPawnRelic = useGameStore((s) => s.shopPawnRelic)
  const leaveShop = useGameStore((s) => s.leaveShop)
  const [pawnMode, setPawnMode] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (runPhase === 'shop') rollShopOfferIfNeeded()
  }, [runPhase, rollShopOfferIfNeeded])

  useEffect(() => {
    if (!pawnMode) return
    const el = overlayRef.current
    if (el) el.scrollTop = 0
  }, [pawnMode])

  if (runPhase !== 'shop') return null
  if (!offer) return null

  const isFullHp = playerHp >= playerMaxHp

  const pawnBlocked =
    offer.pawnOffer?.used === true
      ? 'Already pawned a relic this visit.'
      : relics.length === 0
        ? 'You need at least one relic to sell.'
        : null

  const pawnPayoutRange = (() => {
    if (relics.length === 0) return null
    let min = Infinity
    let max = 0
    for (const inst of relics) {
      const def = tryGetRelic(inst.id)
      if (!def) continue
      const payout = relicPawnGold(def.rarity, inst.upgraded === true)
      min = Math.min(min, payout)
      max = Math.max(max, payout)
    }
    if (!Number.isFinite(min)) return null
    return min === max ? `${min} g` : `${min}–${max} g`
  })()

  return (
    <div ref={overlayRef} className="reward-overlay" role="dialog" aria-label="Shop">
      <div className="reward-card shop-card">
        <h1 className="reward-title">A roadside merchant.</h1>
        <p className="reward-sub">
          Gold: <strong>{gold}</strong>
        </p>

        {!pawnMode && (
          <>
            <h2 className="shop-section-title">Relics</h2>
            <div className="reward-grid">
              {offer.relics.length === 0 && <p className="reward-empty">No relics in stock.</p>}
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
                      item.purchased ? 'Sold' : tooPoor ? `Need ${item.cost - gold} more gold` : ''
                    }
                  >
                    <span className="reward-relic-icon" aria-hidden>
                      {def.icon}
                    </span>
                    <span className="reward-relic-name">{def.name}</span>
                    <span className="reward-relic-rarity">{def.rarity}</span>
                    <span className="reward-relic-desc">{def.description}</span>
                    <ShopPrice cost={item.cost} purchased={item.purchased} />
                  </button>
                )
              })}
            </div>

            <h2 className="shop-section-title">Spells</h2>
            <div className="reward-grid">
              {offer.spells.length === 0 && <p className="reward-empty">No new spells today.</p>}
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
                    <span className="reward-relic-icon" aria-hidden>
                      🩹
                    </span>
                    <span className="reward-relic-name">
                      {item.kind === 'small' ? 'Bandage' : 'Tonic'}
                    </span>
                    <span className="reward-relic-rarity">heal</span>
                    <span className="reward-relic-desc">Restore {item.amount} HP.</span>
                    <ShopPrice cost={item.cost} purchased={item.purchased} />
                  </button>
                )
              })}
              {offer.pawnOffer && (
                <button
                  type="button"
                  className={`reward-relic rarity-uncommon${offer.pawnOffer.used ? ' sold-out' : ''}`}
                  disabled={offer.pawnOffer.used || relics.length === 0}
                  onClick={() => setPawnMode(true)}
                  title={
                    offer.pawnOffer.used
                      ? 'Already used'
                      : relics.length === 0
                        ? 'No relics to sell'
                        : pawnPayoutRange
                          ? `Earn ${pawnPayoutRange} depending on relic`
                          : ''
                  }
                >
                  <span className="reward-relic-icon" aria-hidden>
                    ⚖️
                  </span>
                  <span className="reward-relic-name">Pawn relic</span>
                  <span className="reward-relic-rarity">sell</span>
                  <span className="reward-relic-desc">
                    Trade one relic for gold (payout by rarity
                    {pawnPayoutRange ? `: ${pawnPayoutRange}` : ''}). Tap here, then choose which
                    relic to sell.
                  </span>
                  {pawnBlocked && <span className="reward-relic-hint">{pawnBlocked}</span>}
                  {pawnPayoutRange && !offer.pawnOffer.used && (
                    <ShopPayout amountLabel={pawnPayoutRange} purchased={false} />
                  )}
                  {offer.pawnOffer.used && <span className="shop-price">Used</span>}
                </button>
              )}
            </div>
          </>
        )}

        {pawnMode && (
          <>
            <h2 className="shop-section-title">Pick a relic to pawn</h2>
            <p className="reward-sub">
              You earn gold and lose that relic for the rest of the run. Payout depends on rarity
              (upgraded relics pay a little more).
            </p>
            <div className="reward-grid">
              {relics.length === 0 && <p className="reward-empty">No relics to sell.</p>}
              {relics.map((inst) => {
                const def = tryGetRelic(inst.id)
                if (!def) return null
                const payout = relicPawnGold(def.rarity, inst.upgraded === true)
                return (
                  <button
                    key={inst.id}
                    type="button"
                    className={`reward-relic rarity-${def.rarity}`}
                    onClick={() => {
                      const result = shopPawnRelic(inst.id)
                      if (result.ok) setPawnMode(false)
                    }}
                  >
                    <span className="reward-relic-icon" aria-hidden>
                      {def.icon}
                    </span>
                    <span className="reward-relic-name">{def.name}</span>
                    <span className="reward-relic-rarity">{def.rarity}</span>
                    <span className="reward-relic-desc">{def.description}</span>
                    <ShopPayout amount={payout} />
                  </button>
                )
              })}
            </div>
          </>
        )}

        <button
          type="button"
          className="reward-skip"
          onClick={() => (pawnMode ? setPawnMode(false) : leaveShop())}
        >
          {pawnMode ? 'Back' : 'Leave'}
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
      title={purchased ? 'Sold' : tooPoor ? `Need ${cost - gold} more gold` : ''}
    >
      <span className="reward-relic-icon" aria-hidden>
        {def.icon}
      </span>
      <span className="reward-relic-name">{def.name}</span>
      <span className="reward-relic-rarity">spell</span>
      <span className="reward-relic-desc">{def.description}</span>
      <ShopPrice cost={cost} purchased={purchased} />
    </button>
  )
}

function ShopPrice({
  cost,
  purchased = false,
  soldLabel = 'Sold',
}: {
  cost: number
  purchased?: boolean
  soldLabel?: string
}) {
  if (purchased) {
    return <span className="shop-price">{soldLabel}</span>
  }
  return (
    <span className="shop-price" aria-label={`Pay ${cost} gold`}>
      Pay {cost} g
    </span>
  )
}

function ShopPayout({
  amount,
  amountLabel,
  purchased = false,
}: {
  amount?: number
  amountLabel?: string
  purchased?: boolean
}) {
  if (purchased) {
    return <span className="shop-price">Used</span>
  }
  const label = amountLabel ?? (amount != null ? `+${amount} g` : '')
  return (
    <span className="shop-price shop-price-earn" aria-label={`Earn ${label}`}>
      {label}
    </span>
  )
}
