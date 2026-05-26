import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { useFightReset } from '../hooks/useFightReset'
import { BOARD_HEIGHT } from '../../types'
import { CellAnchor } from './CellAnchor'

const keyOf = (owner: string, column: number) => `${owner}|${column}`

export function ColumnSmashOverlay() {
  const [threats, setThreats] = useState<Map<string, { owner: string; column: number }>>(
    new Map(),
  )

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
