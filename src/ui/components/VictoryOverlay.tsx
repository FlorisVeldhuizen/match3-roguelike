import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'

// Settle delay between the engine's `phase-changed:victory` event and
// the modal mount. The engine fires that event at the END of the
// cascade-resolution event queue, but several pieces of FX (kill pulse
// on the enemy frame, damage popup drifting up at trail arrival, last
// cascade-complete chime) keep running on their own real-time timers
// for a beat after. Without this delay the modal mounts mid-animation
// and you get a visible UI shift / overlap. ~900ms covers the longest
// trailing animation (KILL_PULSE_MS = 720ms in EnemyFrame plus a
// little headroom for the damage popup drift).
const VICTORY_SETTLE_DELAY_MS = 900

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

  useEffect(() => {
    let timer: number | null = null
    const unsub = subscribeGameEvents((event) => {
      if (event.kind === 'phase-changed' && event.phase === 'victory') {
        if (timer != null) window.clearTimeout(timer)
        timer = window.setTimeout(() => setReveal(true), VICTORY_SETTLE_DELAY_MS)
      }
    })
    return () => {
      unsub()
      if (timer != null) window.clearTimeout(timer)
    }
  }, [])

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
