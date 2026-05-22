export const BOARD_MOUNT_ID = 'board-mount'

export function App() {
  return (
    <main className="game">
      <header className="hud-placeholder" aria-label="HUD placeholder">
        <span className="hud-title">Match-3 Roguelike</span>
        <span className="hud-phase">Phase B · board + swap</span>
      </header>
      <section className="board-shell" aria-label="Game board">
        <div id={BOARD_MOUNT_ID} className="board-mount" />
      </section>
    </main>
  )
}
