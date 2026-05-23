import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'

export function GameOverOverlay() {
  const phase = useGameStore((s) => s.fight.phase)
  // Gate on the animation-timed phase-changed event so the overlay waits
  // for the lethal-hit beat to play before appearing.
  const [reveal, setReveal] = useState(phase === 'game-over')

  useEffect(
    () =>
      subscribeGameEvents((event) => {
        if (event.kind === 'phase-changed') setReveal(event.phase === 'game-over')
      }),
    [],
  )

  if (!reveal || phase !== 'game-over') return null

  const handleRestart = () => useGameStore.getState().restart()

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
