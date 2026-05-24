import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'

export function GameOverOverlay() {
  const phase = useGameStore((s) => s.fight.phase)
  const runPhase = useGameStore((s) => s.runPhase)
  // Gated on `gameplay-settled` (BoardScene fires this after the AC drains
  // + cushion). Adapts to actual cascade length instead of a fixed timer.
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

  // H1: also require runPhase to be 'game-over' so a stale fight.phase from
  // a previous run doesn't haunt the next one after restart.
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
