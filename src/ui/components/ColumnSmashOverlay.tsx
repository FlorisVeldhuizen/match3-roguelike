import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { useFightReset } from '../hooks/useFightReset'
import { CellAnchor } from './CellAnchor'

// Threat visualization for Brute's column-smash telegraph. Event-driven
// (not store-derived) so the overlay's visibility tracks the animator's
// playback timeline rather than the synchronous store commit:
//
//   - column-smash-placed:    add cells to the overlay (telegraph arrives
//                             into view in lockstep with any FX layer
//                             the AC plays for it).
//   - column-smash-resolved:  drop cells owned by the source enemy
//                             EXACTLY when the smash visual plays —
//                             the red threat wash transitions into the
//                             gems-cleared burst with no "normal blink"
//                             frame in between.
//   - gems-cleared:           drop any tracked cells whose (x,y) was
//                             cleared by the player (matching a flagged
//                             gem clears the flag with the gem).
//   - fight reset:            seed from store + reset local state.
//
// The pendingSmash flag is gem-bound and stored on Cell.flags as the
// source enemy id (string). We mirror the live flag state into a Map
// keyed by `${x},${y}` so per-cell dedupe + removal is O(1).

type Threat = { x: number; y: number; owner: string }
const keyOf = (x: number, y: number) => `${x},${y}`

export function ColumnSmashOverlay() {
  const [threats, setThreats] = useState<Map<string, Threat>>(new Map())

  // Seed from the store on first mount and on every fight reset. Until
  // the player's first interaction there are no events to drive the
  // overlay, so without this seed a saved game with an active smash
  // telegraph would render blank.
  const seedFromStore = useCallback(() => {
    const cells = useGameStore.getState().board.cells
    const next = new Map<string, Threat>()
    for (let y = 0; y < cells.length; y++) {
      const row = cells[y]
      if (!row) continue
      for (let x = 0; x < row.length; x++) {
        const owner = row[x]?.flags?.pendingSmash
        if (owner !== undefined) {
          next.set(keyOf(x, y), { x, y, owner })
        }
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
        const ownerId = event.enemyId
        setThreats((prev) => {
          const next = new Map(prev)
          for (const c of event.cells) {
            next.set(keyOf(c.x, c.y), { x: c.x, y: c.y, owner: ownerId })
          }
          return next
        })
      } else if (event.kind === 'column-smash-resolved') {
        // Smash is firing NOW — drop the threat cells in lockstep with
        // the gems-cleared burst (column-smash-resolved is queued
        // immediately before gems-cleared in the animator).
        const ownerId = event.enemyId
        setThreats((prev) => {
          let changed = false
          const next = new Map(prev)
          for (const [, t] of prev) {
            if (t.owner === ownerId) {
              next.delete(keyOf(t.x, t.y))
              changed = true
            }
          }
          return changed ? next : prev
        })
      } else if (event.kind === 'gems-cleared') {
        // Player matched a flagged gem (the flag goes with the gem
        // under gravity). Drop only the cleared positions we were
        // tracking — non-tracked cells in event.cells are normal
        // match clears and don't affect us.
        setThreats((prev) => {
          let changed = false
          const next = new Map(prev)
          for (const c of event.cells) {
            const k = keyOf(c.x, c.y)
            if (next.has(k)) {
              next.delete(k)
              changed = true
            }
          }
          return changed ? next : prev
        })
      }
    })
  }, [])

  // Distinct columns with at least one active threat. Used to render
  // one chevron per column rather than per cell.
  const threatColumns = new Set<number>()
  for (const t of threats.values()) threatColumns.add(t.x)

  return (
    <div className="column-smash-overlay" aria-hidden>
      {Array.from(threats.values()).map(({ x, y }) => (
        <CellAnchor
          key={keyOf(x, y)}
          x={x}
          y={y}
          className="column-smash-cell"
        />
      ))}
      {Array.from(threatColumns).map((col) => (
        <span
          key={`smash-chevron-${col}`}
          className="column-smash-chevron"
          style={{ left: `${(col + 0.5) * 12.5}%` }}
        >
          ▼
        </span>
      ))}
    </div>
  )
}
