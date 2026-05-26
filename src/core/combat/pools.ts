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
  gold: 0,
}

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

export function hasExtraTurnMatch(events: readonly GameEvent[]): boolean {
  for (const event of events) {
    if (event.kind === 'match-found' && event.size >= 4) return true
  }
  return false
}

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
