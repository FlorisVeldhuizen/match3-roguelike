import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { playBoardSpellEvents } from '../../core/board/spellPlayback'

const VOLLEY_HITS = 3

export function VolleyTargetModal({ onClose }: { onClose: () => void }) {
  const enemies = useGameStore((s) => s.fight.enemies)
  const castVolley = useGameStore((s) => s.castVolley)
  const [allocation, setAllocation] = useState<string[]>([])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const living = enemies.filter((e) => e.hp > 0)
  useEffect(() => {
    if (living.length === 0) onClose()
  }, [living.length, onClose])

  const addHit = (id: string) => {
    setAllocation((prev) => {
      if (prev.length >= VOLLEY_HITS) return prev
      return [...prev, id]
    })
  }

  const undo = () => {
    setAllocation((prev) => prev.slice(0, -1))
  }

  const confirm = () => {
    if (allocation.length !== VOLLEY_HITS) return
    const res = castVolley(allocation)
    if (res.ok) void playBoardSpellEvents(res.events)
    onClose()
  }

  const remaining = VOLLEY_HITS - allocation.length

  return (
    <div
      className="spell-picker-overlay"
      role="dialog"
      aria-label="Distribute Volley hits"
      onClick={onClose}
    >
      <div className="spell-picker-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="spell-picker-title">Volley</h2>
        <p className="spell-picker-sub">
          {remaining > 0
            ? `Click a target to assign a hit. ${remaining} left.`
            : `All three hits assigned. Confirm to cast.`}
        </p>
        <div className="spell-picker-volley-grid">
          {living.map((e) => {
            const count = allocation.filter((id) => id === e.id).length
            return (
              <button
                key={e.id}
                type="button"
                className={`spell-picker-volley-slot${count > 0 ? ' has-hits' : ''}`}
                aria-disabled={remaining <= 0}
                onClick={() => addHit(e.id)}
              >
                <span className="spell-picker-volley-name">{e.name}</span>
                <span className="spell-picker-volley-hp">
                  {e.hp}/{e.maxHp}
                </span>
                <span className="spell-picker-volley-hits">
                  {count > 0 ? `${count} hit${count > 1 ? 's' : ''}` : '—'}
                </span>
              </button>
            )
          })}
        </div>
        <div className="spell-picker-actions">
          {allocation.length > 0 && (
            <button
              type="button"
              className="spell-picker-back"
              onClick={undo}
            >
              Undo
            </button>
          )}
          <button
            type="button"
            className="spell-picker-confirm"
            aria-disabled={allocation.length !== VOLLEY_HITS}
            disabled={allocation.length !== VOLLEY_HITS}
            onClick={confirm}
          >
            Cast
          </button>
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
