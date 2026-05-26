import { useEffect } from 'react'
import { useGameStore } from '../../core/state/store'
import { emitGameEvent } from '../../core/events/emitter'
import type { StatusKind } from '../../types'

// H4a Purify picker. Opens when the player clicks Purify in the spell
// tray. Lists the player's current statuses; clicking one strips that
// status entirely (all stacks). If the chosen status is Burn, the
// player also heals 3. ESC or backdrop-click closes without casting.

const STATUS_LABELS: Record<StatusKind, string> = {
  burn: 'Burn',
  vulnerable: 'Vulnerable',
  weak: 'Weak',
  regen: 'Regenerate',
  // Strength is enemy-side only today (Rallier's buff-ally intent); the
  // player never carries it, so this label is defensive only — kept to
  // keep the Record exhaustive over StatusKind.
  strength: 'Strength',
}

// Regen is a beneficial status; players almost certainly don't want
// to strip it themselves. We show the chip greyed-out as a non-target
// for Purify (the spell can technically target it, but offering it as
// a click target invites misclicks). Filter the picker list to "bad"
// statuses only.
const PURIFIABLE: ReadonlySet<StatusKind> = new Set(['burn', 'vulnerable', 'weak'])

export function PurifyPickerModal({ onClose }: { onClose: () => void }) {
  const statuses = useGameStore((s) => s.fight.player.statuses)
  const castPurify = useGameStore((s) => s.castPurify)
  const removable = statuses.filter((s) => PURIFIABLE.has(s.kind))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // If there's nothing harmful to strip, the spell-tray gate should
  // keep this closed. Defensively close on mount if we got here anyway.
  useEffect(() => {
    if (removable.length === 0) onClose()
  }, [removable.length, onClose])

  const pick = (kind: StatusKind) => {
    const res = castPurify(kind)
    if (res.ok) {
      for (const ev of res.events) emitGameEvent(ev)
    }
    onClose()
  }

  return (
    <div
      className="spell-picker-overlay"
      role="dialog"
      aria-label="Choose a status to purify"
      onClick={onClose}
    >
      <div className="spell-picker-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="spell-picker-title">Purify</h2>
        <p className="spell-picker-sub">
          Strip a curse off you. Removing burn also heals 3 HP.
        </p>
        <div className="spell-picker-options">
          {removable.map((s) => (
            <button
              key={s.kind}
              type="button"
              className={`spell-picker-option status-${s.kind}`}
              onClick={() => pick(s.kind)}
            >
              <span className="spell-picker-option-name">
                {STATUS_LABELS[s.kind]}
              </span>
              <span className="spell-picker-option-meta">
                {s.stacks} stack{s.stacks !== 1 ? 's' : ''}
              </span>
              {s.kind === 'burn' && (
                <span className="spell-picker-option-bonus">+3 HP</span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="spell-picker-cancel"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
