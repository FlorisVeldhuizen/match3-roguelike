import type { Pos } from '../../types'

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
