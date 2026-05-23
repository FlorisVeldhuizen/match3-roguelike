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
    return subscribeGameEvents((event) => {
      if (event.kind === 'phase-changed' && event.phase === 'game-over') {
        setReveal(true)
      }
    })
  }, [])

  useEffect(() => {
    if (phase !== 'game-over') setReveal(false)
  }, [phase])

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
