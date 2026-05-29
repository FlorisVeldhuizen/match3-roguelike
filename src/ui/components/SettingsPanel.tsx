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
import {
  GEM_STYLE_VARIANTS,
  gemStyleHint,
  gemStyleLabel,
  getGemStyle,
  setGemStyle,
  subscribeGemStyle,
  type GemStyleVariant,
} from '../../gems/settings'
import { useGameStore } from '../../core/state/store'
import type { EnemyArchetype } from '../../types'
import {
  emitDebugSwap,
  getTimeScale,
  isStepMode,
  isUnlockAllSpells,
  setStepMode,
  setTimeScale,
  setUnlockAllSpells,
  subscribeStepMode,
  subscribeTimeScale,
  subscribeUnlockAllSpells,
} from '../../debug/devControls'

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

const DEV_FIGHT_ARCHETYPES: { id: EnemyArchetype; label: string }[] = [
  { id: 'skirmisher', label: 'Skirm' },
  { id: 'brute', label: 'Brute' },
  { id: 'smolder', label: 'Smolder' },
  { id: 'defender', label: 'Defender' },
  { id: 'rallier', label: 'Rallier' },
  { id: 'caster', label: 'Caster' },
  { id: 'swarmer', label: 'Swarmer' },
  { id: 'leech', label: 'Leech' },
  { id: 'shade', label: 'Shade' },
  { id: 'trickster', label: 'Trick' },
  { id: 'tyrant', label: 'Tyrant' },
]

type SectionKey = 'sound' | 'gem' | 'fx' | 'dev'
type DevSubKey = 'match' | 'fight' | 'speed' | 'toggles'

const COLLAPSED_STORAGE_KEY = 'settings-panel:collapsed'
const DEV_COLLAPSED_STORAGE_KEY = 'settings-panel:dev-collapsed'

function loadCollapsed<K extends string>(key: string, defaults: Record<K, boolean>): Record<K, boolean> {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out = { ...defaults }
    for (const k of Object.keys(defaults) as K[]) {
      if (typeof parsed[k] === 'boolean') out[k] = parsed[k] as boolean
    }
    return out
  } catch {
    return defaults
  }
}
function saveCollapsed(key: string, value: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage may throw in private browsing / quota exceeded.
  }
}

export function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>(() =>
    loadCollapsed<SectionKey>(COLLAPSED_STORAGE_KEY, {
      sound: false,
      gem: false,
      fx: false,
      dev: false,
    }),
  )
  useEffect(() => saveCollapsed(COLLAPSED_STORAGE_KEY, collapsed), [collapsed])
  const toggleSection = (key: SectionKey) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  const [devCollapsed, setDevCollapsed] = useState<Record<DevSubKey, boolean>>(() =>
    loadCollapsed<DevSubKey>(DEV_COLLAPSED_STORAGE_KEY, {
      match: false,
      fight: false,
      speed: false,
      toggles: false,
    }),
  )
  useEffect(() => saveCollapsed(DEV_COLLAPSED_STORAGE_KEY, devCollapsed), [devCollapsed])
  const toggleDevSub = (key: DevSubKey) =>
    setDevCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  const rootRef = useRef<HTMLDivElement | null>(null)

  const [muted, setMutedState] = useState(isMuted)
  const [volume, setVolumeState] = useState(getVolume)
  useEffect(() => subscribeMuted(setMutedState), [])
  useEffect(() => subscribeVolume(setVolumeState), [])

  const [fxSettings, setFxSettingsState] = useState<FXSettings>(getFXSettings)
  useEffect(() => subscribeFXSettings(setFxSettingsState), [])

  const [gemStyle, setGemStyleState] = useState<GemStyleVariant>(getGemStyle)
  useEffect(() => subscribeGemStyle(setGemStyleState), [])

  const [speed, setSpeed] = useState(getTimeScale())
  const [stepOn, setStepOn] = useState(isStepMode())
  const [unlockAll, setUnlockAll] = useState(isUnlockAllSpells())
  useEffect(() => subscribeTimeScale(setSpeed), [])
  useEffect(() => subscribeStepMode(setStepOn), [])
  useEffect(() => subscribeUnlockAllSpells(setUnlockAll), [])

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

  const forceFight = (archetype: EnemyArchetype) => {
    useGameStore.getState().debugForceFight(archetype)
    setOpen(false)
  }

  const forceTrio = () => {
    useGameStore.getState().debugForceFight(['skirmisher', 'brute', 'smolder'])
    setOpen(false)
  }

  const forceSwarm = () => {
    useGameStore.getState().debugForceFight(['swarmer', 'swarmer', 'swarmer'])
    setOpen(false)
  }

  const fillManaPools = () => {
    useGameStore.getState().debugFillManaPools()
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
        {import.meta.env.DEV && stepOn ? (
          <span className="settings-button-badge" title="Step mode is ON" aria-hidden>
            STEP
          </span>
        ) : null}
        <span aria-hidden>⚙</span>
      </button>
      {open ? (
        <div className="settings-popover" role="menu">
          <section className={`settings-section ${collapsed.sound ? 'is-collapsed' : ''}`}>
            <SectionHeader
              label="Sound"
              collapsed={collapsed.sound}
              onToggle={() => toggleSection('sound')}
            />
            {collapsed.sound ? null : (
            <>
            <label className="settings-row" aria-label="Mute sound effects">
              <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
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
            </>
            )}
          </section>

          <section className={`settings-section ${collapsed.gem ? 'is-collapsed' : ''}`}>
            <SectionHeader
              label="Gem style"
              collapsed={collapsed.gem}
              onToggle={() => toggleSection('gem')}
            />
            {collapsed.gem ? null : (
            <>
            <p className="settings-hint">
              Board and HUD gems — see public/gems/CREDITS.md. Saved locally.
            </p>
            <div className="settings-row settings-row-chips settings-row-gem-style">
              {GEM_STYLE_VARIANTS.map((variant) => (
                <button
                  key={variant}
                  type="button"
                  className={`settings-chip ${gemStyle === variant ? 'is-active' : ''}`}
                  title={gemStyleHint(variant)}
                  onClick={() => setGemStyle(variant)}
                >
                  {gemStyleLabel(variant)}
                </button>
              ))}
            </div>
            </>
            )}
          </section>

          <section className={`settings-section ${collapsed.fx ? 'is-collapsed' : ''}`}>
            <SectionHeader
              label="Visual FX"
              collapsed={collapsed.fx}
              onToggle={() => toggleSection('fx')}
            />
            {collapsed.fx ? null : FX_ROWS.map((row) => (
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
            <section
              className={`settings-section settings-section-dev ${collapsed.dev ? 'is-collapsed' : ''}`}
            >
              <SectionHeader
                label="Dev"
                collapsed={collapsed.dev}
                onToggle={() => toggleSection('dev')}
              />
              {collapsed.dev ? null : (
              <>
              <div
                className={`settings-subsection ${devCollapsed.match ? 'is-collapsed' : ''}`}
              >
                <SubHeader
                  label="Force match"
                  collapsed={devCollapsed.match}
                  onToggle={() => toggleDevSub('match')}
                />
                {devCollapsed.match ? null : (
                  <div className="settings-chips">
                    <button type="button" className="settings-chip" onClick={forceMatch5}>
                      Line-5
                    </button>
                    <button type="button" className="settings-chip" onClick={forceMatchT}>
                      T
                    </button>
                    <button type="button" className="settings-chip" onClick={forceMatchL}>
                      L
                    </button>
                  </div>
                )}
              </div>
              <div
                className={`settings-subsection ${devCollapsed.fight ? 'is-collapsed' : ''}`}
              >
                <SubHeader
                  label="Force fight"
                  collapsed={devCollapsed.fight}
                  onToggle={() => toggleDevSub('fight')}
                />
                {devCollapsed.fight ? null : (
                  <div className="settings-chips">
                    {DEV_FIGHT_ARCHETYPES.map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        className="settings-chip"
                        onClick={() => forceFight(id)}
                      >
                        {label}
                      </button>
                    ))}
                    <button type="button" className="settings-chip" onClick={forceTrio}>
                      Trio
                    </button>
                    <button type="button" className="settings-chip" onClick={forceSwarm}>
                      Swarm×3
                    </button>
                  </div>
                )}
              </div>
              <div
                className={`settings-subsection ${devCollapsed.speed ? 'is-collapsed' : ''}`}
              >
                <SubHeader
                  label="Speed"
                  collapsed={devCollapsed.speed}
                  onToggle={() => toggleDevSub('speed')}
                />
                {devCollapsed.speed ? null : (
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
                )}
              </div>
              <div
                className={`settings-subsection ${devCollapsed.toggles ? 'is-collapsed' : ''}`}
              >
                <SubHeader
                  label="Toggles"
                  collapsed={devCollapsed.toggles}
                  onToggle={() => toggleDevSub('toggles')}
                />
                {devCollapsed.toggles ? null : (
                  <>
                    <label
                      className="settings-row"
                      title="Pauses between game events. A floating stepper appears in the corner to advance them."
                    >
                      <input
                        type="checkbox"
                        checked={stepOn}
                        onChange={(e) => {
                          setStepMode(e.target.checked)
                          if (e.target.checked) setOpen(false)
                        }}
                      />
                      <span className="settings-label">Step mode</span>
                    </label>
                    <label
                      className="settings-row"
                      title="Show the full spell pool in the tray. Off = starter kit only (baseline kit + ultimate); rest are treated as discoverable."
                    >
                      <input
                        type="checkbox"
                        checked={unlockAll}
                        onChange={(e) => setUnlockAllSpells(e.target.checked)}
                      />
                      <span className="settings-label">Unlock all spells</span>
                    </label>
                    <button type="button" className="settings-btn" onClick={fillManaPools}>
                      Fill mana pools
                    </button>
                  </>
                )}
              </div>
              </>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function SectionHeader({
  label,
  collapsed,
  onToggle,
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="settings-title settings-section-toggle"
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      <span className="settings-section-chevron" aria-hidden>
        {collapsed ? '▸' : '▾'}
      </span>
      <span>{label}</span>
    </button>
  )
}

function SubHeader({
  label,
  collapsed,
  onToggle,
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="settings-subsection-toggle"
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      <span className="settings-section-chevron" aria-hidden>
        {collapsed ? '▸' : '▾'}
      </span>
      <span>{label}</span>
    </button>
  )
}
