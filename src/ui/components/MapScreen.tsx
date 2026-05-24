import { useMemo, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { getReachableFrom } from '../../core/map/paths'
import type { MapNode, NodeKind } from '../../types'

// H1: SVG-based branching map. Columns are laid out left-to-right; lanes
// within a column stack vertically. Nodes are clickable when they sit on
// the player's next legal edge (or all col-0 nodes at run start). Visited
// nodes dim, the current node halos.

const COLUMN_GAP_PX = 110
const LANE_GAP_PX = 76
const NODE_RADIUS = 22
const MARGIN_X = 60
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
): { x: number; y: number } {
  const x = MARGIN_X + node.column * COLUMN_GAP_PX
  // Vertically center each column's lanes against the tallest column.
  const colLanes = laneCounts[node.column] ?? 1
  const centerOffset = ((maxLanes - colLanes) * LANE_GAP_PX) / 2
  const y = MARGIN_Y + centerOffset + node.lane * LANE_GAP_PX
  return { x, y }
}

export function MapScreen() {
  const map = useGameStore((s) => s.map)
  const runPhase = useGameStore((s) => s.runPhase)
  const enterNode = useGameStore((s) => s.enterNode)
  const [hovered, setHovered] = useState<string | null>(null)

  const reachable = useMemo(() => getReachableFrom(map), [map])
  const completedSet = useMemo(
    () => new Set(map.completedNodeIds),
    [map.completedNodeIds],
  )

  if (runPhase !== 'map') return null

  const laneCounts = laneCountByColumn(map.nodes)
  const maxLanes = laneCounts.reduce((a, b) => Math.max(a, b), 0)
  const width = MARGIN_X * 2 + (laneCounts.length - 1) * COLUMN_GAP_PX
  const height = MARGIN_Y * 2 + (maxLanes - 1) * LANE_GAP_PX

  const nodePositions = new Map<string, { x: number; y: number }>()
  for (const node of map.nodes) {
    nodePositions.set(node.id, positionFor(node, laneCounts, maxLanes))
  }

  const hoveredNode = hovered ? map.nodes.find((n) => n.id === hovered) : null

  return (
    <div className="map-screen" role="region" aria-label="Run map">
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
                  <text className="map-node-icon" textAnchor="middle" dy="0.35em">
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
