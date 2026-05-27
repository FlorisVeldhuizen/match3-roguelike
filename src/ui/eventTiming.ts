import type { GameEvent } from '../types'
import { readSpellVisualBeat } from '../core/combat/spellVisual'

/** How long to wait before updating displayed numbers for this event. */
export function eventHudDelayMs(event: GameEvent, fallbackMs: number): number {
  return readSpellVisualBeat(event)?.arriveMs ?? fallbackMs
}
