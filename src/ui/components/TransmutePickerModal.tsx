import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { playBoardSpellEvents } from '../../core/board/spellPlayback'
import type { GemColor } from '../../types'

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
  yellow: 'Yellow',
}

export function TransmutePickerModal({ onClose }: { onClose: () => void }) {
  const castTransmute = useGameStore((s) => s.castTransmute)
  const board = useGameStore((s) => s.board.cells)
  const [from, setFrom] = useState<GemColor | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const colorOnBoard = (c: GemColor): boolean =>
    board.some((row) => row.some((cell) => cell.gemColor === c))

  const confirm = (to: GemColor) => {
    if (!from || from === to) return
    const res = castTransmute(from, to)
    if (res.ok) void playBoardSpellEvents(res.events)
    onClose()
  }

  return (
    <div
      className="spell-picker-overlay"
      role="dialog"
      aria-label="Transmute gem colors"
      onClick={onClose}
    >
      <div className="spell-picker-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="spell-picker-title">Transmute</h2>
        <p className="spell-picker-sub">
          {from
            ? `Change all ${COLOUR_LABELS[from as typeof COLOURS[number]]} gems into…`
            : 'Pick the color to change on the board.'}
        </p>
        <div className="spell-picker-focus-grid">
          {COLOURS.map((c) => {
            const isSource = from === c
            const phase: 'from' | 'to' = from == null ? 'from' : 'to'
            const enabled =
              phase === 'from' ? colorOnBoard(c) : !isSource
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
