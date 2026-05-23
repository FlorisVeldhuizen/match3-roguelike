import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { tryGetRelic } from '../../core/relics/registry'

// Post-fight 3-pick modal. Gated on the animation-timed phase-changed
// → 'victory' event so it waits for the kill cascade + damage drains
// to play out (same pattern as VictoryOverlay). On click, dispatches
// acquireRelic and the store transitions to a fresh fight.
export function RewardScreen() {
  const pendingReward = useGameStore((s) => s.pendingReward)
  const phase = useGameStore((s) => s.fight.phase)
  const [reveal, setReveal] = useState(phase === 'victory')

  useEffect(
    () =>
      subscribeGameEvents((event) => {
        if (event.kind === 'phase-changed') {
          setReveal(event.phase === 'victory')
        }
      }),
    [],
  )

  if (!reveal) return null
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
