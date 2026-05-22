import { useGameStore } from '../../core/state/store'

export function VictoryOverlay() {
  const phase = useGameStore((s) => s.fight.phase)

  if (phase !== 'victory') return null

  // Reload restarts board+fight+Pixi cleanly. An in-place Pixi sprite-grid
  // rebuild lands with the H1 run-flow scaffolding.
  const handleRestart = () => {
    useGameStore.getState().restart()
    window.location.reload()
  }

  return (
    <div className="victory-overlay" role="dialog" aria-label="Victory">
      <div className="victory-card">
        <h1 className="victory-title">You Win!</h1>
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
