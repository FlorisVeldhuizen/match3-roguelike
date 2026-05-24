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
import { MapScreen } from './components/MapScreen'
import { Splash } from './components/Splash'
import { useGameStore } from '../core/state/store'

export const BOARD_MOUNT_ID = 'board-mount'

export function App() {
  const seed = useGameStore((s) => s.rootSeed)
  const runPhase = useGameStore((s) => s.runPhase)
  // Pixi's canvas is appended into #board-mount at app bootstrap (see
  // main.tsx). Don't unmount the fight chrome when the player is on the
  // map — toggle a visibility class so #board-mount stays in the DOM and
  // we don't have to tear down and re-init the Pixi app on every node entry.
  const gameClass = runPhase === 'map' ? 'game game-fight-hidden' : 'game'
  return (
    <>
      <ArcaneBackground />
      <main className={gameClass}>
        <header className="game-header">
          <span className="hud-title">Renzadora</span>
          <span className="hud-seed" title="Run seed (select to copy)">
            {seed}
          </span>
          <span className="hud-build">Phase H1 · map</span>
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
        {/* Run-cleared and reward screens conditionally mount. Keeping
            them always-mounted means `reveal` (the phase-changed gate)
            accumulates true across fights, so the next runPhase transition
            into 'victory' / 'reward' would skip the cascade-drain wait. */}
        {runPhase === 'victory' ? <VictoryOverlay /> : null}
        {runPhase === 'reward' ? <RewardScreen /> : null}
        <GameOverOverlay />
      </main>
      <MapScreen />
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
