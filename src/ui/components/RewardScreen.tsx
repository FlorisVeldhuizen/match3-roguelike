import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { tryGetRelic } from '../../core/relics/registry'

// Post-fight 3-pick modal. Gated on the `gameplay-settled` event
// (emitted by BoardScene after the AC drains + cushion) so it adapts
// to cascade length — long chains play out fully, short kills reveal
// promptly. On click, dispatches acquireRelic and the store transitions
// to a fresh fight.
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
  // Boss-fight victory routes to VictoryOverlay instead; this modal is
  // only valid for the post-fight 'reward' runPhase.
  if (runPhase !== 'reward') return null
  if (pendingReward == null) return null

  const ids = pendingReward.offeredRelicIds
  const handlePick = (id: string) => {
    useGameStore.getState().acquireRelic(id)
  }
  const handleSkip = () => useGameStore.getState().skipReward()

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
                  onClick={() => handlePick(id)}
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
          Skip
        </button>
      </div>
    </div>
  )
}
