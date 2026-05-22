import { useGameStore } from '../../core/state/store'

export function VictoryOverlay() {
  const phase = useGameStore((s) => s.fight.phase)

  if (phase !== 'victory') return null

  // Reload restarts board+fight cleanly. A proper in-place reset (rebuilding
  // Pixi sprites against a new board) is on the Phase E to-do list.
  const handleRestart = () => {
    useGameStore.getState().restart()
    window.location.reload()
  }

  return (
    <div className="victory-overlay" role="dialog" aria-label="Victory">
      <div className="victory-card">
        <h1 className="victory-title">You Win!</h1>
        <p className="victory-sub">Enemy defeated. Phase D placeholder.</p>
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
