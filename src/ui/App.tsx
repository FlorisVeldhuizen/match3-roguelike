import { HUD } from './components/HUD'
import { EnemyFrame } from './components/EnemyFrame'
import { VictoryOverlay } from './components/VictoryOverlay'

export const BOARD_MOUNT_ID = 'board-mount'

export function App() {
  return (
    <main className="game">
      <header className="game-header">
        <span className="hud-title">Match-3 Roguelike</span>
        <span className="hud-build">Phase D · pools & combat</span>
      </header>
      <EnemyFrame />
      <section className="board-shell" aria-label="Game board">
        <div id={BOARD_MOUNT_ID} className="board-mount" />
      </section>
      <HUD />
      <VictoryOverlay />
    </main>
  )
}
