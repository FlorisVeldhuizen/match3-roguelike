import { emitGameEvent, subscribeGameEvents } from '../core/events/emitter'
import { scheduleAfterMs } from '../timing'
import type { TrailScheduledEvent } from '../types'

export type { TrailScheduledEvent } from '../types'

export function emitTrailScheduled(event: Omit<TrailScheduledEvent, 'kind'>): void {
  emitGameEvent({ kind: 'trail-scheduled', ...event })
}

/** Run when a trail's last particle lands (relative to spawn time). */
export function scheduleAtTrailSpawn(arrivalMs: number, fn: () => void): number {
  return scheduleAfterMs(fn, arrivalMs)
}

export function subscribeTrailScheduled(handler: (event: TrailScheduledEvent) => void): () => void {
  return subscribeGameEvents((event) => {
    if (event.kind === 'trail-scheduled') handler(event)
  })
}

export function subscribeTrailScheduledWhen(
  match: (event: TrailScheduledEvent) => boolean,
  handler: (event: TrailScheduledEvent) => void,
): () => void {
  return subscribeTrailScheduled((event) => {
    if (match(event)) handler(event)
  })
}
