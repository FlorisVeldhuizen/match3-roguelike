import { HUD } from './components/HUD'
import { EnemyFrame } from './components/EnemyFrame'
import { VictoryOverlay } from './components/VictoryOverlay'
import { GameOverOverlay } from './components/GameOverOverlay'
import { PhaseBanner } from './components/PhaseBanner'
import { SettingsPanel } from './components/SettingsPanel'
import { ArcaneBackground } from './components/ArcaneBackground'
import { AriaLiveAnnouncer } from './components/AriaLiveAnnouncer'
import { CRTOverlay } from './components/CRTOverlay'
import { BurningOverlay } from './components/BurningOverlay'
import { BlessedOverlay } from './components/BlessedOverlay'
import { RelicTray } from './components/RelicTray'
import { RewardScreen } from './components/RewardScreen'
import { Splash } from './components/Splash'
import { useGameStore } from '../core/state/store'

export const BOARD_MOUNT_ID = 'board-mount'

export function App() {
  const seed = useGameStore((s) => s.rootSeed)
  return (
    <>
      <ArcaneBackground />
      <main className="game">
        <header className="game-header">
          <span className="hud-title">Renzadora</span>
          <span className="hud-seed" title="Run seed (select to copy)">
            {seed}
          </span>
          <span className="hud-build">Phase G · relics</span>
          <div className="game-header-controls">
            <RelicTray />
            <SettingsPanel />
          </div>
        </header>
        <EnemyFrame />
        <section className="board-shell" aria-label="Game board">
          <div id={BOARD_MOUNT_ID} className="board-mount">
            {/* Pixi appends its canvas to board-mount via appendChild.
                React leaves DOM nodes it didn't create alone, so the
                canvas and this overlay coexist as siblings inside the
                mount div. */}
            <BurningOverlay />
            <BlessedOverlay />
          </div>
        </section>
        <HUD />
        <VictoryOverlay />
        <RewardScreen />
        <GameOverOverlay />
      </main>
      {/* Outside .game so the screenshake transform doesn't drag it around
          (position:fixed is relative to the nearest transformed ancestor).
          The banner reads board-mount's bounding rect to align itself to
          the board's resting center — see PhaseBanner.tsx. */}
      <PhaseBanner />
      <AriaLiveAnnouncer />
      <CRTOverlay />
      <Splash />
    </>
  )
}
