import type { MapEdge, MapState } from '../../types'

// Returns the set of node ids the player can legally move to from
// `currentNodeId`. When currentNodeId is null (run start), every col-0
// node is reachable.
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

// Forward-DFS: every node id reachable from `startId` along directed edges.
// Used by tests (shop/rest reachability) and could feed future "preview the
// rest of the run" UI.
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
