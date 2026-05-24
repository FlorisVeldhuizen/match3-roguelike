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
})
