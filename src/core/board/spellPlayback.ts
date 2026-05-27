import type { GameEvent } from '../../types'
import { emitGameEvent } from '../events/emitter'

type PlayFn = (events: GameEvent[]) => Promise<void>

let playFn: PlayFn | null = null

export function registerBoardSpellPlayback(fn: PlayFn): () => void {
  playFn = fn
  return () => {
    if (playFn === fn) playFn = null
  }
}

export function playBoardSpellEvents(events: GameEvent[]): Promise<void> {
  const needsBoardAnimation = events.some((e) => {
    switch (e.kind) {
      case 'swap':
      case 'swap-reverted':
      case 'gems-transmuted':
      case 'gems-cleared':
      case 'gems-fell':
      case 'gems-spawned':
      case 'board-shuffled':
        return true
      default:
        return false
    }
  })

  if (needsBoardAnimation && playFn) {
    return playFn(events)
  }

  // Fallback for when the board animator isn't registered (or when the events
  // don't require sprite-sync). This keeps UI hooks relying on event emission
  // (like board-settled) from getting stuck.
  for (const ev of events) emitGameEvent(ev)
  emitGameEvent({ kind: 'gameplay-settled' })
  return Promise.resolve()
}
