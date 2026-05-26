import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'

export function VictoryOverlay() {
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
