import { HUD } from './components/HUD'
import { EnemyFrame } from './components/EnemyFrame'
import { VictoryOverlay } from './components/VictoryOverlay'
import { GameOverOverlay } from './components/GameOverOverlay'
import { PhaseBanner } from './components/PhaseBanner'
import { MuteToggle } from './components/MuteToggle'

export const BOARD_MOUNT_ID = 'board-mount'

export function App() {
  return (
    <>
      <main className="game">
        <header className="game-header">
          <span className="hud-title">Match-3 Roguelike</span>
          <span className="hud-build">Phase E · enemy intents</span>
          <MuteToggle />
        </header>
        <EnemyFrame />
        <section className="board-shell" aria-label="Game board">
          <div id={BOARD_MOUNT_ID} className="board-mount" />
        </section>
        <HUD />
        <VictoryOverlay />
        <GameOverOverlay />
      </main>
      {/* Outside .game so the screenshake transform on .game can't shift it —
          position:fixed is relative to the nearest transformed ancestor. */}
      <PhaseBanner />
    </>
  )
}
