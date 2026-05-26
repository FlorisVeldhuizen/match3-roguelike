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
//
// H4b: Role-mixed compositions. Mid-column fight nodes have a ~40% chance
// to draw from a preset composition pool (role-mixed pairs like
// ['brute', 'rallier'] or ['smolder', 'rallier']) instead of rolling
// archetypes independently. Simple-stack groups stay in the pool via the
// normal weighted roller — variety is the point, not gatekeeping.

const COLUMN_COUNT = 5

// H2a: tier-weighted archetype pool per column. Skirmisher heavier in the
// early columns (low-HP chip damage → gentle on-ramp); Brute and Smolder
// pick up weight in mid columns (heavier HP + verbs / statuses). Elites
// (always col 2) draw from the same mid pool but with a bias toward the
// scarier archetypes. Boss column is handled separately (always brute,
// pending J1 Corruptor).
type ArchetypeWeight = { archetype: EnemyArchetype; weight: number }

const COLUMN_ARCHETYPE_WEIGHTS: ArchetypeWeight[][] = [
  // col 0: easy start — Skirmisher heavy, the others present but rare.
  // Defender / Caster / Swarmer absent here (their identities want
  // meaningful HP pressure or multi-enemy plumbing, which the early
  // curve doesn't have yet).
  [
    { archetype: 'skirmisher', weight: 6 },
    { archetype: 'brute', weight: 2 },
    { archetype: 'smolder', weight: 1 },
    { archetype: 'swarmer', weight: 1 },
  ],
  // col 1: balanced — Skirmisher still common; Defender debuts at low
  // weight so the player meets the petrify lockout before the elite
  // column lands a heavier Defender variant. Caster also debuts here
  // so the Weak rider / hex pressure shows up before col 2.
  [
    { archetype: 'skirmisher', weight: 4 },
    { archetype: 'brute', weight: 3 },
    { archetype: 'smolder', weight: 2 },
    { archetype: 'defender', weight: 1 },
    { archetype: 'caster', weight: 1 },
    { archetype: 'swarmer', weight: 1 },
  ],
  // col 2 (incl. elite): heavier hitters dominate; Skirmisher becomes
  // filler in multi-enemy groups rather than a centerpiece. Caster /
  // Swarmer pull full weight as mid-tier disruption alongside the
  // existing wall (Defender) and hitters (Brute / Smolder).
  [
    { archetype: 'brute', weight: 4 },
    { archetype: 'smolder', weight: 3 },
    { archetype: 'defender', weight: 3 },
    { archetype: 'caster', weight: 2 },
    { archetype: 'swarmer', weight: 2 },
    { archetype: 'skirmisher', weight: 2 },
  ],
  // col 3: only rest/shop here today; left for symmetry / future tiers
  [
    { archetype: 'brute', weight: 4 },
    { archetype: 'smolder', weight: 3 },
    { archetype: 'defender', weight: 2 },
    { archetype: 'caster', weight: 2 },
    { archetype: 'swarmer', weight: 2 },
    { archetype: 'skirmisher', weight: 2 },
  ],
  // col 4: boss column; not used by the weight roller
  [{ archetype: 'brute', weight: 1 }],
]

// H4b: Preset role-mixed compositions for mid-column fight nodes.
// At least 2 distinct role-mixed templates are required (H4b acceptance).
// The list intentionally includes simple-stacks too: picking from this
// pool does NOT exclude homogeneous groups — it just adds more options.
// Simple-stacks still appear via the normal weighted roller path below.
const ROLE_MIXED_COMPOSITIONS: EnemyArchetype[][] = [
  // Role-mixed pairs: support (Rallier) + heavy hitter
  ['brute', 'rallier'],
  ['smolder', 'rallier'],
  // 3-enemy with a Rallier in the mix
  ['brute', 'skirmisher', 'rallier'],
  ['smolder', 'skirmisher', 'rallier'],
  // H2b: Defender + Smolder — "wall + burner". Defender's petrify
  // locks rows the player wants to clear burning gems on, so the
  // player has to choose: clear the burn (eat the lockout next turn)
  // or grind the Defender down (eat more burn). Explicitly called out
  // in 01-design as the canonical role-mixed example.
  ['defender', 'smolder'],
  // Defender + Rallier — buff-target alongside a wall. The Rallier's
  // Strength stacks make the Defender's small attack genuinely
  // dangerous, while the petrify slows the player down.
  ['defender', 'rallier'],
  // H2c: Caster + Rallier — debuff carrier protected by a buffer.
  // Rallier's Strength makes the Caster's small attack matter while
  // the hex bleeds Weak onto the player's match payouts.
  ['caster', 'rallier'],
  // H2c: 2-3 Swarmer cluster — group spawn matches Swarmer's design
  // identity ("spawn in groups"). Cluster-shove fires from multiple
  // sources every turn, layering disruption.
  ['swarmer', 'swarmer'],
  ['swarmer', 'swarmer', 'swarmer'],
  // H2c: Defender + Caster — wall + hex. Player has to route around
  // petrified rows while avoiding the hexed colour. Punishing for
  // greedy match planners.
  ['defender', 'caster'],
]

// Probability (out of 10) that a mid-column multi-enemy fight node draws
// from ROLE_MIXED_COMPOSITIONS instead of rolling independently.
// 4/10 = 40% — ensures role-mixed appear frequently enough to matter
// while simple-stacks remain the slight majority.
const ROLE_MIXED_CHANCE_NUMERATOR = 4
const ROLE_MIXED_CHANCE_DENOMINATOR = 10

// Group sizes per column: cols 0-1 = solo (1 enemy), col 2 = 2-3 enemies
// (mixed), elite = solo but tougher (handled by archetype bias, not
// count, today), boss = solo. Returns the count to roll for this node.
function rollEnemyCount(
  column: number,
  kind: NodeKind,
  rng: RngState,
): { count: number; rng: RngState } {
  if (kind === 'boss' || kind === 'elite') return { count: 1, rng }
  if (column <= 1) return { count: 1, rng }
  // col 2: 50/50 split between 2-enemy and 3-enemy groups
  const [pick, next] = nextInt(rng, 2)
  return { count: pick === 0 ? 2 : 3, rng: next }
}

function rollWeightedArchetype(
  column: number,
  rng: RngState,
): { archetype: EnemyArchetype; rng: RngState } {
  const table = COLUMN_ARCHETYPE_WEIGHTS[column] ?? COLUMN_ARCHETYPE_WEIGHTS[0]!
  const total = table.reduce((acc, w) => acc + w.weight, 0)
  const [pick, next] = nextInt(rng, total)
  let acc = 0
  for (const entry of table) {
    acc += entry.weight
    if (pick < acc) return { archetype: entry.archetype, rng: next }
  }
  // Fallback (unreachable as long as total > 0 — guard for sanity).
  return { archetype: table[0]!.archetype, rng: next }
}

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
        // H4b: mid-column multi-enemy fight nodes have a chance to draw a
        // preset role-mixed composition rather than rolling independently.
        // Solo fights and elites always use the weighted roller (no Rallier
        // in a solo node — ally-target intents would always fall back).
        const isMultiEnemyFight = kind === 'fight' && count >= 2
        if (isMultiEnemyFight) {
          const [chance, rChance] = nextInt(r, ROLE_MIXED_CHANCE_DENOMINATOR)
          r = rChance
          if (chance < ROLE_MIXED_CHANCE_NUMERATOR) {
            // Pick a role-mixed composition from the pool.
            const [compIdx, rComp] = nextInt(r, ROLE_MIXED_COMPOSITIONS.length)
            r = rComp
            archetypes = [...ROLE_MIXED_COMPOSITIONS[compIdx]!]
          } else {
            // Normal path: roll each archetype independently.
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
            const { archetype, rng: rArch } = rollWeightedArchetype(col, r)
            r = rArch
            archetypes.push(archetype)
          }
        }
        node.archetypes = archetypes
      } else if (kind === 'boss') {
        // Roadmap: boss uses Brute stats in H1/H2a; Corruptor lands in J1.
        node.archetypes = ['brute']
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
