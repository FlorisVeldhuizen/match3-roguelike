import { useCallback, useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { BOARD_EFFECT_FIZZLE_MS, scheduleAfterMs } from '../../timing'
import { useBoardWipe } from '../hooks/useBoardWipe'
import { useFightReset } from '../hooks/useFightReset'
import { useTransientCellFx } from '../hooks/useTransientCellFx'
import { BOARD_HEIGHT } from '../../types'
import { BOARD_CELL_IMPACT_MS, BoardCellImpact } from './BoardCellImpact'
import { CellAnchor } from './CellAnchor'

const keyOf = (owner: string, column: number) => `${owner}|${column}`

type Threat = { owner: string; column: number; expiring?: boolean }

function readThreatsFromStore(): Map<string, Threat> {
  const enemies = useGameStore.getState().fight.enemies
  const next = new Map<string, Threat>()
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

  const wipeAll = useCallback(() => {
    setThreats(new Map())
    impacts.clear()
  }, [impacts])

  useFightReset(
    useCallback(() => {
      wipeAll()
      seedFromStore()
    }, [wipeAll, seedFromStore]),
  )

  useBoardWipe(wipeAll)

  useEffect(() => {
    const markOwnerExpiring = (ownerId: string) => {
      const fightCounter = useGameStore.getState().fightCounter
      setThreats((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const [k, t] of prev) {
          if (t.owner === ownerId && !t.expiring) {
            next.set(k, { ...t, expiring: true })
            changed = true
          }
        }
        return changed ? next : prev
      })
      scheduleAfterMs(() => {
        if (useGameStore.getState().fightCounter !== fightCounter) return
        setThreats((prev) => {
          let changed = false
          const next = new Map(prev)
          for (const [k, t] of prev) {
            if (t.owner === ownerId && t.expiring) {
              next.delete(k)
              changed = true
            }
          }
          return changed ? next : prev
        })
      }, BOARD_EFFECT_FIZZLE_MS)
    }

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
        markOwnerExpiring(event.enemyId)
      } else if (event.kind === 'enemy-killed') {
        markOwnerExpiring(event.enemyId)
      }
    })
  }, [impacts])

  return (
    <div className="column-smash-overlay" aria-hidden>
      {Array.from(threats.values()).flatMap(({ owner, column, expiring }) =>
        Array.from({ length: BOARD_HEIGHT }, (_, y) => (
          <CellAnchor
            key={`${owner}|${column}|${y}`}
            x={column}
            y={y}
            className={`column-smash-cell${expiring ? ' is-expiring' : ''}`}
          />
        )),
      )}
      {Array.from(threats.values()).map(({ owner, column, expiring }) => (
        <span
          key={`smash-chevron-${owner}-${column}`}
          className={`column-smash-chevron${expiring ? ' is-expiring' : ''}`}
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
