import type { GameEvent } from '../../types'

// Animation-timed, not logic-timed — do not use as state source of truth.
type Handler = (event: GameEvent) => void

const handlers = new Set<Handler>()

export function emitGameEvent(event: GameEvent): void {
  for (const handler of handlers) handler(event)
}

export function subscribeGameEvents(handler: Handler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}
