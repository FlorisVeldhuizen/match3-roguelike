// Tiny shared atom for "which enemy is the cursor currently over." Used
// by ClusterShoveOverlay to reveal a swarmer's source→destination
// connecting lines only when the player is inspecting that enemy —
// otherwise three swarmers' lines stack on the board and read as noise.
// Lives outside Zustand because it's purely a transient UI hover state
// (no replay value, no relation to gameplay events) and overusing the
// gameplay store for hover would cause unrelated subscribers to thrash.

let current: string | null = null
const listeners = new Set<(id: string | null) => void>()

export function setHoveredEnemy(id: string | null): void {
  if (current === id) return
  current = id
  for (const l of listeners) l(id)
}

export function getHoveredEnemy(): string | null {
  return current
}

export function subscribeHoveredEnemy(cb: (id: string | null) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
