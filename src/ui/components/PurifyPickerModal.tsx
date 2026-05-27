import { useEffect } from 'react'
import { useGameStore } from '../../core/state/store'
import type { StatusKind } from '../../types'
import { playBoardSpellEvents } from '../../core/board/spellPlayback'

const STATUS_LABELS: Record<StatusKind, string> = {
  burn: 'Burn',
  vulnerable: 'Vulnerable',
  weak: 'Weak',
  regen: 'Regenerate',
  strength: 'Strength',
}

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

  useEffect(() => {
    if (removable.length === 0) onClose()
  }, [removable.length, onClose])

  const pick = (kind: StatusKind) => {
    const res = castPurify(kind)
    if (res.ok) void playBoardSpellEvents(res.events)
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
