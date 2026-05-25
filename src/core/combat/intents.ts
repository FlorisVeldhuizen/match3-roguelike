import { nextInt, type RngState } from '../rng/mulberry32'
import type { Enemy, EnemyArchetype, Intent, IntentKind } from '../../types'
import { getArchetype, type IntentRange } from './archetypeRegistry'

// Roll an intent at a given pattern index. The kind is scripted per archetype
// (deterministic by index); only the numeric value rolls from `rng.enemy`.
// Pattern repeats from the start of every encounter — same intent at same
// turn index regardless of when the player entered (design doc §3).
//
// `livingAllies` is required for ally-target intent kinds ('heal-ally',
// 'buff-ally', 'shield-ally'). The roller picks a target deterministically
// from rng and bakes `targetAllyId` into the intent so it can be telegraphed
// before the intent fires. If no allies are alive when an ally-target kind
// is rolled, the intent falls back to 'attack' (using the archetype's attack
// range) — this prevents a crash in a solo-enemy encounter or when all allies
// died before this turn.
export function rollIntent(
  archetype: EnemyArchetype,
  patternIndex: number,
  rng: RngState,
  // Optional: pass the full enemy list so the roller can pick a target ally.
  // Includes the rolling enemy itself; the roller excludes it by id.
  livingAllies?: Enemy[],
  rollerEnemyId?: string,
): { intent: Intent; rng: RngState } {
  const def = getArchetype(archetype)
  const kind: IntentKind | undefined = def.pattern[patternIndex % def.pattern.length]
  if (kind === undefined) throw new Error('rollIntent: empty pattern')
  if (kind === 'attack') {
    const [amount, r2] = rollInRange(rng, def.attackRange)
    // Carry the archetype's onHitStatus onto the intent itself so the
    // UI can telegraph it (e.g. Smolder's attacks show "⚔ 3 +🔥") and
    // executeEnemyTurn doesn't have to round-trip through the registry.
    const onHit = def.onHitStatus
      ? {
          status: def.onHitStatus.kind,
          stacks: def.onHitStatus.stacks,
        }
      : undefined
    return {
      intent: onHit
        ? { kind: 'attack', amount, onHit }
        : { kind: 'attack', amount },
      rng: r2,
    }
  }
  if (kind === 'block') {
    const [amount, r2] = rollInRange(rng, def.blockRange)
    return { intent: { kind: 'block', amount }, rng: r2 }
  }
  if (kind === 'tile-burn') {
    // tile-burn: no roll — count is fixed per archetype. Cell selection
    // happens at fire time in executeEnemyTurn (it needs the live board).
    const count = def.tileBurnCount ?? 1
    return { intent: { kind: 'tile-burn', count }, rng }
  }

  // --- Ally-target intents ---
  // Pick a target ally from livingAllies (excluding self). Falls back to
  // 'attack' if no sibling allies are alive to avoid crashing a solo encounter.
  if (kind === 'heal-ally' || kind === 'buff-ally' || kind === 'shield-ally') {
    const siblings = (livingAllies ?? []).filter(
      (e) => e.hp > 0 && e.id !== rollerEnemyId,
    )
    if (siblings.length === 0) {
      // Fallback: no allies alive → attack instead.
      // This keeps solo encounters safe when the Rallier is the last one standing.
      const [amount, r2] = rollInRange(rng, def.attackRange)
      const onHit = def.onHitStatus
        ? { status: def.onHitStatus.kind, stacks: def.onHitStatus.stacks }
        : undefined
      return {
        intent: onHit ? { kind: 'attack', amount, onHit } : { kind: 'attack', amount },
        rng: r2,
      }
    }
    // Pick a sibling deterministically from rng.
    const [idx, r2] = nextInt(rng, siblings.length)
    const targetAllyId = siblings[idx]!.id

    if (kind === 'heal-ally') {
      const range = def.healAllyRange ?? { min: 2, max: 4 }
      const [amount, r3] = rollInRange(r2, range)
      return { intent: { kind: 'heal-ally', amount, targetAllyId }, rng: r3 }
    }
    if (kind === 'shield-ally') {
      const range = def.shieldAllyRange ?? { min: 2, max: 4 }
      const [amount, r3] = rollInRange(r2, range)
      return { intent: { kind: 'shield-ally', amount, targetAllyId }, rng: r3 }
    }
    // buff-ally: fixed stacks count, no range roll beyond the sibling pick.
    const stacks = def.buffAllyStacks ?? 2
    return { intent: { kind: 'buff-ally', stacks, targetAllyId }, rng: r2 }
  }

  // Exhaustive guard — every IntentKind must be handled above.
  throw new Error(`rollIntent: unhandled intent kind ${kind as string}`)
}

function rollInRange(rng: RngState, range: IntentRange): [number, RngState] {
  const span = range.max - range.min + 1
  const [delta, next] = nextInt(rng, span)
  return [range.min + delta, next]
}
