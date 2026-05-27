import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { scheduleAfterMs } from '../../timing'
import { subscribeTrailScheduled } from '../../trails/sync'
import { useFightReset } from '../hooks/useFightReset'
import { CellAnchor } from './CellAnchor'

type Active = { row: number; remaining: number }

const DUST_PER_CELL = 2

export function PetrifyOverlay() {
  const [pending, setPending] = useState<Set<number>>(new Set())
  const [active, setActive] = useState<Map<number, Active>>(new Map())
  const w = useGameStore(
    (s) => s.board.cells[0]?.length ?? 0,
  )
  const pendingFireRef = useRef<{
    row: number
    duration: number
    fightCounter: number
  } | null>(null)

  const seedFromStore = useCallback(() => {
    const s = useGameStore.getState()
    const nextPending = new Set<number>()
    for (const e of s.fight.enemies) {
      if (e.hp <= 0) continue
      if (e.currentIntent.kind === 'petrify-row') {
        // Active visual takes precedence over pending
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
    setPending(nextPending)
    setActive(nextActive)
  }, [])

  useLayoutEffect(() => {
    seedFromStore()
  }, [seedFromStore])

  useFightReset(
    useCallback(() => {
      setPending(new Set())
      setActive(new Map())
      seedFromStore()
    }, [seedFromStore]),
  )

  useEffect(() => {
    const unsubTrail = subscribeTrailScheduled((trail) => {
      if (trail.verb !== 'petrify') return
      const pending = pendingFireRef.current
      if (!pending) return
      scheduleAfterMs(() => {
        if (useGameStore.getState().fightCounter !== pending.fightCounter) return
        pendingFireRef.current = null
        const row = pending.row
        setPending((prev) => {
          if (!prev.has(row)) return prev
          const next = new Set(prev)
          next.delete(row)
          return next
        })
        setActive((prev) => {
          const next = new Map(prev)
          next.set(row, { row, remaining: pending.duration })
          return next
        })
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
        pendingFireRef.current = {
          row: event.row,
          duration: event.duration,
          fightCounter: useGameStore.getState().fightCounter,
        }
      } else if (event.kind === 'petrify-row-ticked') {
        if (event.remaining > 0) {
          setActive((prev) => {
            const cur = prev.get(event.row)
            if (!cur || cur.remaining === event.remaining) return prev
            const next = new Map(prev)
            next.set(event.row, { row: event.row, remaining: event.remaining })
            return next
          })
        } else {
          setActive((prev) => {
            if (!prev.has(event.row)) return prev
            const next = new Map(prev)
            next.delete(event.row)
            return next
          })
        }
      }
    })
    return () => {
      unsubTrail()
      unsub()
    }
  }, [])

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
    isWeakening: boolean
  }[] = []
  for (const [y, a] of active) {
    const isWeakening = a.remaining === 1
    for (let x = 0; x < w; x++) {
      activeCells.push({ x, y, key: `petrify-${y}-${x}`, isWeakening })
    }
  }

  return (
    <div className="petrify-overlay" aria-hidden>
      {pendingCells.map(({ x, y, key }) => (
        <CellAnchor key={key} x={x} y={y} className="petrify-cell is-pending" />
      ))}
      {activeCells.map(({ x, y, key, isWeakening }) =>
        isWeakening ? (
          <WeakeningCell key={key} x={x} y={y} />
        ) : (
          <CellAnchor key={key} x={x} y={y} className="petrify-cell" />
        ),
      )}
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

function WeakeningCell({ x, y }: { x: number; y: number }) {
  const configRef = useRef<TrembleConfig | null>(null)
  if (configRef.current === null) {
    configRef.current = randomTrembleConfig()
  }
  const cfg = configRef.current
  return (
    <>
      <CellAnchor
        x={x}
        y={y}
        className="petrify-cell is-weakening"
        style={
          {
            '--tremble-dur': `${cfg.duration.toFixed(2)}s`,
            '--tremble-delay': `${cfg.delay.toFixed(2)}s`,
          } as CSSProperties
        }
      />
      {/* Sibling (not child) to avoid inheriting the tremble transform */}
      <CellAnchor x={x} y={y} className="petrify-dust-layer">
        {Array.from({ length: DUST_PER_CELL }).map((_, i) => (
          <PetrifyDust key={i} />
        ))}
      </CellAnchor>
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
  const configRef = useRef<DustConfig | null>(null)
  if (configRef.current === null) {
    configRef.current = randomDustConfig()
  }
  const initial = configRef.current

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
