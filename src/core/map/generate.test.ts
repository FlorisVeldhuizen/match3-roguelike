import { describe, it, expect } from 'vitest'
import { generateMap, MAP_COLUMN_COUNT } from './generate'
import { descendantsOf } from './paths'

const SEED_COUNT = 1000

function build(seed: number) {
  return generateMap({ seed }).map
}

describe('generateMap', () => {
  it('produces exactly 1 elite per map (in column 2)', () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const map = build(seed)
      const elites = map.nodes.filter((n) => n.kind === 'elite')
      expect(elites).toHaveLength(1)
      expect(elites[0]!.column).toBe(2)
    }
  })

  it('has exactly one boss in the last column', () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const map = build(seed)
      const bosses = map.nodes.filter((n) => n.kind === 'boss')
      expect(bosses).toHaveLength(1)
      expect(bosses[0]!.column).toBe(MAP_COLUMN_COUNT - 1)
    }
  })

  it('guarantees a shop and a rest reachable from every col-0 start', () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const map = build(seed)
      const starts = map.nodes.filter((n) => n.column === 0)
      expect(starts.length).toBeGreaterThan(0)
      for (const start of starts) {
        const subtree = descendantsOf(start.id, map.edges)
        // Include the start node itself so a col-0 shop (none today, but
        // guard against future column tweaks) would count.
        subtree.add(start.id)
        const subtreeNodes = map.nodes.filter((n) => subtree.has(n.id))
        const hasShop = subtreeNodes.some((n) => n.kind === 'shop')
        const hasRest = subtreeNodes.some((n) => n.kind === 'rest')
        expect(hasShop).toBe(true)
        expect(hasRest).toBe(true)
      }
    }
  })

  it('has no orphan nodes — every node reaches the boss', () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const map = build(seed)
      const boss = map.nodes.find((n) => n.kind === 'boss')!
      for (const node of map.nodes) {
        if (node.id === boss.id) continue
        const subtree = descendantsOf(node.id, map.edges)
        expect(subtree.has(boss.id)).toBe(true)
      }
    }
  })

  it('has no orphan nodes — every non-start node has an incoming edge', () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const map = build(seed)
      for (const node of map.nodes) {
        if (node.column === 0) continue
        const incoming = map.edges.some((e) => e.to === node.id)
        expect(incoming).toBe(true)
      }
    }
  })

  it('is deterministic for the same seed', () => {
    for (const seed of [1, 42, 99, 12345, 999_999]) {
      const a = generateMap({ seed }).map
      const b = generateMap({ seed }).map
      expect(b).toEqual(a)
    }
  })

  it('only connects adjacent columns', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const map = build(seed)
      const nodeById = new Map(map.nodes.map((n) => [n.id, n]))
      for (const edge of map.edges) {
        const from = nodeById.get(edge.from)!
        const to = nodeById.get(edge.to)!
        expect(to.column - from.column).toBe(1)
      }
    }
  })

  // H2a: tier weights bias archetype distribution per column. We don't
  // pin exact ratios (they'd be flaky), but we assert directional bands:
  // - col 0: Skirmisher should be the majority (>50%)
  // - col 2 (incl. elite): Skirmisher should NOT be the majority — the
  //   heavier hitters dominate the mid columns
  // - every archetype shows up at least once across the sample (no
  //   accidental zero-weight slot)
  it('archetype distribution respects per-column tier weights', () => {
    const counts: Record<number, Record<string, number>> = {
      0: { brute: 0, smolder: 0, skirmisher: 0 },
      1: { brute: 0, smolder: 0, skirmisher: 0 },
      2: { brute: 0, smolder: 0, skirmisher: 0 },
    }
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const map = build(seed)
      for (const node of map.nodes) {
        if (node.column > 2) continue
        if (!node.archetypes) continue
        for (const a of node.archetypes) {
          const col = counts[node.column]
          if (col && a in col) col[a]! += 1
        }
      }
    }
    const col = (c: number) => {
      const found = counts[c]
      if (!found) throw new Error(`no column ${c}`)
      return found as { brute: number; smolder: number; skirmisher: number }
    }
    const total = (c: number) => col(c).brute + col(c).smolder + col(c).skirmisher
    // Col 0: Skirmisher majority
    expect(col(0).skirmisher / total(0)).toBeGreaterThan(0.5)
    // Col 2: Skirmisher not majority (brute+smolder share dominates)
    expect(col(2).skirmisher / total(2)).toBeLessThan(0.5)
    // Every archetype represented at every encounter column
    for (const c of [0, 1, 2]) {
      expect(col(c).brute).toBeGreaterThan(0)
      expect(col(c).smolder).toBeGreaterThan(0)
      expect(col(c).skirmisher).toBeGreaterThan(0)
    }
  })

  // Multi-enemy group sizes per column band. Col 0-1 are single-enemy;
  // col 2 fights have 2-3 enemies (mixed); elite stays solo; boss solo.
  it('multi-enemy group sizes match the per-column band', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const map = build(seed)
      for (const node of map.nodes) {
        const len = node.archetypes?.length ?? 0
        if (node.kind === 'boss' || node.kind === 'elite') {
          expect(len).toBe(1)
        } else if (node.kind === 'fight') {
          if (node.column <= 1) expect(len).toBe(1)
          else if (node.column === 2) expect(len === 2 || len === 3).toBe(true)
        } else {
          // shop/rest carry no archetypes
          expect(node.archetypes).toBeUndefined()
        }
      }
    }
  })
})
