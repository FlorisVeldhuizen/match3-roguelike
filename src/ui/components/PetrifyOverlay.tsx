import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
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

const DUST_PER_CELL = 2
/** Let impact particles read on the gems before the stone wash covers them. */
const ACTIVE_WASH_DELAY_MS = 140

function readPetrifyFromStore(): { pending: Set<number>; active: Map<number, Active> } {
  const s = useGameStore.getState()
  const nextPending = new Set<number>()
  for (const e of s.fight.enemies) {
    if (e.hp <= 0) continue
    if (e.currentIntent.kind === 'petrify-row') {
      if ((s.board.petrifiedRows[e.currentIntent.row] ?? 0) === 0) {
        nextPending.add(e.currentIntent.row)
      }
    }
  }
  const nextActive = new Map<number, Active>()
  for (const [rowStr, remaining] of Object.entries(s.board.petrifiedRows)) {
    if (remaining > 0) {
      nextActive.set(Number(rowStr), { row: Number(rowStr), remaining })
    }
  }
  return { pending: nextPending, active: nextActive }
}

export function PetrifyOverlay() {
  const [pending, setPending] = useState(() => readPetrifyFromStore().pending)
  const [active, setActive] = useState(() => readPetrifyFromStore().active)
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
    const { pending: nextPending, active: nextActive } = readPetrifyFromStore()
    setPending(nextPending)
    setActive(nextActive)
  }, [])

  const wipeAll = useCallback(() => {
    pendingFireRef.current = null
    setPending(new Set())
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
    const finishPetrifyRow = (pending: NonNullable<typeof pendingFireRef.current>) => {
      const { row, duration, fightCounter } = pending
      pendingFireRef.current = null
      setPending((prev) => {
        if (!prev.has(row)) return prev
        const next = new Set(prev)
        next.delete(row)
        return next
      })
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
      if (trail.verb !== 'petrify') return
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
        if (live.landed.size >= live.cellCount || isBurstEnd) finishPetrifyRow(live)
      }, trail.arrivalMs)
    })
    const unsub = subscribeGameEvents((event) => {
      if (event.kind === 'petrify-placed') {
        setPending((prev) => {
          if (prev.has(event.row)) return prev
          const next = new Set(prev)
          next.add(event.row)
          return next
        })
      } else if (event.kind === 'petrify-fired') {
        const boardW = useGameStore.getState().board.cells[0]?.length ?? 0
        pendingFireRef.current = {
          row: event.row,
          duration: event.duration,
          fightCounter: useGameStore.getState().fightCounter,
          cellCount: boardW,
          landed: new Set(),
        }
      } else if (event.kind === 'petrify-row-ticked') {
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
  }, [impacts.spawn, seedFromStore])

  const pendingCells: { x: number; y: number; key: string }[] = []
  for (const y of pending) {
    for (let x = 0; x < w; x++) {
      pendingCells.push({ x, y, key: `petrify-pending-${y}-${x}` })
    }
  }
  const activeCells: {
    x: number
    y: number
    key: string
    mode: 'active' | 'weakening' | 'expiring'
  }[] = []
  for (const [y, a] of active) {
    const mode = a.expiring ? 'expiring' : a.remaining === 1 ? 'weakening' : 'active'
    for (let x = 0; x < w; x++) {
      activeCells.push({ x, y, key: `petrify-${y}-${x}`, mode })
    }
  }

  return (
    <div className="petrify-overlay" aria-hidden>
      {pendingCells.map(({ x, y, key }) => (
        <CellAnchor key={key} x={x} y={y} className="petrify-cell is-pending" />
      ))}
      {activeCells.map(({ x, y, key, mode }) => (
        <PetrifyActiveCell key={key} x={x} y={y} mode={mode} />
      ))}
      <div className="petrify-impact-layer" aria-hidden>
        {impacts.items.map((hit) => (
          <CellAnchor
            key={`petrify-impact-${hit.id}`}
            x={hit.x}
            y={hit.y}
            className="board-cell-impact"
          >
            <BoardCellImpact variant="stone" />
          </CellAnchor>
        ))}
      </div>
    </div>
  )
}

type TrembleConfig = {
  duration: number
  delay: number
}

function randomTrembleConfig(): TrembleConfig {
  return {
    duration: 0.5 + Math.random() * 0.35,
    delay: -Math.random() * 0.7,
  }
}

function PetrifyActiveCell({
  x,
  y,
  mode,
}: {
  x: number
  y: number
  mode: 'active' | 'weakening' | 'expiring'
}) {
  const [cfg] = useState(randomTrembleConfig)
  const className = [
    'petrify-cell',
    mode === 'weakening' && 'is-weakening',
    mode === 'expiring' && 'is-expiring',
  ]
    .filter(Boolean)
    .join(' ')
  const trembleStyle: CSSProperties | undefined =
    mode === 'weakening'
      ? ({
          '--tremble-dur': `${cfg.duration.toFixed(2)}s`,
          '--tremble-delay': `${cfg.delay.toFixed(2)}s`,
        } as CSSProperties)
      : undefined

  return (
    <>
      <CellAnchor x={x} y={y} className={className} style={trembleStyle} />
      {mode === 'weakening' ? (
        <CellAnchor x={x} y={y} className="petrify-dust-layer">
          {Array.from({ length: DUST_PER_CELL }).map((_, i) => (
            <PetrifyDust key={i} />
          ))}
        </CellAnchor>
      ) : null}
    </>
  )
}

type DustConfig = {
  left: number
  delay: number
  duration: number
}

function randomDustLeft(): number {
  return 5 + Math.random() * 90
}

function randomDustConfig(): DustConfig {
  return {
    left: randomDustLeft(),
    delay: -Math.random() * 1.8,
    duration: 1.3 + Math.random() * 0.9,
  }
}

function PetrifyDust() {
  const ref = useRef<HTMLSpanElement>(null)
  const [initial] = useState(randomDustConfig)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onIter = () => {
      el.style.left = `${randomDustLeft().toFixed(2)}%`
    }
    el.addEventListener('animationiteration', onIter)
    return () => el.removeEventListener('animationiteration', onIter)
  }, [])

  return (
    <span
      ref={ref}
      className="petrify-dust"
      style={{
        left: `${initial.left.toFixed(2)}%`,
        animationDelay: `${initial.delay.toFixed(2)}s`,
        animationDuration: `${initial.duration.toFixed(2)}s`,
      }}
    />
  )
}
