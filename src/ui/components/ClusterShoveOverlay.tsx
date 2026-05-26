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

// H2c threat visualization for Swarmer's cluster-shove board verb.
//
// Event-driven (not store-derived) so the markers persist through the
// gap between "store advances the swarmer's intent" (synchronous,
// happens before the animator dequeues anything) and "the gem flight
// actually starts" (whenever the animator gets to the resolved event).
// A purely store-derived overlay vanishes the moment the intent ticks,
// leaving a beat of empty board before the flight animation begins —
// the player reads it as "the warning vanished and then magic happened
// later," not as "the warning resolved into the action." Same pattern
// as ColumnSmashOverlay.
//
//   - cluster-shove-placed:    add (enemyId, sources, destinations).
//   - cluster-shove-resolved:  drop the enemy's threat — fires in
//                              lockstep with the animator's flight
//                              (emitGameEvent runs before the await in
//                              AnimationController.playEvent), so the
//                              markers fade exactly as the gems lift.
//   - enemy-killed:            drop the enemy's threat — Swarmer died
//                              between telegraph and fire.
//   - fight reset:             seed from store (current swarmers whose
//                              intent is cluster-shove).
//
// Connecting lines (per-source-destination bezier curves) only render
// when the player hovers (a) the matching swarmer's enemy frame, OR
// (b) one of that threat's source/destination cells. Permanent lines
// on a 3-swarmer board read as a smear of crisscrossing dashes;
// on-demand inspection per enemy stays parseable. Static source rings
// and destination chevrons always show so the threat is legible at a
// glance.

type Threat = {
  enemyId: string
  sources: Pos[]
  destinations: Pos[]
  // `expiring`: held briefly between resolve/kill and actual unmount so
  // the CSS fade-out has time to play. Same pattern as ColorHexOverlay
  // / BurningOverlay (their `is-expiring` state during FIZZLE_MS).
  expiring?: boolean
}

// Time held in the `expiring` state — long enough for the wash + bracket
// fade-out transition to complete before the React tree drops the
// element. Matches the 320ms fade-out timing in threats.css.
const FADE_OUT_MS = 320

// Quadratic bezier path from source to destination, with the control
// point offset perpendicular to the midpoint. The offset is a fraction
// of segment length so short shoves get a gentle arc and long
// cross-board shoves curve more pronouncedly. Curve always bows the
// same way (right-hand side of source→dst direction) so multiple lines
// from one swarmer don't overlap on top of each other.
const CURVE_RATIO = 0.22
function bezierPath(
  from: { cx: number; cy: number },
  to: { cx: number; cy: number },
): string {
  const mx = (from.cx + to.cx) / 2
  const my = (from.cy + to.cy) / 2
  const dx = to.cx - from.cx
  const dy = to.cy - from.cy
  // Perpendicular (rotated 90° CCW): (-dy, dx). Scaled by CURVE_RATIO.
  const ctrlX = mx - dy * CURVE_RATIO
  const ctrlY = my + dx * CURVE_RATIO
  return `M ${from.cx} ${from.cy} Q ${ctrlX} ${ctrlY} ${to.cx} ${to.cy}`
}

function samePos(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y
}

// A shove cluster is always a contiguous 1×N run along one axis (see
// rollClusterShoveIntent — same `horizontal` flag drives both source
// and destination). So we render the whole cluster as ONE marker —
// brackets framing the entire run, one capsule landing-ring on the
// destination, one connecting line — instead of N independent markers
// stacked next to each other. Cuts the visual count in half for
// length-2 (the only length in play today) and keeps the cluster
// reading as a single unit, which is how the player has to defend it.

function clusterOrientation(cells: Pos[]): 'horizontal' | 'vertical' {
  // Falls back to 'horizontal' for single-cell runs — irrelevant
  // visually since width=height in that case.
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
    // Two-phase removal: mark expiring → wait FADE_OUT_MS → actually
    // delete. The expiring threat keeps rendering with .is-expiring
    // applied, which drives the opacity transition to 0 in CSS.
    // fightCounter-guarded so a stale timeout can't leak into a
    // fresh fight after reset.
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
        // Flight is firing NOW (emitGameEvent runs before the await in
        // AnimationController). Begin the fade-out in lockstep with
        // the flight so the markers visibly soften as the gems lift,
        // instead of snapping out the frame the intent ticks.
        markExpiring(event.enemyId)
      } else if (event.kind === 'enemy-killed') {
        markExpiring(event.enemyId)
      }
    })
  }, [])

  if (threats.size === 0) return null

  const threatList = [...threats.values()]

  // A threat reveals its connecting lines when the player hovers its
  // enemy frame OR any of its source/destination cells. The distinction
  // matters for line styling: cell-hover means the player is pointing
  // AT one specific cell of this threat, so the line gets an arrowhead
  // (pointing to the new location) and the destination chevron hides
  // (the line itself is now the directional indicator, the chevron is
  // redundant). Enemy-hover is the broad "tell me what this enemy is
  // doing" gesture, where keeping the chevron visible reinforces the
  // existing telegraph language.
  const cellMatchesThreat = (t: Threat, p: Pos): boolean =>
    t.sources.some((s) => samePos(s, p)) ||
    t.destinations.some((d) => samePos(d, p))

  const cellHoverRevealsThreat = (t: Threat): boolean =>
    hoveredCell !== null && cellMatchesThreat(t, hoveredCell)

  const enemyHoverRevealsThreat = (t: Threat): boolean =>
    hoveredEnemyId === t.enemyId

  // One line per threat: cluster-center → cluster-center. The N
  // per-cell lines that used to fan out from each source to its
  // matching destination just rendered the cluster moving as a unit;
  // a single line says the same thing without the visual crowding.
  // Enemy-hover and cell-hover are treated identically — both reveal
  // the same arrowed line and hide the destination crosshair, so the
  // player learns one inspection gesture regardless of where they
  // point.
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

  // A threat is "hovered" whenever the player is pointing at its
  // enemy frame OR one of its source/destination cells. Used twice:
  // (a) the bezier-line + arrowhead reveal, (b) the per-cluster
  // `is-hovered` class that boosts the marker so the specific shove
  // the player is inspecting stands out from siblings on a
  // multi-swarmer board.
  const hoveredThreatIds = new Set(
    threatList
      .filter((t) => cellHoverRevealsThreat(t) || enemyHoverRevealsThreat(t))
      .map((t) => t.enemyId),
  )
  // Crosshair hides whenever the bezier+arrowhead is doing the
  // directional job — same trigger as the line itself, since the two
  // would now double-indicate the destination.
  const chevronHiddenThreatIds = hoveredThreatIds

  // Hue is set per-threat via a CSS custom property so source rings,
  // destination markers, and the connecting line all pull from one
  // source of truth — and the CSS still owns lightness/alpha so all the
  // tuning stays in one place.
  const hueStyle = (enemyId: string): CSSProperties => ({
    ['--shove-hue' as string]: String(shoveHueFor(enemies, enemyId) ?? SHOVE_HUES[0]),
  })

  // Per-threat: one source bracket-frame anchored at the cluster's
  // min-corner cell, sized inline to span the full N-cell run; one
  // destination ring sized the same way. Orientation class drives the
  // bracket/ring proportions in CSS so the marker keeps a consistent
  // absolute-cell footprint regardless of horizontal vs vertical run.
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
            {/* One marker per palette hue. Sharing a single marker with
                `context-stroke` would be cleaner but interop is still
                spotty across Safari versions; cloning the marker is
                cheap. Each path picks its marker by hue index. */}
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
