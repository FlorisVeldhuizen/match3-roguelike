import { useGameStore } from '../../core/state/store'

export function GameOverOverlay() {
  const phase = useGameStore((s) => s.fight.phase)

  if (phase !== 'game-over') return null

  // Reload restarts board + fight + Pixi cleanly. Same shortcut as victory —
  // an in-place rebuild of the Pixi sprite grid against a new board is on
  // the Phase H1 to-do list (run-flow scaffold).
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
