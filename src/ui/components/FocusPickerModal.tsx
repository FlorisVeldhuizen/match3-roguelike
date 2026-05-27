import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { FOCUS_TRANSFER } from '../../core/combat/spellResolvers'
import { MANA_CAPS, type GemColor } from '../../types'
import { playBoardSpellEvents } from '../state/boardSpellPlayback'

const COLOURS: ReadonlyArray<'red' | 'blue' | 'green' | 'yellow'> = [
  'red',
  'blue',
  'green',
  'yellow',
]

const COLOUR_LABELS: Record<'red' | 'blue' | 'green' | 'yellow', string> = {
  red: 'Red',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Wild',
}

export function FocusPickerModal({ onClose }: { onClose: () => void }) {
  const mana = useGameStore((s) => s.fight.player.mana)
  const castFocus = useGameStore((s) => s.castFocus)
  const [from, setFrom] = useState<GemColor | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const confirm = (to: GemColor) => {
    if (!from || from === to) return
    const res = castFocus(from, to)
    if (res.ok) void playBoardSpellEvents(res.events)
    onClose()
  }

  return (
    <div
      className="spell-picker-overlay"
      role="dialog"
      aria-label="Focus mana conversion"
      onClick={onClose}
    >
      <div className="spell-picker-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="spell-picker-title">Focus</h2>
        <p className="spell-picker-sub">
          {from
            ? `Convert ${FOCUS_TRANSFER} ${COLOUR_LABELS[from as typeof COLOURS[number]]} into…`
            : `Pick the color to convert FROM.`}
        </p>
        <div className="spell-picker-focus-grid">
          {COLOURS.map((c) => {
            const have = mana[c]
            const cap = MANA_CAPS[c]
            const isSource = from === c
            const phase: 'from' | 'to' = from == null ? 'from' : 'to'
            const enabled =
              phase === 'from'
                ? have >= 1
                : !isSource && cap - have >= 1
            return (
              <button
                key={c}
                type="button"
                className={`spell-picker-focus-slot mana-${c}${isSource ? ' selected' : ''}${enabled ? '' : ' is-disabled'}`}
                aria-disabled={!enabled}
                onClick={() => {
                  if (!enabled) return
                  if (phase === 'from') setFrom(c)
                  else confirm(c)
                }}
              >
                <span className="spell-picker-focus-dot" data-color={c} aria-hidden />
                <span className="spell-picker-focus-label">{COLOUR_LABELS[c]}</span>
                <span className="spell-picker-focus-amount">
                  {have}
                  <span className="spell-picker-focus-cap">/{cap}</span>
                </span>
              </button>
            )
          })}
        </div>
        <div className="spell-picker-actions">
          {from != null && (
            <button
              type="button"
              className="spell-picker-back"
              onClick={() => setFrom(null)}
            >
              Back
            </button>
          )}
          <button
            type="button"
            className="spell-picker-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
