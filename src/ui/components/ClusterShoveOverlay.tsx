import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { useFightReset } from '../hooks/useFightReset'
import type { Pos } from '../../types'
import { CellAnchor } from './CellAnchor'
import {
  getHoveredEnemy,
  subscribeHoveredEnemy,
} from '../state/hoveredEnemy'
import {
  getHoveredCell,
  subscribeHoveredCell,
} from '../state/hoveredCell'
import { SHOVE_HUES, shoveHueFor } from '../state/shoveHues'

type Threat = {
  enemyId: string
  sources: Pos[]
  destinations: Pos[]
  expiring?: boolean
}

// Matches the 320ms fade-out in threats.css
const FADE_OUT_MS = 320

const CURVE_RATIO = 0.22
function bezierPath(
  from: { cx: number; cy: number },
  to: { cx: number; cy: number },
): string {
  const mx = (from.cx + to.cx) / 2
  const my = (from.cy + to.cy) / 2
  const dx = to.cx - from.cx
  const dy = to.cy - from.cy
  const ctrlX = mx - dy * CURVE_RATIO
  const ctrlY = my + dx * CURVE_RATIO
  return `M ${from.cx} ${from.cy} Q ${ctrlX} ${ctrlY} ${to.cx} ${to.cy}`
}

function samePos(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y
}

function clusterOrientation(cells: Pos[]): 'horizontal' | 'vertical' {
  return cells.length >= 2 && cells[0].y === cells[1].y ? 'horizontal' : 'vertical'
}

function clusterOrigin(cells: Pos[]): Pos {
  let x = cells[0]?.x ?? 0
  let y = cells[0]?.y ?? 0
  for (const c of cells) {
    if (c.x < x) x = c.x
    if (c.y < y) y = c.y
  }
  return { x, y }
}

function clusterCenter(cells: Pos[]): { cx: number; cy: number } {
  let sumX = 0
  let sumY = 0
  for (const c of cells) {
    sumX += c.x
    sumY += c.y
  }
  const n = cells.length || 1
  return { cx: (sumX / n + 0.5) * 12.5, cy: (sumY / n + 0.5) * 12.5 }
}

export function ClusterShoveOverlay() {
  const [threats, setThreats] = useState<Map<string, Threat>>(new Map())
  const hoveredEnemyId = useSyncExternalStore(subscribeHoveredEnemy, getHoveredEnemy)
  const hoveredCell = useSyncExternalStore(subscribeHoveredCell, getHoveredCell)
  const enemies = useGameStore((s) => s.fight.enemies)

  const seedFromStore = useCallback(() => {
    const enemies = useGameStore.getState().fight.enemies
    const next = new Map<string, Threat>()
    for (const e of enemies) {
      if (e.hp <= 0) continue
      if (e.currentIntent.kind !== 'cluster-shove') continue
      next.set(e.id, {
        enemyId: e.id,
        sources: e.currentIntent.sources,
        destinations: e.currentIntent.destinations,
      })
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
    const markExpiring = (ownerId: string) => {
      setThreats((prev) => {
        const cur = prev.get(ownerId)
        if (!cur || cur.expiring) return prev
        const next = new Map(prev)
        next.set(ownerId, { ...cur, expiring: true })
        return next
      })
      const scheduledFight = useGameStore.getState().fightCounter
      window.setTimeout(() => {
        if (useGameStore.getState().fightCounter !== scheduledFight) return
        setThreats((prev) => {
          const cur = prev.get(ownerId)
          if (!cur?.expiring) return prev
          const next = new Map(prev)
          next.delete(ownerId)
          return next
        })
      }, FADE_OUT_MS)
    }

    return subscribeGameEvents((event) => {
      if (event.kind === 'cluster-shove-placed') {
        setThreats((prev) => {
          if (prev.has(event.enemyId)) return prev
          const next = new Map(prev)
          next.set(event.enemyId, {
            enemyId: event.enemyId,
            sources: event.sources,
            destinations: event.destinations,
          })
          return next
        })
      } else if (event.kind === 'cluster-shove-resolved') {
        markExpiring(event.enemyId)
      } else if (event.kind === 'enemy-killed') {
        markExpiring(event.enemyId)
      }
    })
  }, [])

  if (threats.size === 0) return null

  const threatList = [...threats.values()]

  const cellMatchesThreat = (t: Threat, p: Pos): boolean =>
    t.sources.some((s) => samePos(s, p)) ||
    t.destinations.some((d) => samePos(d, p))

  const cellHoverRevealsThreat = (t: Threat): boolean =>
    hoveredCell !== null && cellMatchesThreat(t, hoveredCell)

  const enemyHoverRevealsThreat = (t: Threat): boolean =>
    hoveredEnemyId === t.enemyId

  const lines = threatList.flatMap((t) => {
    const revealed = cellHoverRevealsThreat(t) || enemyHoverRevealsThreat(t)
    if (!revealed) return []
    const hue = shoveHueFor(enemies, t.enemyId) ?? SHOVE_HUES[0]
    const from = clusterCenter(t.sources)
    const to = clusterCenter(t.destinations)
    return [
      {
        key: t.enemyId,
        d: bezierPath(from, to),
        arrowhead: true,
        hue,
      },
    ]
  })

  const hoveredThreatIds = new Set(
    threatList
      .filter((t) => cellHoverRevealsThreat(t) || enemyHoverRevealsThreat(t))
      .map((t) => t.enemyId),
  )
  const chevronHiddenThreatIds = hoveredThreatIds

  const hueStyle = (enemyId: string): CSSProperties => ({
    ['--shove-hue' as string]: String(shoveHueFor(enemies, enemyId) ?? SHOVE_HUES[0]),
  })

  const clusterSizeStyle = (cells: Pos[]): CSSProperties => {
    const orient = clusterOrientation(cells)
    return orient === 'horizontal'
      ? { width: `${12.5 * cells.length}%`, height: '12.5%' }
      : { width: '12.5%', height: `${12.5 * cells.length}%` }
  }

  return (
    <div className="cluster-shove-overlay" aria-hidden>
      {threatList.map((t) => {
        const origin = clusterOrigin(t.sources)
        const orient = clusterOrientation(t.sources)
        const hovered = hoveredThreatIds.has(t.enemyId)
        const expiring = t.expiring === true
        return (
          <CellAnchor
            key={`shove-src-${t.enemyId}`}
            x={origin.x}
            y={origin.y}
            className={`cluster-shove-source ${orient}${hovered ? ' is-hovered' : ''}${expiring ? ' is-expiring' : ''}`}
            style={{ ...hueStyle(t.enemyId), ...clusterSizeStyle(t.sources) }}
          />
        )
      })}
      {threatList.map((t) => {
        const hideChevron = chevronHiddenThreatIds.has(t.enemyId)
        const hovered = hoveredThreatIds.has(t.enemyId)
        const expiring = t.expiring === true
        const origin = clusterOrigin(t.destinations)
        const orient = clusterOrientation(t.destinations)
        return (
          <CellAnchor
            key={`shove-dst-${t.enemyId}`}
            x={origin.x}
            y={origin.y}
            className={`cluster-shove-destination ${orient}${hideChevron ? ' chevron-hidden' : ''}${hovered ? ' is-hovered' : ''}${expiring ? ' is-expiring' : ''}`}
            style={{ ...hueStyle(t.enemyId), ...clusterSizeStyle(t.destinations) }}
          />
        )
      })}
      {lines.length > 0 && (
        <svg
          className="cluster-shove-arrows"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <defs>
            {/* Cloned per hue — context-stroke interop is unreliable in Safari */}
            {SHOVE_HUES.map((hue) => (
              <marker
                key={`arrowhead-${hue}`}
                id={`cluster-shove-arrowhead-${hue}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="4.5"
                markerHeight="4.5"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  fill={`hsl(${hue} 80% 70% / 0.95)`}
                />
              </marker>
            ))}
          </defs>
          {lines.map(({ key, d, arrowhead, hue }) => (
            <path
              key={`shove-line-${key}`}
              d={d}
              fill="none"
              stroke={`hsl(${hue} 80% 68% / 0.92)`}
              strokeWidth="0.6"
              strokeLinecap="round"
              strokeDasharray="1.6 1.4"
              markerEnd={
                arrowhead ? `url(#cluster-shove-arrowhead-${hue})` : undefined
              }
              style={
                { ['--shove-hue' as string]: String(hue) } as CSSProperties
              }
            />
          ))}
        </svg>
      )}
    </div>
  )
}
