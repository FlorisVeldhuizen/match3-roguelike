import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { tryGetRelic } from '../../core/relics/registry'
import { getSpell } from '../../core/combat/spellRegistry'
import type { SpellId } from '../../types'

export function RewardScreen() {
  const pendingReward = useGameStore((s) => s.pendingReward)
  const runPhase = useGameStore((s) => s.runPhase)
  const [reveal, setReveal] = useState(false)

  useEffect(() => {
    const unsub = subscribeGameEvents((event) => {
      if (event.kind !== 'gameplay-settled') return
      if (useGameStore.getState().fight.phase === 'victory') {
        setReveal(true)
      }
    })
    return unsub
  }, [])

  if (!reveal) return null
  if (runPhase !== 'reward') return null
  if (pendingReward == null) return null

  const handleSkip = () => useGameStore.getState().skipReward()

  const goldLabel = pendingReward.gold > 0 ? ` (+${pendingReward.gold} gold)` : ''

  if (pendingReward.kind === 'spell') {
    return (
      <div className="reward-overlay" role="dialog" aria-label="Choose a spell">
        <div className="reward-card">
          <h1 className="reward-title">Victory!</h1>
          <p className="reward-sub">A new spell flickers into reach.</p>
          <div className="reward-grid">
            {pendingReward.offeredSpellIds.length === 0 ? (
              <p className="reward-empty">No new spells available — skip for now.</p>
            ) : (
              pendingReward.offeredSpellIds.map((id) => <SpellRewardRow key={id} id={id} />)
            )}
          </div>
          <button type="button" className="reward-skip" onClick={handleSkip}>
            Skip{goldLabel}
          </button>
        </div>
      </div>
    )
  }

  const ids = pendingReward.offeredRelicIds
  const handleRelicPick = (id: string) => {
    useGameStore.getState().acquireRelic(id)
  }
  return (
    <div className="reward-overlay" role="dialog" aria-label="Choose a relic">
      <div className="reward-card">
        <h1 className="reward-title">Victory!</h1>
        <p className="reward-sub">Choose your reward.</p>
        <div className="reward-grid">
          {ids.length === 0 ? (
            <p className="reward-empty">No relics available — skip for now.</p>
          ) : (
            ids.map((id) => {
              const def = tryGetRelic(id)
              if (!def) return null
              return (
                <button
                  key={id}
                  type="button"
                  className={`reward-relic rarity-${def.rarity}`}
                  onClick={() => handleRelicPick(id)}
                >
                  <span className="reward-relic-icon" aria-hidden>
                    {def.icon}
                  </span>
                  <span className="reward-relic-name">{def.name}</span>
                  <span className="reward-relic-rarity">{def.rarity}</span>
                  <span className="reward-relic-desc">{def.description}</span>
                  {def.orderHint ? (
                    <span className="reward-relic-hint">{def.orderHint}</span>
                  ) : null}
                </button>
              )
            })
          )}
        </div>
        <button type="button" className="reward-skip" onClick={handleSkip}>
          Skip{goldLabel}
        </button>
      </div>
    </div>
  )
}

function SpellRewardRow({ id }: { id: SpellId }) {
  let def
  try {
    def = getSpell(id)
  } catch {
    return null
  }
  const handlePick = () => {
    useGameStore.getState().acquireSpellReward(id)
  }
  return (
    <button key={id} type="button" className="reward-relic rarity-uncommon" onClick={handlePick}>
      <span className="reward-relic-icon" aria-hidden>
        {def.icon}
      </span>
      <span className="reward-relic-name">{def.name}</span>
      <span className="reward-relic-rarity">spell</span>
      <span className="reward-relic-desc">{def.description}</span>
    </button>
  )
}
