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
