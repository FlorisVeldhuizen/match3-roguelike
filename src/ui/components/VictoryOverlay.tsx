import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'

// H1: this is the run-cleared screen, mounted by App only when
// runPhase==='victory' (boss kill). Conditional mount means a fresh
// instance each time, so the reveal gate doesn't accumulate true across
// fights — the boss-kill phase-changed event drains *after* this
// instance subscribes, so we wait for the kill cascade to finish.
export function VictoryOverlay() {
  // Initial false even though parent only mounts us when runPhase is
  // already 'victory': we want the cascade-drain phase-changed event to
  // be the one that flips us visible, not the synchronous runPhase flip.
  const [reveal, setReveal] = useState(false)

  useEffect(
    () =>
      subscribeGameEvents((event) => {
        if (event.kind === 'phase-changed' && event.phase === 'victory') {
          setReveal(true)
        }
      }),
    [],
  )

  if (!reveal) return null

  const handleRestart = () => useGameStore.getState().restart()

  return (
    <div className="victory-overlay" role="dialog" aria-label="Run cleared">
      <div className="victory-card">
        <h1 className="victory-title">Run cleared</h1>
        <p className="victory-sub">The boss has fallen.</p>
        <button
          type="button"
          className="victory-restart"
          onClick={handleRestart}
        >
          Start a new run
        </button>
      </div>
    </div>
  )
}
