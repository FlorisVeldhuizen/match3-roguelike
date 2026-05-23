import { HUD } from './components/HUD'
import { EnemyFrame } from './components/EnemyFrame'
import { VictoryOverlay } from './components/VictoryOverlay'
import { GameOverOverlay } from './components/GameOverOverlay'
import { PhaseBanner } from './components/PhaseBanner'
import { MuteToggle } from './components/MuteToggle'
import { ArcaneBackground } from './components/ArcaneBackground'

export const BOARD_MOUNT_ID = 'board-mount'

export function App() {
  return (
    <>
      <ArcaneBackground />
      <main className="game">
        <header className="game-header">
          <span className="hud-title">Renzadora</span>
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
      {/* Outside .game so the screenshake transform doesn't drag it around
          (position:fixed is relative to the nearest transformed ancestor).
          The banner reads board-mount's bounding rect to align itself to
          the board's resting center — see PhaseBanner.tsx. */}
      <PhaseBanner />
    </>
  )
}
