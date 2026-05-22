import type { GameEvent } from '../../types'

// Tiny pub/sub for animation-timed GameEvents. AnimationController fires this
// as it plays each event; React subscribers (pool pulses, screenshake) and
// the SFX layer hang off it. This is animation-timed, not logic-timed —
// subscribers should NOT use it as a source of truth for state (that's
// the Zustand store).
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
