import { useEffect, useRef, useState } from 'react'
import {
  getVolume,
  isMuted,
  setMuted,
  setVolume,
  subscribeMuted,
  subscribeVolume,
} from '../../audio/sfx'
import {
  getFXSettings,
  setFX,
  subscribeFXSettings,
  type FXKey,
  type FXSettings,
} from '../../fx/settings'
import { useGameStore } from '../../core/state/store'
import {
  advanceStep,
  emitDebugSwap,
  getTimeScale,
  isStepMode,
  setStepMode,
  setTimeScale,
  subscribeStepMode,
  subscribeTimeScale,
} from '../../debug/devControls'

// Single header-anchored popover that combines all runtime settings:
// sound (mute + volume), visual FX toggles, and (dev builds only) the
// debug tooling for the cascade pipeline. Replaces the three separate
// header buttons (VolumeSlider, MuteToggle, FXToggle) plus the floating
// DevTools panel. Popover pattern mirrors the old FXToggle (close on
// outside click + Escape).

const FX_ROWS: { key: FXKey; label: string; hint: string }[] = [
  { key: 'rgbSplit', label: 'RGB Split', hint: 'Chromatic accent on in-board callouts' },
  { key: 'shockwave', label: 'Shockwave', hint: 'Ripple on big matches & cascades' },
  { key: 'crt', label: 'CRT Noise', hint: 'Faint scanline + temporal noise' },
]

const DEV_SPEEDS: { value: number; label: string }[] = [
  { value: 1, label: '1×' },
  { value: 0.5, label: '½×' },
  { value: 0.25, label: '¼×' },
]

export function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Sound state
  const [muted, setMutedState] = useState(isMuted)
  const [volume, setVolumeState] = useState(getVolume)
  useEffect(() => subscribeMuted(setMutedState), [])
  useEffect(() => subscribeVolume(setVolumeState), [])

  // FX state
  const [fxSettings, setFxSettingsState] = useState<FXSettings>(getFXSettings)
  useEffect(() => subscribeFXSettings(setFxSettingsState), [])

  // Dev state (only mounted when import.meta.env.DEV is true at the
  // component-render level; the hooks below are always called to keep
  // hook order stable, but the values they observe are inert in prod).
  const [speed, setSpeed] = useState(getTimeScale())
  const [stepOn, setStepOn] = useState(isStepMode())
  useEffect(() => subscribeTimeScale(setSpeed), [])
  useEffect(() => subscribeStepMode(setStepOn), [])

  // Close on outside click / Escape (same pattern the old FXToggle used).
  useEffect(() => {
    if (!open) return
    const onPointer = (ev: PointerEvent) => {
      if (!rootRef.current) return
      if (!(ev.target instanceof Node)) return
      if (!rootRef.current.contains(ev.target)) setOpen(false)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const forceMatch5 = () => {
    const swap = useGameStore.getState().debugForceMatch5()
    if (!swap) return
    // Defer one tick so the store mutation re-renders the BoardScene
    // sprite grid before the triggering swap animates.
    window.setTimeout(() => emitDebugSwap(swap.from, swap.to), 0)
  }

  const forceMatchT = () => {
    const swap = useGameStore.getState().debugForceMatchT()
    if (!swap) return
    window.setTimeout(() => emitDebugSwap(swap.from, swap.to), 0)
  }

  const forceMatchL = () => {
    const swap = useGameStore.getState().debugForceMatchL()
    if (!swap) return
    window.setTimeout(() => emitDebugSwap(swap.from, swap.to), 0)
  }

  const forceFight = (
    archetype: 'skirmisher' | 'brute' | 'smolder' | 'defender' | 'rallier',
  ) => {
    useGameStore.getState().debugForceFight(archetype)
    setOpen(false)
  }

  const forceTrio = () => {
    useGameStore.getState().debugForceFight(['skirmisher', 'brute', 'smolder'])
    setOpen(false)
  }

  return (
    <div className="settings-panel" ref={rootRef}>
      <button
        type="button"
        className="settings-button"
        aria-label="Settings"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>⚙</span>
      </button>
      {open ? (
        <div className="settings-popover" role="menu">
          <section className="settings-section">
            <div className="settings-title">Sound</div>
            <label className="settings-row" aria-label="Mute sound effects">
              <input
                type="checkbox"
                checked={muted}
                onChange={(e) => setMuted(e.target.checked)}
              />
              <span className="settings-label">Mute</span>
            </label>
            <label
              className="settings-row settings-row-slider"
              aria-label={`Volume ${Math.round(volume * 100)}%`}
            >
              <span className="settings-label">Volume</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                disabled={muted}
              />
              <span className="settings-value">{Math.round(volume * 100)}%</span>
            </label>
          </section>

          <section className="settings-section">
            <div className="settings-title">Visual FX</div>
            {FX_ROWS.map((row) => (
              <label key={row.key} className="settings-row" title={row.hint}>
                <input
                  type="checkbox"
                  checked={fxSettings[row.key]}
                  onChange={(e) => setFX(row.key, e.target.checked)}
                />
                <span className="settings-label">{row.label}</span>
              </label>
            ))}
          </section>

          {import.meta.env.DEV ? (
            <section className="settings-section settings-section-dev">
              <div className="settings-title">Dev</div>
              <div className="settings-row settings-row-chips">
                <span className="settings-label">Force match</span>
                <div className="settings-chips">
                  <button
                    type="button"
                    className="settings-chip"
                    onClick={forceMatch5}
                  >
                    Line-5
                  </button>
                  <button
                    type="button"
                    className="settings-chip"
                    onClick={forceMatchT}
                  >
                    T
                  </button>
                  <button
                    type="button"
                    className="settings-chip"
                    onClick={forceMatchL}
                  >
                    L
                  </button>
                </div>
              </div>
              <div className="settings-row settings-row-chips">
                <span className="settings-label">Force fight</span>
                <div className="settings-chips">
                  <button
                    type="button"
                    className="settings-chip"
                    onClick={() => forceFight('skirmisher')}
                  >
                    Skirm
                  </button>
                  <button
                    type="button"
                    className="settings-chip"
                    onClick={() => forceFight('brute')}
                  >
                    Brute
                  </button>
                  <button
                    type="button"
                    className="settings-chip"
                    onClick={() => forceFight('smolder')}
                  >
                    Smolder
                  </button>
                  <button
                    type="button"
                    className="settings-chip"
                    onClick={() => forceFight('defender')}
                  >
                    Defender
                  </button>
                  <button
                    type="button"
                    className="settings-chip"
                    onClick={() => forceFight('rallier')}
                  >
                    Rallier
                  </button>
                  <button
                    type="button"
                    className="settings-chip"
                    onClick={forceTrio}
                  >
                    Trio
                  </button>
                </div>
              </div>
              <div className="settings-row settings-row-chips">
                <span className="settings-label">Speed</span>
                <div className="settings-chips">
                  {DEV_SPEEDS.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      className={`settings-chip ${speed === s.value ? 'is-active' : ''}`}
                      onClick={() => setTimeScale(s.value)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="settings-row">
                <input
                  type="checkbox"
                  checked={stepOn}
                  onChange={(e) => setStepMode(e.target.checked)}
                />
                <span className="settings-label">Step mode</span>
              </label>
              <button
                type="button"
                className="settings-btn"
                onClick={advanceStep}
                disabled={!stepOn}
              >
                Step ▶
              </button>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
