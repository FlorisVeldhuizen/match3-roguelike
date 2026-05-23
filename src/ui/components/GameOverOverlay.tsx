import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'

export function GameOverOverlay() {
  const phase = useGameStore((s) => s.fight.phase)
  // Gate on the animation-timed `phase-changed`, not the store's phase. The
  // store flips to 'game-over' synchronously when the lethal hit resolves,
  // but the damage-taken beat still needs to play first.
  const [reveal, setReveal] = useState(phase === 'game-over')

  useEffect(() => {
    // Single source of truth: any phase-changed event sets reveal to match.
    // True only when the animation-timed event says we're in game-over;
    // flips back to false on the next non-game-over transition (restart) so
    // a future defeat waits on its own animation gate instead of snapping in.
    return subscribeGameEvents((event) => {
      if (event.kind === 'phase-changed') {
        setReveal(event.phase === 'game-over')
      }
    })
  }, [])

  if (!reveal || phase !== 'game-over') return null

  // Reload restarts board + fight + Pixi cleanly. Same shortcut as victory;
  // an in-place Pixi sprite-grid rebuild lands with the run-flow scaffold.
  const handleRestart = () => {
    useGameStore.getState().restart()
    window.location.reload()
  }

  return (
    <div className="game-over-overlay" role="dialog" aria-label="Defeat">
      <div className="game-over-card">
        <h1 className="game-over-title">Defeated</h1>
        <p className="game-over-sub">
          Your knight fell. Try again from a fresh board.
        </p>
        <button
          type="button"
          className="game-over-restart"
          onClick={handleRestart}
        >
          Try again
        </button>
      </div>
    </div>
  )
}
