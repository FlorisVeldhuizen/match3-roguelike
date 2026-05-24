import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'

// H1: this is the run-cleared screen, mounted by App only when
// runPhase==='victory' (boss kill). Conditional mount means a fresh
// instance each time. Reveal is gated on the `gameplay-settled` event,
// which BoardScene fires after the AC has actually drained its queue
// AND a short cushion for trailing FX has elapsed. This adapts to
// cascade length: long chains play out fully, short kills reveal
// promptly.
export function VictoryOverlay() {
  const [reveal, setReveal] = useState(false)

  useEffect(() => {
    const unsub = subscribeGameEvents((event) => {
      if (event.kind !== 'gameplay-settled') return
      // Only reveal if we're still in the victory phase by the time the
      // gameplay actually settles (defensive — a phase change away from
      // victory shouldn't be possible here, but the parent's conditional
      // mount means we'd be unmounted anyway in that case).
      if (useGameStore.getState().fight.phase === 'victory') {
        setReveal(true)
      }
    })
    return unsub
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
