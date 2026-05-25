import { useEffect, useMemo, useRef, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { getReachableFrom } from '../../core/map/paths'
import { tryGetRelic } from '../../core/relics/registry'
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
// MARGIN_X wide enough to host the floor-numeral rail on the left
// without the numerals/Apex label crowding the leftmost node circle.
const MARGIN_X = 68
const MARGIN_Y = 60
// x-position of the numeral rail inside the left gutter — leaves
// ~20px of breathing room between the widest numeral ("VIII") and
// the leftmost node at MARGIN_X.
const FLOOR_RAIL_X = 16
// Extra strip below col 0 where the player-anchor pip lives before any
// node has been picked. Once a node is current, the anchor disappears,
// but we keep the strip in the SVG so the floor numerals don't reflow.
const ANCHOR_BAND_PX = 90

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

// Roman numerals up to ~XII cover any realistic floor count. The boss
// floor gets its own label ("Apex") instead of a numeral, so the climb
// has a named summit.
const ROMAN = [
  '',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
]
function floorLabel(column: number, lastColumn: number): string {
  if (column === lastColumn) return 'Apex'
  return ROMAN[column + 1] ?? String(column + 1)
}

export function MapScreen() {
  const map = useGameStore((s) => s.map)
  const runPhase = useGameStore((s) => s.runPhase)
  const enterNode = useGameStore((s) => s.enterNode)
  const player = useGameStore((s) => s.fight.player)
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
      // Pre-first-fight or older browser: scroll to the bottom so the
      // player-anchor pip is visible on a fresh run.
      el.scrollTop = el.scrollHeight
    }
  }, [runPhase])

  if (runPhase !== 'map') return null

  const laneCounts = laneCountByColumn(map.nodes)
  const maxLanes = laneCounts.reduce((a, b) => Math.max(a, b), 0)
  const lastColumn = laneCounts.length - 1
  const width = MARGIN_X * 2 + (maxLanes - 1) * SLOT_GAP_PX
  const height = MARGIN_Y * 2 + lastColumn * FLOOR_GAP_PX + ANCHOR_BAND_PX

  const nodePositions = new Map<string, { x: number; y: number }>()
  for (const node of map.nodes) {
    nodePositions.set(node.id, positionFor(node, laneCounts, maxLanes, lastColumn))
  }

  // Player-anchor pip: only visible before any node is picked. Sits below
  // col 0 with dashed connections fanning up to each entrance node, so
  // the fresh run feels like "you are here, climbing from this base."
  const anchorVisible = map.currentNodeId == null
  const col0Bottom = MARGIN_Y + lastColumn * FLOOR_GAP_PX
  const anchorX = width / 2
  const anchorY = col0Bottom + ANCHOR_BAND_PX * 0.65
  const entryNodes = map.nodes.filter((n) => n.column === 0)

  // Floor-marker positions: one numeral per column, painted into the
  // left margin of the SVG. They scale with the SVG so they don't drift
  // on mobile.
  const floorMarkers: { y: number; label: string }[] = []
  for (let c = 0; c <= lastColumn; c++) {
    floorMarkers.push({
      y: MARGIN_Y + (lastColumn - c) * FLOOR_GAP_PX,
      label: floorLabel(c, lastColumn),
    })
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
        <div className="map-brand">
          <span className="map-brand-rule" aria-hidden />
          <span className="map-brand-glyph" aria-hidden>◆</span>
          <h1 className="map-wordmark">Renzadora</h1>
          <span className="map-brand-glyph" aria-hidden>◆</span>
          <span className="map-brand-rule" aria-hidden />
        </div>
        <p className="map-sub">
          {anchorVisible
            ? 'Pick an entrance to begin the climb.'
            : 'Pick a connected node to continue.'}
        </p>
        <div className="map-run-sigil" aria-label="Run status">
          <div className="map-run-hp" title={`HP ${player.hp} / ${player.maxHp}`}>
            <span className="map-run-hp-icon" aria-hidden>♥</span>
            <span className="map-run-hp-text">
              <span className="map-run-hp-cur">{player.hp}</span>
              <span className="map-run-hp-sep">/</span>
              <span className="map-run-hp-max">{player.maxHp}</span>
            </span>
          </div>
          {player.relics.length > 0 ? (
            <div className="map-run-relics" aria-label="Relics carried">
              {player.relics.map((inst) => {
                const def = tryGetRelic(inst.id)
                if (!def) return null
                return (
                  <span
                    key={inst.id}
                    className={`map-run-relic rarity-${def.rarity}`}
                    title={def.name}
                  >
                    {def.icon}
                  </span>
                )
              })}
            </div>
          ) : (
            <div className="map-run-relics-empty">No relics yet</div>
          )}
        </div>
        <div className="map-canvas-wrap">
            <svg
              className="map-canvas"
              viewBox={`0 0 ${width} ${height}`}
              width={width}
              height={height}
              role="img"
              aria-label="Branching encounter map"
            >
              {/* Floor-numeral rail. Sits at the left edge of the SVG, in
                  the existing MARGIN_X gutter — no extra width needed. */}
              {floorMarkers.map((m, i) => (
                <text
                  key={`floor-${i}`}
                  className={
                    'map-floor-numeral' +
                    (m.label === 'Apex' ? ' map-floor-apex' : '')
                  }
                  x={FLOOR_RAIL_X}
                  y={m.y}
                  textAnchor="middle"
                  dy="0.35em"
                >
                  {m.label}
                </text>
              ))}
              {/* Pre-pick dashed connectors from the player-anchor up to
                  each entrance node. Painted before nodes so the node
                  rings sit on top. */}
              {anchorVisible
                ? entryNodes.map((n) => {
                    const pos = nodePositions.get(n.id)
                    if (!pos) return null
                    return (
                      <line
                        key={`anchor-${n.id}`}
                        className="map-edge map-edge-anchor"
                        x1={anchorX}
                        y1={anchorY - 18}
                        x2={pos.x}
                        y2={pos.y}
                      />
                    )
                  })
                : null}
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
              {/* Player-anchor pip — "you are here" before any node is
                  picked. A double-ringed glyph with a compass-rose mark
                  inside, anchored on the centerline below col 0. */}
              {anchorVisible ? (
                <g
                  className="map-anchor"
                  transform={`translate(${anchorX}, ${anchorY})`}
                  aria-label="You are here"
                >
                  <circle r={20} className="map-anchor-ring-outer" />
                  <circle r={13} className="map-anchor-ring-inner" />
                  <path
                    className="map-anchor-star"
                    d="M0,-9 L2.4,-2.4 L9,0 L2.4,2.4 L0,9 L-2.4,2.4 L-9,0 L-2.4,-2.4 Z"
                  />
                  <text
                    className="map-anchor-label"
                    y={36}
                    textAnchor="middle"
                  >
                    YOU
                  </text>
                </g>
              ) : null}
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
