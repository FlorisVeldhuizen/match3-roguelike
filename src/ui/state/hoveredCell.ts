import type { Pos } from '../../types'

// Tiny shared atom for "which board cell is the cursor currently over."
// Written by BoardScene's pointer handlers (the canvas owns pointer
// interaction; HTML overlays have pointer-events: none and can't catch
// hover directly), read by overlays that want to reveal extra
// information about a specific cell — currently only ClusterShoveOverlay,
// which uses it to show the source→destination connecting lines when
// the player hovers a pending-shove source or destination.

let current: Pos | null = null
const listeners = new Set<(p: Pos | null) => void>()

function samePos(a: Pos | null, b: Pos | null): boolean {
  if (a === null || b === null) return a === b
  return a.x === b.x && a.y === b.y
}

export function setHoveredCell(p: Pos | null): void {
  if (samePos(current, p)) return
  current = p
  for (const l of listeners) l(p)
}

export function getHoveredCell(): Pos | null {
  return current
}

export function subscribeHoveredCell(cb: (p: Pos | null) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
