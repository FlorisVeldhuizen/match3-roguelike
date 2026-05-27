import { type RngState, nextInt, shuffle } from '../rng/mulberry32'
import type { EnemyArchetype, MapEdge, MapNode, MapState, NodeKind } from '../../types'

const COLUMN_COUNT = 6

type ArchetypeWeight = { archetype: EnemyArchetype; weight: number }

const COLUMN_ARCHETYPE_WEIGHTS: ArchetypeWeight[][] = [
  [
    { archetype: 'skirmisher', weight: 6 },
    { archetype: 'brute', weight: 2 },
    { archetype: 'smolder', weight: 1 },
    { archetype: 'swarmer', weight: 1 },
  ],
  [
    { archetype: 'skirmisher', weight: 4 },
    { archetype: 'brute', weight: 3 },
    { archetype: 'smolder', weight: 2 },
    { archetype: 'defender', weight: 1 },
    { archetype: 'caster', weight: 1 },
    { archetype: 'swarmer', weight: 1 },
    { archetype: 'shade', weight: 1 },
  ],
  [
    { archetype: 'brute', weight: 4 },
    { archetype: 'smolder', weight: 3 },
    { archetype: 'defender', weight: 3 },
    { archetype: 'caster', weight: 2 },
    { archetype: 'swarmer', weight: 2 },
    { archetype: 'skirmisher', weight: 2 },
    { archetype: 'leech', weight: 2 },
    { archetype: 'shade', weight: 1 },
    { archetype: 'trickster', weight: 1 },
  ],
  [
    { archetype: 'brute', weight: 4 },
    { archetype: 'smolder', weight: 3 },
    { archetype: 'defender', weight: 3 },
    { archetype: 'caster', weight: 2 },
    { archetype: 'swarmer', weight: 2 },
    { archetype: 'skirmisher', weight: 2 },
    { archetype: 'leech', weight: 2 },
    { archetype: 'shade', weight: 2 },
    { archetype: 'trickster', weight: 2 },
  ],
  [
    { archetype: 'brute', weight: 4 },
    { archetype: 'smolder', weight: 3 },
    { archetype: 'defender', weight: 2 },
    { archetype: 'caster', weight: 2 },
    { archetype: 'swarmer', weight: 2 },
    { archetype: 'skirmisher', weight: 2 },
    { archetype: 'leech', weight: 2 },
    { archetype: 'shade', weight: 2 },
    { archetype: 'trickster', weight: 2 },
  ],
  [{ archetype: 'tyrant', weight: 1 }],
]

const ROLE_MIXED_COMPOSITIONS: EnemyArchetype[][] = [
  ['brute', 'rallier'],
  ['smolder', 'rallier'],
  ['brute', 'skirmisher', 'rallier'],
  ['smolder', 'skirmisher', 'rallier'],
  ['defender', 'smolder'],
  ['defender', 'rallier'],
  ['caster', 'rallier'],
  ['swarmer', 'swarmer'],
  ['swarmer', 'swarmer', 'swarmer'],
  ['defender', 'caster'],
  ['leech', 'rallier'],
  ['shade', 'shade'],
  ['trickster', 'brute'],
  ['leech', 'trickster'],
  ['shade', 'leech'],
]

const ROLE_MIXED_CHANCE_NUMERATOR = 4
const ROLE_MIXED_CHANCE_DENOMINATOR = 10

// These archetypes require multi-enemy plumbing; solo instances break.
const SOLO_BANNED_ARCHETYPES: ReadonlySet<EnemyArchetype> = new Set(['swarmer', 'rallier'])

function rollEnemyCount(
  column: number,
  kind: NodeKind,
  rng: RngState,
): { count: number; rng: RngState } {
  if (kind === 'boss' || kind === 'elite') return { count: 1, rng }
  if (column <= 1) return { count: 1, rng }
  if (column === 3) return { count: 1, rng }
  const [pick, next] = nextInt(rng, 2)
  return { count: pick === 0 ? 2 : 3, rng: next }
}

function rollWeightedArchetype(
  column: number,
  rng: RngState,
  options: { soloNode: boolean } = { soloNode: false },
): { archetype: EnemyArchetype; rng: RngState } {
  const table = COLUMN_ARCHETYPE_WEIGHTS[column] ?? COLUMN_ARCHETYPE_WEIGHTS[0]!
  const filtered = options.soloNode
    ? table.filter((w) => !SOLO_BANNED_ARCHETYPES.has(w.archetype))
    : table
  const total = filtered.reduce((acc, w) => acc + w.weight, 0)
  const [pick, next] = nextInt(rng, total)
  let acc = 0
  for (const entry of filtered) {
    acc += entry.weight
    if (pick < acc) return { archetype: entry.archetype, rng: next }
  }
  return { archetype: filtered[0]!.archetype, rng: next }
}

function rollColumnKinds(column: number, rng: RngState): { kinds: NodeKind[]; rng: RngState } {
  if (column === 0) {
    return { kinds: ['fight', 'fight', 'fight'], rng }
  }
  if (column === 1) {
    const [variant, n] = nextInt(rng, 2)
    const kinds: NodeKind[] = variant === 0 ? ['fight', 'shop'] : ['fight', 'fight']
    const [shuffled, n2] = shuffle(n, kinds)
    return { kinds: shuffled, rng: n2 }
  }
  if (column === 2) {
    const [shuffled, n] = shuffle(rng, ['elite', 'fight', 'fight'] as NodeKind[])
    return { kinds: shuffled, rng: n }
  }
  if (column === 3) {
    return { kinds: ['fight', 'fight'], rng }
  }
  if (column === 4) {
    const [shuffled, n] = shuffle(rng, ['rest', 'shop'] as NodeKind[])
    return { kinds: shuffled, rng: n }
  }
  if (column === 5) {
    return { kinds: ['boss'], rng }
  }
  throw new Error(`rollColumnKinds: unknown column ${column}`)
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
        const { count, rng: rCount } = rollEnemyCount(col, kind, r)
        r = rCount
        let archetypes: EnemyArchetype[]
        const isMultiEnemyFight = kind === 'fight' && count >= 2
        if (isMultiEnemyFight) {
          const [chance, rChance] = nextInt(r, ROLE_MIXED_CHANCE_DENOMINATOR)
          r = rChance
          if (chance < ROLE_MIXED_CHANCE_NUMERATOR) {
            const [compIdx, rComp] = nextInt(r, ROLE_MIXED_COMPOSITIONS.length)
            r = rComp
            archetypes = [...ROLE_MIXED_COMPOSITIONS[compIdx]!]
          } else {
            archetypes = []
            for (let i = 0; i < count; i++) {
              const { archetype, rng: rArch } = rollWeightedArchetype(col, r)
              r = rArch
              archetypes.push(archetype)
            }
          }
        } else {
          archetypes = []
          for (let i = 0; i < count; i++) {
            const { archetype, rng: rArch } = rollWeightedArchetype(col, r, {
              soloNode: true,
            })
            r = rArch
            archetypes.push(archetype)
          }
        }
        node.archetypes = archetypes
      } else if (kind === 'boss') {
        node.archetypes = ['tyrant']
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
    // Col 3→4 is fully connected to guarantee rest+shop reachability.
    const forceFullFanout = c === 3
    for (const from of fromCol) {
      let targetCount: number
      if (forceFullFanout) {
        targetCount = toCol.length
      } else {
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
