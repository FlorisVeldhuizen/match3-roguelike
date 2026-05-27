import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { BOARD_EFFECT_FIZZLE_MS, scheduleAfterMs } from '../../timing'
import { subscribeTrailScheduled } from '../../trails/sync'
import { useAnimatedCellPositions } from '../hooks/useAnimatedCellPositions'
import { useTransientCellFx } from '../hooks/useTransientCellFx'
import { useBoardWipe } from '../hooks/useBoardWipe'
import { useFightReset } from '../hooks/useFightReset'
import { useHoveredCellKey } from '../hooks/useHoveredCellKey'
import { removeAnchorsAt } from '../cellAnchors'
import { BOARD_CELL_IMPACT_MS, BoardCellImpact } from './BoardCellImpact'
import { CellAnchor } from './CellAnchor'
import type { Pos } from '../../types'

type FlameMeta = { remaining: number }

const BURST_MS = 720

const keyOf = (p: Pos) => `${p.x},${p.y}`

export function BurningOverlay() {
  const positions = useAnimatedCellPositions()
  const [meta, setMeta] = useState<Map<string, FlameMeta>>(new Map())
  const metaRef = useRef(meta)
  useEffect(() => {
    metaRef.current = meta
  }, [meta])
  const bursts = useTransientCellFx(BURST_MS)
  const fizzles = useTransientCellFx(BOARD_EFFECT_FIZZLE_MS)
  const impacts = useTransientCellFx(BOARD_CELL_IMPACT_MS)
  const hoveredKey = useHoveredCellKey()
  const flameIdRef = useRef(0)
  const pendingPlaceRef = useRef<{
    cells: Pos[]
    duration: number
    fightCounter: number
    landed: Set<string>
  } | null>(null)

  useLayoutEffect(() => {
    setMeta(seedMetaFromStore(positions.set, flameIdRef))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const wipeAll = useCallback(() => {
    positions.clear()
    setMeta(new Map())
    bursts.clear()
    fizzles.clear()
    impacts.clear()
  }, [positions, bursts, fizzles, impacts])

  useFightReset(
    useCallback(() => {
      wipeAll()
      setMeta(seedMetaFromStore(positions.set, flameIdRef))
    }, [wipeAll, positions]),
  )

  useBoardWipe(wipeAll)

  useEffect(() => {
    const unsubTrail = subscribeTrailScheduled((trail) => {
      if (trail.verb !== 'tile-burn') return
      const pending = pendingPlaceRef.current
      if (!pending || !trail.at) return
      const at = trail.at
      const key = keyOf(at)
      if (!pending.cells.some((c) => c.x === at.x && c.y === at.y)) return
      const isBurstEnd = trail.verbBurstEnd === true
      scheduleAfterMs(() => {
        const live = pendingPlaceRef.current
        if (!live || useGameStore.getState().fightCounter !== live.fightCounter) return
        const id = `flame-${++flameIdRef.current}`
        positions.set(id, at.x, at.y)
        impacts.spawn([at])
        setMeta((prev) => {
          const next = new Map(prev)
          next.set(id, { remaining: live.duration })
          return next
        })
        live.landed.add(key)
        if (live.landed.size >= live.cells.length || isBurstEnd) pendingPlaceRef.current = null
      }, trail.arrivalMs)
    })
    const unsub = subscribeGameEvents((event) => {
      if (event.kind === 'tile-burn-placed') {
        pendingPlaceRef.current = {
          cells: event.cells,
          duration: event.duration,
          fightCounter: useGameStore.getState().fightCounter,
          landed: new Set(),
        }
      } else if (event.kind === 'gems-cleared') {
        const removed = removeAnchorsAt(positions, event.cells)
        if (removed.length === 0) return
        fizzles.spawn(removed.map((r) => r.at))
        setMeta((prev) => {
          const next = new Map(prev)
          for (const r of removed) next.delete(r.id)
          return next
        })
      } else if (event.kind === 'tile-burn-triggered') {
        bursts.spawn(event.cells.map((c) => ({ x: c.x, y: c.y })))
        const removedIds: string[] = []
        for (const c of event.cells) {
          const id = positions.findIdAt(c.x, c.y)
          if (!id) continue
          positions.remove(id)
          removedIds.push(id)
        }
        if (removedIds.length > 0) {
          setMeta((prev) => {
            const next = new Map(prev)
            for (const id of removedIds) next.delete(id)
            return next
          })
        }
      } else if (event.kind === 'cell-flag-ticked' && event.flag === 'burning') {
        type Tick = { id: string; pos: Pos; remaining: number | 'expire' }
        const ticks: Tick[] = []
        const m = metaRef.current
        for (const p of event.positions) {
          const id = positions.findIdAt(p.x, p.y)
          if (!id) continue
          const cur = m.get(id)
          if (!cur) continue
          const r = cur.remaining - 1
          ticks.push({ id, pos: p, remaining: r <= 0 ? 'expire' : r })
        }
        if (ticks.length === 0) return
        const expired: Pos[] = []
        for (const t of ticks) {
          if (t.remaining === 'expire') {
            positions.remove(t.id)
            expired.push(t.pos)
          }
        }
        if (expired.length > 0) {
          fizzles.spawn(expired.map((p) => ({ x: p.x, y: p.y })))
        }
        setMeta((prev) => {
          const next = new Map(prev)
          for (const t of ticks) {
            if (t.remaining === 'expire') next.delete(t.id)
            else next.set(t.id, { remaining: t.remaining })
          }
          return next
        })
      }
    })
    return () => {
      unsubTrail()
      unsub()
    }
  }, [positions, bursts, fizzles, impacts])

  return (
    <div className="burning-overlay" aria-hidden>
      {Array.from(positions.positions.entries()).map(([id, p]) => {
        const m = meta.get(id)
        if (!m) return null
        const fizzling = m.remaining <= 1
        const scale = fizzling ? 0.85 : Math.min(1, 0.55 + 0.225 * m.remaining)
        const hovered = hoveredKey === keyOf({ x: p.x, y: p.y })
        return (
          <CellAnchor
            key={id}
            x={p.x}
            y={p.y}
            transition={p.transition}
            className={`burning-cell${fizzling ? ' is-fizzling' : ''}${hovered ? ' is-hovered' : ''}`}
            style={{ ['--flame-scale' as string]: scale.toFixed(3) }}
            data-remaining={m.remaining}
          >
            <span className="burning-flame">
              <FlameSvg />
            </span>
          </CellAnchor>
        )
      })}
      {bursts.items.map((b) => (
        <CellAnchor key={`burst-${b.id}`} x={b.x} y={b.y} className="burning-burst">
          <span className="burst-core">
            <FlameSvg />
          </span>
          <span className="burst-spark spark-1">
            <SparkSvg />
          </span>
          <span className="burst-spark spark-2">
            <SparkSvg />
          </span>
          <span className="burst-spark spark-3">
            <SparkSvg />
          </span>
          <span className="burst-spark spark-4">
            <SparkSvg />
          </span>
        </CellAnchor>
      ))}
      {fizzles.items.map((f) => (
        <CellAnchor key={`fizzle-${f.id}`} x={f.x} y={f.y} className="burning-fizzle">
          <span className="fizzle-smoke">
            <SmokeSvg />
          </span>
        </CellAnchor>
      ))}
      {impacts.items.map((hit) => (
        <CellAnchor key={`burn-impact-${hit.id}`} x={hit.x} y={hit.y} className="board-cell-impact">
          <BoardCellImpact variant="flame" />
        </CellAnchor>
      ))}
    </div>
  )
}

function FlameSvg() {
  return (
    <svg
      viewBox="0 0 24 32"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden
    >
      <defs>
        <radialGradient id="flame-body" cx="50%" cy="78%" r="65%">
          <stop offset="0%" stopColor="#ffe39a" />
          <stop offset="32%" stopColor="#ffc15c" />
          <stop offset="62%" stopColor="#ff9034" />
          <stop offset="92%" stopColor="#ee5e57" />
          <stop offset="100%" stopColor="#c4423c" />
        </radialGradient>
        <radialGradient id="flame-core" cx="50%" cy="84%" r="40%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#ffe39a" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#ffc15c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        d="M12 1.5
           C 10 7, 6.5 10, 5 16
           C 3.5 22, 6 30, 12 30.5
           C 18 30, 20.5 22, 19 16
           C 17.5 10, 14.5 8, 13.5 4
           C 13.2 2.6, 12.6 1.7, 12 1.5 Z"
        fill="url(#flame-body)"
      />
      <ellipse cx="12" cy="22" rx="4.5" ry="6" fill="url(#flame-core)" />
    </svg>
  )
}

function SparkSvg() {
  return (
    <svg
      viewBox="0 0 12 12"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <defs>
        <radialGradient id="spark-body" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#ffe39a" />
          <stop offset="55%" stopColor="#ffc15c" />
          <stop offset="100%" stopColor="#ff9034" />
        </radialGradient>
      </defs>
      <path
        d="M6 0 L7.2 4.8 L12 6 L7.2 7.2 L6 12 L4.8 7.2 L0 6 L4.8 4.8 Z"
        fill="url(#spark-body)"
      />
    </svg>
  )
}

function SmokeSvg() {
  return (
    <svg
      viewBox="0 0 24 32"
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <defs>
        <radialGradient id="smoke-body" cx="50%" cy="55%" r="60%">
          <stop offset="0%" stopColor="#dad6ce" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#a89f93" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#776e63" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="12" cy="22" rx="8" ry="6" fill="url(#smoke-body)" />
      <ellipse cx="13" cy="14" rx="6" ry="5" fill="url(#smoke-body)" />
      <ellipse cx="11" cy="7" rx="4" ry="3.5" fill="url(#smoke-body)" />
    </svg>
  )
}

function seedMetaFromStore(
  setPosition: (id: string, x: number, y: number) => void,
  flameIdRef: { current: number },
): Map<string, FlameMeta> {
  const s = useGameStore.getState()
  const out = new Map<string, FlameMeta>()
  for (let y = 0; y < s.board.cells.length; y++) {
    const row = s.board.cells[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      const b = row[x]?.flags?.burning
      if (b && b > 0) {
        const id = `flame-${++flameIdRef.current}`
        setPosition(id, x, y)
        out.set(id, { remaining: b })
      }
    }
  }
  return out
}
