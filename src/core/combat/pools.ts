import type { GameEvent, GemColor } from '../../types'
import { applyMultiplier } from './math'
import { getCascadeMultiplier } from './multipliers'

export type PoolDeltas = Record<GemColor, number>

export const ZERO_DELTAS: PoolDeltas = {
  red: 0,
  blue: 0,
  green: 0,
  yellow: 0,
  purple: 0,
}

// Walk a settled cascade event stream and tally per-color pool deltas.
// Cascade-start events advance the multiplier; match-found events contribute
// `match.size * cascade * (blessed ? 2 : 1)` (floored) to their color. The
// split between immediate (yellow/purple) and pooled (red/blue/green)
// crediting is handled by the caller — this just totals deltas.
export function computeMatchPayouts(events: readonly GameEvent[]): PoolDeltas {
  const out: PoolDeltas = { ...ZERO_DELTAS }
  let level = 0
  for (const event of events) {
    if (event.kind === 'cascade-start') {
      level = event.level
    } else if (event.kind === 'match-found') {
      const cascadeMult = getCascadeMultiplier(level)
      const mult = event.blessed ? cascadeMult * 2 : cascadeMult
      out[event.color] += applyMultiplier(event.size, mult)
    }
  }
  return out
}

// At least one match-found of size 4+ → player keeps the phase open.
// Architecture: "4+ match grants extra turn"; chains are uncapped, but a
// single swap caps at one extra turn regardless of how many 4+ matches landed.
export function hasExtraTurnMatch(events: readonly GameEvent[]): boolean {
  for (const event of events) {
    if (event.kind === 'match-found' && event.size >= 4) return true
  }
  return false
}

// Inject pool-gained events into a copy of the event stream, immediately
// after each match-found, so the animation/log layer sees one pool credit
// per match in the same order resolveSwap emitted them.
export function withPoolGainedEvents(
  events: readonly GameEvent[],
): GameEvent[] {
  const out: GameEvent[] = []
  let level = 0
  for (const event of events) {
    out.push(event)
    if (event.kind === 'cascade-start') {
      level = event.level
    } else if (event.kind === 'match-found') {
      const cascadeMult = getCascadeMultiplier(level)
      const mult = event.blessed ? cascadeMult * 2 : cascadeMult
      const amount = applyMultiplier(event.size, mult)
      if (amount > 0) {
        out.push({ kind: 'pool-gained', color: event.color, amount })
      }
    }
  }
  return out
}
