import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { BOARD_EFFECT_FIZZLE_MS, scheduleAfterMs } from '../../timing'
import { subscribeTrailScheduled } from '../../trails/sync'
import { useBoardWipe } from '../hooks/useBoardWipe'
import { useFightReset } from '../hooks/useFightReset'
import { useTransientCellFx } from '../hooks/useTransientCellFx'
import { BOARD_HEIGHT, BOARD_WIDTH } from '../../types'
import type { GemColor, Pos } from '../../types'
import { BOARD_CELL_IMPACT_MS, BoardCellImpact } from './BoardCellImpact'
import { CellAnchor } from './CellAnchor'

type DrainState = { turnsLeft: number; expiring: boolean }

const cellKey = (x: number, y: number) => `${x},${y}`

function readDrainStatesFromStore(): Map<GemColor, DrainState> {
  const s = useGameStore.getState()
  const next = new Map<GemColor, DrainState>()
  for (const d of s.fight.drainedColors ?? []) {
    const cur = next.get(d.color)
    const turnsLeft = cur ? Math.max(cur.turnsLeft, d.turnsLeft) : d.turnsLeft
    next.set(d.color, { turnsLeft, expiring: false })
  }
  return next
}

function cellsOfColor(color: GemColor): Pos[] {
  const board = useGameStore.getState().board.cells
  const hitCells: Pos[] = []
  for (let y = 0; y < board.length; y++) {
    const row = board[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      if (row[x]?.gemColor === color) hitCells.push({ x, y })
    }
  }
  return hitCells
}

export function ColorDrainOverlay() {
  const [drainStates, setDrainStates] = useState(readDrainStatesFromStore)
  const [applyReveal, setApplyReveal] = useState<Set<string>>(() => new Set())
  const pendingDrainRef = useRef<{
    color: GemColor
    turnsLeft: number
    fightCounter: number
    cells: Pos[]
    landed: Set<string>
  } | null>(null)
  const cells = useGameStore((s) => s.board.cells)
  const impacts = useTransientCellFx(BOARD_CELL_IMPACT_MS)

  const seedFromStore = useCallback(() => {
    setDrainStates(readDrainStatesFromStore())
  }, [])

  const wipeAll = useCallback(() => {
    pendingDrainRef.current = null
    setDrainStates(new Map())
    setApplyReveal(new Set())
    impacts.clear()
  }, [impacts])

  useFightReset(
    useCallback(() => {
      wipeAll()
      seedFromStore()
    }, [wipeAll, seedFromStore]),
  )

  useBoardWipe(wipeAll)

  const commitDrainApply = useCallback(
    (pending: NonNullable<typeof pendingDrainRef.current>) => {
      setDrainStates((prev) => {
        const next = new Map(prev)
        next.set(pending.color, {
          turnsLeft: pending.turnsLeft,
          expiring: false,
        })
        return next
      })
      setApplyReveal(new Set())
      pendingDrainRef.current = null
    },
    [],
  )

  useEffect(() => {
    const unsubTrail = subscribeTrailScheduled((trail) => {
      if (trail.verb !== 'color-drain') return
      const pending = pendingDrainRef.current
      if (!pending || !trail.at) return
      const at = trail.at
      const key = cellKey(at.x, at.y)
      if (!pending.cells.some((c) => c.x === at.x && c.y === at.y)) return
      const isBurstEnd = trail.verbBurstEnd === true
      scheduleAfterMs(() => {
        const live = pendingDrainRef.current
        if (!live || useGameStore.getState().fightCounter !== live.fightCounter) return
        impacts.spawn([at])
        setApplyReveal((prev) => {
          const next = new Set(prev)
          next.add(key)
          return next
        })
        live.landed.add(key)
        if (live.landed.size >= live.cells.length || isBurstEnd) commitDrainApply(live)
      }, trail.arrivalMs)
    })
    const unsub = subscribeGameEvents((event) => {
      if (event.kind === 'color-drain-fired') {
        const hitCells = cellsOfColor(event.color)
        pendingDrainRef.current = {
          color: event.color,
          turnsLeft: event.turnsLeft,
          fightCounter: useGameStore.getState().fightCounter,
          cells: hitCells,
          landed: new Set(),
        }
      } else if (event.kind === 'color-drain-ticked') {
        const color = event.color
        const remaining = event.remaining
        if (remaining > 0) {
          setDrainStates((prev) => {
            const cur = prev.get(color)
            if (!cur || cur.expiring || cur.turnsLeft === remaining) return prev
            const next = new Map(prev)
            next.set(color, { turnsLeft: remaining, expiring: false })
            return next
          })
        } else {
          const scheduledFight = useGameStore.getState().fightCounter
          setDrainStates((prev) => {
            if (!prev.has(color)) return prev
            const next = new Map(prev)
            next.set(color, { turnsLeft: 0, expiring: true })
            return next
          })
          scheduleAfterMs(() => {
            if (useGameStore.getState().fightCounter !== scheduledFight) return
            setDrainStates((prev) => {
              if (!prev.has(color)) return prev
              const cur = prev.get(color)
              if (!cur?.expiring) return prev
              const next = new Map(prev)
              next.delete(color)
              return next
            })
          }, BOARD_EFFECT_FIZZLE_MS)
        }
      } else if (event.kind === 'drain-triggered' && event.cells.length > 0) {
        impacts.spawn(event.cells)
      }
    })
    return () => {
      unsubTrail()
      unsub()
    }
  }, [impacts, commitDrainApply])

  if (drainStates.size === 0 && applyReveal.size === 0) return null

  const anchors: ReactNode[] = []
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    const row = cells[y]
    if (!row) continue
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const cell = row[x]
      if (!cell) continue
      const state = drainStates.get(cell.gemColor)
      const revealing = applyReveal.has(cellKey(x, y))
      if (!state && !revealing) continue
      const cls = state?.expiring
        ? 'color-drain-cell active is-expiring'
        : state && state.turnsLeft <= 1
          ? 'color-drain-cell active is-weakening'
          : 'color-drain-cell active'
      anchors.push(<CellAnchor key={`drain-${x}-${y}`} x={x} y={y} className={cls} />)
    }
  }

  return (
    <div className="color-drain-overlay" aria-hidden>
      {anchors}
      {impacts.items.map((hit) => (
        <CellAnchor
          key={`drain-impact-${hit.id}`}
          x={hit.x}
          y={hit.y}
          className="board-cell-impact"
        >
          <BoardCellImpact variant="drain" />
        </CellAnchor>
      ))}
    </div>
  )
}
