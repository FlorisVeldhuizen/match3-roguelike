import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'

export function GameOverOverlay() {
  const phase = useGameStore((s) => s.fight.phase)
  const runPhase = useGameStore((s) => s.runPhase)
  const [reveal, setReveal] = useState(phase === 'game-over')

  useEffect(() => {
    const unsub = subscribeGameEvents((event) => {
      if (event.kind !== 'gameplay-settled') return
      if (useGameStore.getState().fight.phase === 'game-over') {
        setReveal(true)
      }
    })
    return unsub
  }, [])

  if (!reveal || runPhase !== 'game-over') return null

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
