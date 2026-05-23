import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'

export function VictoryOverlay() {
  const phase = useGameStore((s) => s.fight.phase)
  // Gate on the animation-timed phase-changed event so the overlay waits
  // for the kill beat to play before appearing.
  const [reveal, setReveal] = useState(phase === 'victory')

  useEffect(
    () =>
      subscribeGameEvents((event) => {
        if (event.kind === 'phase-changed') setReveal(event.phase === 'victory')
      }),
    [],
  )

  if (!reveal || phase !== 'victory') return null

  const handleRestart = () => useGameStore.getState().restart()

  return (
    <div className="victory-overlay" role="dialog" aria-label="Victory">
      <div className="victory-card">
        <h1 className="victory-title">Victory</h1>
        <p className="victory-sub">Enemy defeated.</p>
        <button
          type="button"
          className="victory-restart"
          onClick={handleRestart}
        >
          Fight again
        </button>
      </div>
    </div>
  )
}
