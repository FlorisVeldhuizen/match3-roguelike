import { type RngState, nextInt, shuffle } from '../rng/mulberry32'
import type {
  EnemyArchetype,
  MapEdge,
  MapNode,
  MapState,
  NodeKind,
} from '../../types'

// H1 map: 5 columns total. Columns 0-3 are encounter columns, column 4 is
// the boss. Layout per PLANNING/02-scope §Map structure.
//
// - col 0: 3 fight nodes (player picks any one as the first move)
// - col 1: 2 nodes — variant A: fight + shop, variant B: 2 fights
// - col 2: 3 nodes — exactly 1 elite + 2 fights (elite lane randomized)
// - col 3: 2 nodes — rest + shop (the "2 shops" variant in the scope sketch
//   would violate the "≥1 rest accessible" rule, so we always emit rest + shop)
// - col 4: 1 boss node
//
// Edge generation:
// - each col-N node picks 1-2 targets in col-(N+1)
// - after that pass, any col-(N+1) node still without an incoming edge gets
//   one from a random col-N source — guarantees no orphans
// - all col-3 nodes connect to the boss
//
// Path guarantees (verified by tests/map-generation.test.ts):
// - exactly 1 elite present (in col 2)
// - ≥1 shop reachable from every col-0 start (col 3 always has one,
//   col-2 always reaches col-3)
// - ≥1 rest reachable from every col-0 start (same)
// - no orphan nodes, every node reaches the boss

const COLUMN_COUNT = 5

const NON_BOSS_ARCHETYPES: EnemyArchetype[] = ['brute', 'smolder']

function rollColumnKinds(
  column: number,
  rng: RngState,
): { kinds: NodeKind[]; rng: RngState } {
  if (column === 0) {
    return { kinds: ['fight', 'fight', 'fight'], rng }
  }
  if (column === 1) {
    const [variant, n] = nextInt(rng, 2)
    const kinds: NodeKind[] =
      variant === 0 ? ['fight', 'shop'] : ['fight', 'fight']
    // Shuffle lane assignment so the shop isn't always at the same y.
    const [shuffled, n2] = shuffle(n, kinds)
    return { kinds: shuffled, rng: n2 }
  }
  if (column === 2) {
    const [shuffled, n] = shuffle(rng, ['elite', 'fight', 'fight'] as NodeKind[])
    return { kinds: shuffled, rng: n }
  }
  if (column === 3) {
    const [shuffled, n] = shuffle(rng, ['rest', 'shop'] as NodeKind[])
    return { kinds: shuffled, rng: n }
  }
  if (column === 4) {
    return { kinds: ['boss'], rng }
  }
  throw new Error(`rollColumnKinds: unknown column ${column}`)
}

function rollArchetype(
  rng: RngState,
): { archetype: EnemyArchetype; rng: RngState } {
  const [idx, n] = nextInt(rng, NON_BOSS_ARCHETYPES.length)
  return { archetype: NON_BOSS_ARCHETYPES[idx] ?? 'brute', rng: n }
}

function buildNodes(rng: RngState): {
  nodes: MapNode[]
  nodesByColumn: MapNode[][]
  rng: RngState
} {
  let r = rng
  const nodes: MapNode[] = []
  const nodesByColumn: MapNode[][] = []
  for (let col = 0; col < COLUMN_COUNT; col++) {
    const { kinds, rng: r1 } = rollColumnKinds(col, r)
    r = r1
    const colNodes: MapNode[] = []
    for (let lane = 0; lane < kinds.length; lane++) {
      const kind = kinds[lane]!
      const node: MapNode = {
        id: `c${col}-l${lane}`,
        kind,
        column: col,
        lane,
      }
      if (kind === 'fight' || kind === 'elite') {
        const { archetype, rng: r2 } = rollArchetype(r)
        r = r2
        node.archetype = archetype
      } else if (kind === 'boss') {
        // Roadmap: boss uses Brute stats in H1; Corruptor lands in J1.
        node.archetype = 'brute'
      }
      colNodes.push(node)
      nodes.push(node)
    }
    nodesByColumn.push(colNodes)
  }
  return { nodes, nodesByColumn, rng: r }
}

function buildEdges(
  nodesByColumn: MapNode[][],
  rng: RngState,
): { edges: MapEdge[]; rng: RngState } {
  let r = rng
  const edges: MapEdge[] = []
  for (let c = 0; c < nodesByColumn.length - 1; c++) {
    const fromCol = nodesByColumn[c]!
    const toCol = nodesByColumn[c + 1]!
    // Col 2 → col 3 hosts the rest + shop pair. To guarantee both services
    // are reachable from every col-0 start (per scope rules "≥1 shop
    // accessible", "≥1 rest accessible"), we force this hop to be fully
    // connected — every col-2 node connects to BOTH col-3 nodes. Players
    // still pick which service to visit; they just never get locked out of
    // the other by path geometry. Other hops use the random 1-2 fanout.
    const forceFullFanout = c === 2
    for (const from of fromCol) {
      let targetCount: number
      if (forceFullFanout) {
        targetCount = toCol.length
      } else {
        // Each from-node connects to 1-2 to-nodes (boss column is size 1,
        // so it caps to 1 naturally via Math.min below).
        const [extra, r1] = nextInt(r, 2)
        r = r1
        targetCount = Math.min(1 + extra, toCol.length)
      }
      const [shuffled, r2] = shuffle(r, toCol)
      r = r2
      for (let i = 0; i < targetCount; i++) {
        const target = shuffled[i]!
        edges.push({ from: from.id, to: target.id })
      }
    }
    // Backfill: any to-node without an incoming edge picks up one from a
    // random from-node. Ensures no orphans.
    for (const to of toCol) {
      if (edges.some((e) => e.to === to.id)) continue
      const [idx, r3] = nextInt(r, fromCol.length)
      r = r3
      const from = fromCol[idx]!
      edges.push({ from: from.id, to: to.id })
    }
  }
  return { edges, rng: r }
}

export function generateMap(rng: RngState): { map: MapState; rng: RngState } {
  const { nodesByColumn, nodes, rng: r1 } = buildNodes(rng)
  const { edges, rng: r2 } = buildEdges(nodesByColumn, r1)
  return {
    map: {
      nodes,
      edges,
      currentNodeId: null,
      completedNodeIds: [],
    },
    rng: r2,
  }
}

export const MAP_COLUMN_COUNT = COLUMN_COUNT
