import { useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { tryGetRelic } from '../../core/relics/registry'
import { REST_HEAL_PERCENT } from '../../core/state/actions/nodes'

export function RestScreen() {
  const runPhase = useGameStore((s) => s.runPhase)
  const playerHp = useGameStore((s) => s.fight.player.hp)
  const playerMaxHp = useGameStore((s) => s.fight.player.maxHp)
  const relics = useGameStore((s) => s.fight.player.relics)
  const restHeal = useGameStore((s) => s.restHeal)
  const restUpgrade = useGameStore((s) => s.restUpgrade)
  const leaveRest = useGameStore((s) => s.leaveRest)
  const [showUpgrade, setShowUpgrade] = useState(false)

  if (runPhase !== 'rest') return null

  const healAmount = Math.round(playerMaxHp * REST_HEAL_PERCENT)
  const healPreview = Math.min(playerMaxHp, playerHp + healAmount) - playerHp

  const upgradableRelics = relics
    .map((inst) => ({ inst, def: tryGetRelic(inst.id) }))
    .filter(
      (x) =>
        x.def !== undefined &&
        x.def.upgradable === true &&
        x.inst.upgraded !== true,
    )

  return (
    <div className="reward-overlay" role="dialog" aria-label="Rest site">
      <div className="reward-card">
        <h1 className="reward-title">A quiet hollow.</h1>
        <p className="reward-sub">
          Catch your breath, or hone a relic. You can only pick one.
        </p>

        {!showUpgrade && (
          <div className="reward-grid">
            <button
              type="button"
              className="reward-relic rarity-common"
              onClick={() => restHeal()}
              disabled={healPreview === 0}
              title={
                healPreview === 0
                  ? "You're already at full health."
                  : `Restore ${healAmount} HP.`
              }
            >
              <span className="reward-relic-icon" aria-hidden>🔥</span>
              <span className="reward-relic-name">Rest</span>
              <span className="reward-relic-rarity">heal</span>
              <span className="reward-relic-desc">
                Restore {healAmount} HP ({Math.round(REST_HEAL_PERCENT * 100)}% of max).
                {healPreview === 0 ? ' Already full.' : ''}
              </span>
            </button>

            <button
              type="button"
              className="reward-relic rarity-uncommon"
              onClick={() => setShowUpgrade(true)}
              disabled={upgradableRelics.length === 0}
              title={
                upgradableRelics.length === 0
                  ? 'No upgradable relics in your inventory.'
                  : 'Pick a relic to permanently strengthen.'
              }
            >
              <span className="reward-relic-icon" aria-hidden>⚒</span>
              <span className="reward-relic-name">Hone</span>
              <span className="reward-relic-rarity">upgrade</span>
              <span className="reward-relic-desc">
                Permanently upgrade one of your relics.
                {upgradableRelics.length === 0
                  ? ' Nothing eligible yet.'
                  : ` ${upgradableRelics.length} eligible.`}
              </span>
            </button>
          </div>
        )}

        {showUpgrade && (
          <div className="reward-grid">
            {upgradableRelics.map(({ inst, def }) => {
              if (!def) return null
              return (
                <button
                  key={inst.id}
                  type="button"
                  className={`reward-relic rarity-${def.rarity}`}
                  onClick={() => restUpgrade(inst.id)}
                >
                  <span className="reward-relic-icon" aria-hidden>{def.icon}</span>
                  <span className="reward-relic-name">{def.name}</span>
                  <span className="reward-relic-rarity">+upgrade</span>
                  <span className="reward-relic-desc">
                    {def.upgradedDescription ?? def.description}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <button
          type="button"
          className="reward-skip"
          onClick={() => (showUpgrade ? setShowUpgrade(false) : leaveRest())}
        >
          {showUpgrade ? 'Back' : 'Leave'}
        </button>
      </div>
    </div>
  )
}
