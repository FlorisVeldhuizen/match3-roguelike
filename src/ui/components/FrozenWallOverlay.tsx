import { useCallback, useEffect, useRef, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { BOARD_EFFECT_FIZZLE_MS, scheduleAfterMs } from '../../timing'
import { subscribeTrailScheduled } from '../../trails/sync'
import { useBoardWipe } from '../hooks/useBoardWipe'
import { useFightReset } from '../hooks/useFightReset'
import { useTransientCellFx } from '../hooks/useTransientCellFx'
import { BOARD_CELL_IMPACT_MS, BoardCellImpact } from './BoardCellImpact'
import { CellAnchor } from './CellAnchor'

type Active = { row: number; remaining: number; expiring?: boolean }

const ACTIVE_WASH_DELAY_MS = 140

function readWardedFromStore(): Map<number, Active> {
  const next = new Map<number, Active>()
  for (const [rowStr, remaining] of Object.entries(useGameStore.getState().board.wardedRows)) {
    if (remaining > 0) {
      next.set(Number(rowStr), { row: Number(rowStr), remaining })
    }
  }
  return next
}

export function FrozenWallOverlay() {
  const [active, setActive] = useState(readWardedFromStore)
  const w = useGameStore((s) => s.board.cells[0]?.length ?? 0)
  const pendingFireRef = useRef<{
    row: number
    duration: number
    fightCounter: number
    cellCount: number
    landed: Set<string>
  } | null>(null)
  const impacts = useTransientCellFx(BOARD_CELL_IMPACT_MS)
  const impactsSpawnRef = useRef(impacts.spawn)
  useEffect(() => {
    impactsSpawnRef.current = impacts.spawn
  })

  const seedFromStore = useCallback(() => {
    setActive(readWardedFromStore())
  }, [])

  const wipeAll = useCallback(() => {
    pendingFireRef.current = null
    setActive(new Map())
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
    const finishFrozenRow = (pending: NonNullable<typeof pendingFireRef.current>) => {
      const { row, duration, fightCounter } = pending
      pendingFireRef.current = null
      scheduleAfterMs(() => {
        if (useGameStore.getState().fightCounter !== fightCounter) return
        setActive((prev) => {
          const next = new Map(prev)
          next.set(row, { row, remaining: duration })
          return next
        })
      }, ACTIVE_WASH_DELAY_MS)
    }

    const unsubTrail = subscribeTrailScheduled((trail) => {
      if (trail.verb !== 'frozen-wall') return
      const pending = pendingFireRef.current
      if (!pending || !trail.at) return
      const at = trail.at
      if (at.y !== pending.row) return
      const isBurstEnd = trail.verbBurstEnd === true
      scheduleAfterMs(() => {
        const live = pendingFireRef.current
        if (!live || useGameStore.getState().fightCounter !== live.fightCounter) return
        impactsSpawnRef.current([at])
        live.landed.add(`${at.x},${at.y}`)
        if (live.landed.size >= live.cellCount || isBurstEnd) finishFrozenRow(live)
      }, trail.arrivalMs)
    })
    const unsub = subscribeGameEvents((event) => {
      if (event.kind === 'frozen-wall-fired') {
        const boardW = useGameStore.getState().board.cells[0]?.length ?? 0
        pendingFireRef.current = {
          row: event.row,
          duration: event.duration,
          fightCounter: useGameStore.getState().fightCounter,
          cellCount: boardW,
          landed: new Set(),
        }
      } else if (event.kind === 'frozen-wall-ticked') {
        if (event.remaining > 0) {
          setActive((prev) => {
            const cur = prev.get(event.row)
            if (!cur || cur.expiring || cur.remaining === event.remaining) return prev
            const next = new Map(prev)
            next.set(event.row, { row: event.row, remaining: event.remaining })
            return next
          })
        } else {
          const fightCounter = useGameStore.getState().fightCounter
          setActive((prev) => {
            if (!prev.has(event.row)) return prev
            const next = new Map(prev)
            next.set(event.row, { row: event.row, remaining: 0, expiring: true })
            return next
          })
          scheduleAfterMs(() => {
            if (useGameStore.getState().fightCounter !== fightCounter) return
            setActive((prev) => {
              const cur = prev.get(event.row)
              if (!cur?.expiring) return prev
              const next = new Map(prev)
              next.delete(event.row)
              return next
            })
          }, BOARD_EFFECT_FIZZLE_MS)
        }
      }
    })
    return () => {
      unsubTrail()
      unsub()
    }
  }, [impacts.spawn])

  const activeCells: {
    x: number
    y: number
    key: string
    className: string
  }[] = []
  for (const [y, a] of active) {
    const className = a.expiring
      ? 'frozen-wall-cell is-expiring'
      : a.remaining === 1
        ? 'frozen-wall-cell is-weakening'
        : 'frozen-wall-cell'
    for (let x = 0; x < w; x++) {
      activeCells.push({ x, y, key: `frozen-wall-${y}-${x}`, className })
    }
  }

  return (
    <div className="frozen-wall-overlay" aria-hidden>
      {activeCells.map(({ x, y, key, className }) => (
        <CellAnchor key={key} x={x} y={y} className={className} />
      ))}
      <div className="frozen-wall-impact-layer" aria-hidden>
        {impacts.items.map((hit) => (
          <CellAnchor
            key={`frozen-wall-impact-${hit.id}`}
            x={hit.x}
            y={hit.y}
            className="board-cell-impact"
          >
            <BoardCellImpact variant="ice" />
          </CellAnchor>
        ))}
      </div>
    </div>
  )
}
