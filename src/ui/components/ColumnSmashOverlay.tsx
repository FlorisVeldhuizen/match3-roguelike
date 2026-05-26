import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { useFightReset } from '../hooks/useFightReset'
import { BOARD_HEIGHT } from '../../types'
import { CellAnchor } from './CellAnchor'

// Threat visualization for Brute's column-smash telegraph. Event-driven
// (not store-derived) so the overlay's visibility tracks the animator's
// playback timeline rather than the synchronous store commit:
//
//   - column-smash-placed:    add (owner, column) — the threat now
//                             covers the entire column until fire.
//   - column-smash-resolved:  drop the owner's threat in lockstep with
//                             the smash visual (resolved is queued
//                             immediately before gems-cleared in the
//                             animator).
//   - enemy-killed:           drop the owner's threat — Brute died
//                             between telegraph and fire.
//   - fight reset:            seed from store (current enemies whose
//                             intent is column-smash).
//
// Threats are column-bound, not gem-bound: matching gems inside the
// column or swapping new ones in does not reduce the threat — the
// entire column gets smashed at fire time.

const keyOf = (owner: string, column: number) => `${owner}|${column}`

export function ColumnSmashOverlay() {
  const [threats, setThreats] = useState<Map<string, { owner: string; column: number }>>(
    new Map(),
  )

  // Seed from the store on first mount and on every fight reset. Until
  // the player's first interaction there are no events to drive the
  // overlay, so without this seed a saved game with an active smash
  // telegraph would render blank.
  const seedFromStore = useCallback(() => {
    const enemies = useGameStore.getState().fight.enemies
    const next = new Map<string, { owner: string; column: number }>()
    for (const e of enemies) {
      if (e.hp > 0 && e.currentIntent.kind === 'column-smash') {
        next.set(keyOf(e.id, e.currentIntent.column), {
          owner: e.id,
          column: e.currentIntent.column,
        })
      }
    }
    setThreats(next)
  }, [])

  useLayoutEffect(() => {
    seedFromStore()
  }, [seedFromStore])

  useFightReset(
    useCallback(() => {
      setThreats(new Map())
      seedFromStore()
    }, [seedFromStore]),
  )

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'column-smash-placed') {
        setThreats((prev) => {
          const k = keyOf(event.enemyId, event.column)
          if (prev.has(k)) return prev
          const next = new Map(prev)
          next.set(k, { owner: event.enemyId, column: event.column })
          return next
        })
      } else if (event.kind === 'column-smash-resolved') {
        // Smash is firing NOW — drop the threat in lockstep with the
        // gems-cleared burst (column-smash-resolved is queued
        // immediately before gems-cleared in the animator).
        const ownerId = event.enemyId
        setThreats((prev) => {
          let changed = false
          const next = new Map(prev)
          for (const [k, t] of prev) {
            if (t.owner === ownerId) {
              next.delete(k)
              changed = true
            }
          }
          return changed ? next : prev
        })
      } else if (event.kind === 'enemy-killed') {
        // Brute died between telegraph and fire — drop its threat.
        const ownerId = event.enemyId
        setThreats((prev) => {
          let changed = false
          const next = new Map(prev)
          for (const [k, t] of prev) {
            if (t.owner === ownerId) {
              next.delete(k)
              changed = true
            }
          }
          return changed ? next : prev
        })
      }
    })
  }, [])

  return (
    <div className="column-smash-overlay" aria-hidden>
      {Array.from(threats.values()).flatMap(({ owner, column }) =>
        Array.from({ length: BOARD_HEIGHT }, (_, y) => (
          <CellAnchor
            key={`${owner}|${column}|${y}`}
            x={column}
            y={y}
            className="column-smash-cell"
          />
        )),
      )}
      {Array.from(threats.values()).map(({ owner, column }) => (
        <span
          key={`smash-chevron-${owner}-${column}`}
          className="column-smash-chevron"
          style={{ left: `${(column + 0.5) * 12.5}%` }}
        >
          ▼
        </span>
      ))}
    </div>
  )
}
