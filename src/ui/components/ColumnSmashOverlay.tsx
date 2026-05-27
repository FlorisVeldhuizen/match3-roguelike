import { useCallback, useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { useFightReset } from '../hooks/useFightReset'
import { useTransientCellFx } from '../hooks/useTransientCellFx'
import { BOARD_HEIGHT } from '../../types'
import { BOARD_CELL_IMPACT_MS, BoardCellImpact } from './BoardCellImpact'
import { CellAnchor } from './CellAnchor'

const keyOf = (owner: string, column: number) => `${owner}|${column}`

function readThreatsFromStore(): Map<string, { owner: string; column: number }> {
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
  return next
}

export function ColumnSmashOverlay() {
  const [threats, setThreats] = useState(readThreatsFromStore)
  const impacts = useTransientCellFx(BOARD_CELL_IMPACT_MS)

  const seedFromStore = useCallback(() => {
    setThreats(readThreatsFromStore())
  }, [])

  useFightReset(
    useCallback(() => {
      setThreats(new Map())
      impacts.clear()
      seedFromStore()
    }, [seedFromStore, impacts]),
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
        if (event.cells.length > 0) {
          impacts.spawn(event.cells.map((c) => ({ x: c.x, y: c.y })))
        }
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
  }, [impacts])

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
      {impacts.items.map((hit) => (
        <CellAnchor
          key={`smash-impact-${hit.id}`}
          x={hit.x}
          y={hit.y}
          className="board-cell-impact"
        >
          <BoardCellImpact variant="smash" />
        </CellAnchor>
      ))}
    </div>
  )
}
