import { useEffect, useMemo, useRef, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { getReachableFrom } from '../../core/map/paths'
import type { MapNode, NodeKind } from '../../types'

// H1: SVG branching map. STS-style — floors stack vertically with the
// boss at the top, the player climbs from bottom to top. The data model
// still calls the progress axis "column" (0..N-1) and the per-floor
// position "lane" (0..K-1); we render column → vertical y (inverted so
// col 0 sits at the bottom) and lane → horizontal x. This shape fits
// mobile portrait viewports without horizontal pan and works on desktop
// because the map-screen container scrolls.

const FLOOR_GAP_PX = 96
const SLOT_GAP_PX = 76
const NODE_RADIUS = 22
const MARGIN_X = 50
const MARGIN_Y = 60

const NODE_ICONS: Record<NodeKind, string> = {
  fight: '⚔',
  elite: '☠',
  shop: '⌂',
  rest: '✦',
  boss: '♛',
}

const NODE_LABELS: Record<NodeKind, string> = {
  fight: 'Fight',
  elite: 'Elite',
  shop: 'Shop',
  rest: 'Rest',
  boss: 'Boss',
}

function laneCountByColumn(nodes: MapNode[]): number[] {
  const counts: number[] = []
  for (const n of nodes) {
    counts[n.column] = Math.max(counts[n.column] ?? 0, n.lane + 1)
  }
  return counts
}

function positionFor(
  node: MapNode,
  laneCounts: number[],
  maxLanes: number,
  lastColumn: number,
): { x: number; y: number } {
  // Horizontally center the lanes of this floor against the widest floor,
  // so a 1-node floor (boss, shop alone) sits over the middle of a 3-lane
  // floor instead of clinging to the left edge.
  const colLanes = laneCounts[node.column] ?? 1
  const centerOffset = ((maxLanes - colLanes) * SLOT_GAP_PX) / 2
  const x = MARGIN_X + centerOffset + node.lane * SLOT_GAP_PX
  // Invert column → y so col 0 is at the BOTTOM and the boss column at
  // the TOP. The player visually climbs the map.
  const y = MARGIN_Y + (lastColumn - node.column) * FLOOR_GAP_PX
  return { x, y }
}

export function MapScreen() {
  const map = useGameStore((s) => s.map)
  const runPhase = useGameStore((s) => s.runPhase)
  const enterNode = useGameStore((s) => s.enterNode)
  const [hovered, setHovered] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const reachable = useMemo(() => getReachableFrom(map), [map])
  const completedSet = useMemo(
    () => new Set(map.completedNodeIds),
    [map.completedNodeIds],
  )

  // On entering the map screen, scroll so the player's current floor
  // (or the starting floor at the bottom if the run just began) is in
  // view. Without this, a tall map on a phone opens at the top showing
  // the boss — confusing on a fresh run.
  useEffect(() => {
    if (runPhase !== 'map') return
    const el = scrollerRef.current
    if (!el) return
    const current = el.querySelector(
      '.map-node-current',
    ) as SVGGraphicsElement | null
    if (current?.scrollIntoView) {
      current.scrollIntoView({ block: 'center', behavior: 'auto' })
    } else {
      // Pre-first-fight or older browser: scroll to the bottom (col 0).
      el.scrollTop = el.scrollHeight
    }
  }, [runPhase])

  if (runPhase !== 'map') return null

  const laneCounts = laneCountByColumn(map.nodes)
  const maxLanes = laneCounts.reduce((a, b) => Math.max(a, b), 0)
  const lastColumn = laneCounts.length - 1
  const width = MARGIN_X * 2 + (maxLanes - 1) * SLOT_GAP_PX
  const height = MARGIN_Y * 2 + lastColumn * FLOOR_GAP_PX

  const nodePositions = new Map<string, { x: number; y: number }>()
  for (const node of map.nodes) {
    nodePositions.set(node.id, positionFor(node, laneCounts, maxLanes, lastColumn))
  }

  const hoveredNode = hovered ? map.nodes.find((n) => n.id === hovered) : null

  return (
    <div
      className="map-screen"
      role="region"
      aria-label="Run map"
      ref={scrollerRef}
    >
      <div className="map-screen-inner">
        <h2 className="map-title">Choose your path</h2>
        <p className="map-sub">
          {map.currentNodeId == null
            ? 'Pick an entrance to begin.'
            : 'Pick a connected node to continue.'}
        </p>
        <div className="map-canvas-wrap">
            <svg
              className="map-canvas"
              viewBox={`0 0 ${width} ${height}`}
              width={width}
              height={height}
              role="img"
              aria-label="Branching encounter map"
            >
              {/* Edges first so nodes paint on top. */}
              {map.edges.map((edge) => {
                const from = nodePositions.get(edge.from)
                const to = nodePositions.get(edge.to)
                if (!from || !to) return null
                const isTraversed =
                  completedSet.has(edge.from) && edge.to === map.currentNodeId
                const isOnPath =
                  completedSet.has(edge.from) || edge.from === map.currentNodeId
                return (
                  <line
                    key={`${edge.from}-${edge.to}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    className={
                      'map-edge' +
                      (isTraversed ? ' map-edge-traversed' : '') +
                      (isOnPath && !isTraversed ? ' map-edge-active' : '')
                    }
                  />
                )
              })}
              {map.nodes.map((node) => {
                const pos = nodePositions.get(node.id)
                if (!pos) return null
                const isCurrent = node.id === map.currentNodeId
                const isCompleted = completedSet.has(node.id) && !isCurrent
                const isReachable = reachable.has(node.id)
                const classes = [
                  'map-node',
                  `map-node-${node.kind}`,
                  isCurrent ? 'map-node-current' : '',
                  isCompleted ? 'map-node-completed' : '',
                  isReachable ? 'map-node-reachable' : '',
                ]
                  .filter(Boolean)
                  .join(' ')
                return (
                  <g
                    key={node.id}
                    className={classes}
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onClick={() => {
                      if (isReachable) enterNode(node.id)
                    }}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() =>
                      setHovered((h) => (h === node.id ? null : h))
                    }
                    role={isReachable ? 'button' : undefined}
                    aria-label={`${NODE_LABELS[node.kind]}${
                      isCurrent
                        ? ' — current'
                        : isCompleted
                          ? ' — visited'
                          : isReachable
                            ? ' — reachable'
                            : ''
                    }`}
                    style={{ cursor: isReachable ? 'pointer' : 'default' }}
                  >
                    <circle r={NODE_RADIUS} className="map-node-circle" />
                    <text
                      className="map-node-icon"
                      textAnchor="middle"
                      dy="0.35em"
                    >
                      {NODE_ICONS[node.kind]}
                    </text>
                  </g>
                )
              })}
            </svg>
          {hoveredNode ? (
            <div
              className="map-node-tooltip"
              style={{
                left: nodePositions.get(hoveredNode.id)!.x,
                top: nodePositions.get(hoveredNode.id)!.y - NODE_RADIUS - 12,
              }}
            >
              {NODE_LABELS[hoveredNode.kind]}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
