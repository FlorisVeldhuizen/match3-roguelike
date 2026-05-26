import type { MapEdge, MapState } from '../../types'

export function getReachableFrom(map: MapState): Set<string> {
  if (map.currentNodeId == null) {
    return new Set(map.nodes.filter((n) => n.column === 0).map((n) => n.id))
  }
  const reachable = new Set<string>()
  for (const edge of map.edges) {
    if (edge.from === map.currentNodeId) reachable.add(edge.to)
  }
  return reachable
}

export function descendantsOf(startId: string, edges: MapEdge[]): Set<string> {
  const out = new Set<string>()
  const stack = [startId]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const edge of edges) {
      if (edge.from !== cur) continue
      if (out.has(edge.to)) continue
      out.add(edge.to)
      stack.push(edge.to)
    }
  }
  return out
}
