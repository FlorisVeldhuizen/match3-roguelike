import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'

export function VictoryOverlay() {
  const phase = useGameStore((s) => s.fight.phase)
  // Gate on the animation-timed `phase-changed` event, not the store's phase.
  // The store flips to 'victory' synchronously when the killing match resolves,
  // but death/cascade animations still need to play out first.
  const [reveal, setReveal] = useState(phase === 'victory')

  useEffect(() => {
    // Single source of truth: any phase-changed event sets reveal to match.
    // True only when the animation-timed event says we're in victory; flips
    // back to false on the next non-victory transition (e.g. restart) so a
    // future victory waits on its own animation gate instead of snapping in.
    return subscribeGameEvents((event) => {
      if (event.kind === 'phase-changed') {
        setReveal(event.phase === 'victory')
      }
    })
  }, [])

  if (!reveal || phase !== 'victory') return null

  // Reload restarts board+fight+Pixi cleanly. An in-place Pixi sprite-grid
  // rebuild lands with the run-flow scaffolding.
  const handleRestart = () => {
    useGameStore.getState().restart()
    window.location.reload()
  }

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
