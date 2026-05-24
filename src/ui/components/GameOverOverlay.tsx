import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'

// Settle delay between the engine's `phase-changed:game-over` and the
// modal mount. The lethal-hit beat (red flash, screen shake, vignette,
// hit pulse on the HP bar) runs on real-time timers for ~500-700ms
// after the event; mounting immediately overlaps the modal with them.
// Matches VictoryOverlay / RewardScreen.
const GAME_OVER_SETTLE_DELAY_MS = 900

export function GameOverOverlay() {
  const phase = useGameStore((s) => s.fight.phase)
  const runPhase = useGameStore((s) => s.runPhase)
  // Gate on the animation-timed phase-changed event so the overlay waits
  // for the lethal-hit beat to play before appearing.
  const [reveal, setReveal] = useState(phase === 'game-over')

  useEffect(() => {
    let timer: number | null = null
    const unsub = subscribeGameEvents((event) => {
      if (event.kind === 'phase-changed') {
        if (timer != null) {
          window.clearTimeout(timer)
          timer = null
        }
        if (event.phase === 'game-over') {
          timer = window.setTimeout(
            () => setReveal(true),
            GAME_OVER_SETTLE_DELAY_MS,
          )
        } else {
          setReveal(false)
        }
      }
    })
    return () => {
      unsub()
      if (timer != null) window.clearTimeout(timer)
    }
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
