import { useEffect } from 'react'
import { HUD } from './components/HUD'
import { SpellTray } from './components/SpellTray'
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
import { ColumnSmashOverlay } from './components/ColumnSmashOverlay'
import { PetrifyOverlay } from './components/PetrifyOverlay'
import { ColorHexOverlay } from './components/ColorHexOverlay'
import { ClusterShoveOverlay } from './components/ClusterShoveOverlay'
import { RelicTray } from './components/RelicTray'
import { RewardScreen } from './components/RewardScreen'
import { RestScreen } from './components/RestScreen'
import { ShopScreen } from './components/ShopScreen'
import { MapScreen } from './components/MapScreen'
import { useGameStore } from '../core/state/store'

// Duck-typed handle for the Pixi overlay (lives on window.__overlay).
// Kept here as a local shape to avoid the ui → pixi import boundary.
type OverlayHandle = { clearAll: () => void }

export const BOARD_MOUNT_ID = 'board-mount'

export function App() {
  const seed = useGameStore((s) => s.rootSeed)
  const runPhase = useGameStore((s) => s.runPhase)
  const boardTargetingSpell = useGameStore((s) => s.boardTargetingSpell)

  useEffect(() => {
    ;(window as unknown as { __store?: typeof useGameStore }).__store = useGameStore
  }, [])

  // Only wipe the overlay when entering the map. During victory/reward/
  // game-over the cascade is still resolving its trailing FX (damage
  // popups, kill pulses); we want those to play out visibly. The map
  // screen has z-index 9 + an opaque background and covers the overlay
  // canvas (z-index 5) on its own, so no extra visibility toggling is
  // needed there either.
  useEffect(() => {
    if (runPhase !== 'map') return
    const overlay = (window as unknown as { __overlay?: OverlayHandle }).__overlay
    overlay?.clearAll()
  }, [runPhase])

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
          <span className="hud-build">{runPhase}</span>
          <div className="game-header-controls">
            <RelicTray />
            <SettingsPanel />
          </div>
        </header>
        {/* .game-scene wraps the elements that participate in the screen
            shake (enemies + board). HUD, spells, and modals sit OUTSIDE
            this wrapper, so the shake doesn't drag them around. Before,
            the shake was on .game itself and the entire UI shifted in
            sync with the combat — readable but disorienting during a
            cascade chain with stacked shakes. */}
        <div className="game-scene">
          <EnemyFrame />
          <section className="board-shell" aria-label="Game board">
            <div
              id={BOARD_MOUNT_ID}
              className={`board-mount${
                boardTargetingSpell !== null
                  ? ` is-board-targeting is-targeting-${boardTargetingSpell}`
                  : ''
              }`}
            >
              {/* Pixi appends its canvas to board-mount via appendChild.
                  React leaves DOM nodes it didn't create alone, so the
                  canvas and this overlay coexist as siblings inside the
                  mount div. */}
              <BurningOverlay />
              <BlessedOverlay />
              <ColumnSmashOverlay />
              <PetrifyOverlay />
              <ColorHexOverlay />
              <ClusterShoveOverlay />
            </div>
          </section>
        </div>
        {/* HUD (state + resources) sits below the board. Spells below
            the HUD. The "above-board" placement we tried earlier didn't
            earn its complexity — moving everything to the bottom is
            more familiar and now feels uncrowded thanks to the lighter
            pips, capped HP-bar width, and inline statuses. */}
        <HUD />
        <SpellTray />
        {/* Conditional mounts so each fight gets a fresh `reveal` flag
            (gated on the `gameplay-settled` event). An always-mounted
            modal would carry reveal=true into the next fight. */}
        {runPhase === 'victory' ? <VictoryOverlay /> : null}
        {runPhase === 'reward' ? <RewardScreen /> : null}
        {runPhase === 'rest' ? <RestScreen /> : null}
        {runPhase === 'shop' ? <ShopScreen /> : null}
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
    </>
  )
}
