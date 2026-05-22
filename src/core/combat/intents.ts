import { nextInt, type RngState } from '../rng/mulberry32'
import type { EnemyArchetype, Intent, IntentKind } from '../../types'
import { getArchetype, type IntentRange } from './archetypeRegistry'

// Roll an intent at a given pattern index. The kind is scripted per archetype
// (deterministic by index); only the numeric value rolls from `rng.enemy`.
// Pattern repeats from the start of every encounter — same intent at same
// turn index regardless of when the player entered (design doc §3).
export function rollIntent(
  archetype: EnemyArchetype,
  patternIndex: number,
  rng: RngState,
): { intent: Intent; rng: RngState } {
  const def = getArchetype(archetype)
  const kind: IntentKind | undefined = def.pattern[patternIndex % def.pattern.length]
  if (kind === undefined) throw new Error('rollIntent: empty pattern')
  if (kind === 'attack') {
    const [amount, r2] = rollInRange(rng, def.attackRange)
    return { intent: { kind: 'attack', amount }, rng: r2 }
  }
  const [amount, r2] = rollInRange(rng, def.blockRange)
  return { intent: { kind: 'block', amount }, rng: r2 }
}

function rollInRange(rng: RngState, range: IntentRange): [number, RngState] {
  const span = range.max - range.min + 1
  const [delta, next] = nextInt(rng, span)
  return [range.min + delta, next]
}
