import { useEffect, useRef, useState } from 'react'
import {
  getFXSettings,
  setFX,
  subscribeFXSettings,
  type FXKey,
  type FXSettings,
} from '../../fx/settings'

const ROWS: { key: FXKey; label: string; hint: string }[] = [
  { key: 'rgbSplit', label: 'RGB Split', hint: 'Chromatic accent on in-board callouts' },
  { key: 'shockwave', label: 'Shockwave', hint: 'Ripple on big matches & cascades' },
  { key: 'crt', label: 'CRT Noise', hint: 'Faint scanline + temporal noise' },
]

export function FXToggle() {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<FXSettings>(getFXSettings)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => subscribeFXSettings(setSettings), [])

  // Close on outside click / Escape so the popover doesn't linger after the
  // user moves on to the board.
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

  return (
    <div className="fx-toggle" ref={rootRef}>
      <button
        type="button"
        className="fx-toggle-button"
        aria-label="Visual effects"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden>✦</span>
      </button>
      {open ? (
        <div className="fx-toggle-popover" role="menu">
          <div className="fx-toggle-title">Visual FX</div>
          {ROWS.map((row) => (
            <label key={row.key} className="fx-toggle-row" title={row.hint}>
              <input
                type="checkbox"
                checked={settings[row.key]}
                onChange={(ev) => setFX(row.key, ev.target.checked)}
              />
              <span className="fx-toggle-label">{row.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  )
}
