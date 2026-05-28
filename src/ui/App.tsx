import { useEffect } from 'react'
import { HUD } from './components/HUD'
import { SpellTray } from './components/SpellTray'
import { EnemyFrame } from './components/EnemyFrame'
import { VictoryOverlay } from './components/VictoryOverlay'
import { GameOverOverlay } from './components/GameOverOverlay'
import { PhaseBanner } from './components/PhaseBanner'
import { SettingsPanel } from './components/SettingsPanel'
import { StepperOverlay } from './components/StepperOverlay'
import { ArcaneBackground } from './components/ArcaneBackground'
import { AriaLiveAnnouncer } from './components/AriaLiveAnnouncer'
import { CRTOverlay } from './components/CRTOverlay'
import { BurningOverlay } from './components/BurningOverlay'
import { BlessedOverlay } from './components/BlessedOverlay'
import { ColumnSmashOverlay } from './components/ColumnSmashOverlay'
import { PetrifyOverlay } from './components/PetrifyOverlay'
import { FrozenWallOverlay } from './components/FrozenWallOverlay'
import { ColorHexOverlay } from './components/ColorHexOverlay'
import { ColorDrainOverlay } from './components/ColorDrainOverlay'
import { ClusterShoveOverlay } from './components/ClusterShoveOverlay'
import { RelicTray } from './components/RelicTray'
import { RewardScreen } from './components/RewardScreen'
import { RestScreen } from './components/RestScreen'
import { ShopScreen } from './components/ShopScreen'
import { MapScreen } from './components/MapScreen'
import { useGameStore } from '../core/state/store'

type OverlayHandle = { clearAll: () => void }

export const BOARD_MOUNT_ID = 'board-mount'

export function App() {
  const seed = useGameStore((s) => s.rootSeed)
  const runPhase = useGameStore((s) => s.runPhase)
  const boardTargetingSpell = useGameStore((s) => s.boardTargetingSpell)

  useEffect(() => {
    ;(window as unknown as { __store?: typeof useGameStore }).__store = useGameStore
  }, [])

  useEffect(() => {
    if (runPhase !== 'map') return
    const overlay = (window as unknown as { __overlay?: OverlayHandle }).__overlay
    overlay?.clearAll()
  }, [runPhase])

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
              <BurningOverlay />
              <BlessedOverlay />
              <ColumnSmashOverlay />
              <PetrifyOverlay />
              <FrozenWallOverlay />
              <ColorHexOverlay />
              <ColorDrainOverlay />
              <ClusterShoveOverlay />
              <PhaseBanner />
            </div>
          </section>
        </div>
        <HUD />
        <SpellTray />
        {runPhase === 'victory' ? <VictoryOverlay /> : null}
        {runPhase === 'reward' ? <RewardScreen /> : null}
        {runPhase === 'rest' ? <RestScreen /> : null}
        {runPhase === 'shop' ? <ShopScreen /> : null}
        <GameOverOverlay />
      </main>
      <MapScreen />
      <AriaLiveAnnouncer />
      <CRTOverlay />
      {import.meta.env.DEV ? <StepperOverlay /> : null}
    </>
  )
}
