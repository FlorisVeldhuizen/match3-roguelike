import { nextInt, type RngState } from '../rng/mulberry32'
import type { Enemy, Intent } from '../../types'
import { BOARD_HEIGHT, BOARD_WIDTH } from '../../types'
import { type ArchetypeDef, type IntentRange } from './archetypeRegistry'

// Per-intent-kind rollers. Each is pure: takes only what it needs (rng,
// archetype def, optional ally list for ally-target kinds) and returns
// the rolled intent + advanced rng. Mirrors the spellResolvers /
// intentResolvers pattern.
//
// Why varying signatures (not a uniform `(def, rng, ctx) => Intent`):
// - 'attack' / 'block' only need rng + def's range
// - 'tile-burn' needs def's tileBurnCount; no rng advance
// - ally intents need the live sibling list + the roller's id
// - 'column-smash' / 'petrify-row' need rng + board dimensions (constants)
// Forcing a single signature would either widen all callers or hide the
// real input shape behind a vague "context" object. Per-kind narrow
// signatures keep the call sites in `rollIntent` honest.

export function rollAttackIntent(
  def: ArchetypeDef,
  rng: RngState,
): { intent: Intent; rng: RngState } {
  const [amount, r2] = rollInRange(rng, def.attackRange)
  // Carry the archetype's onHitStatus onto the intent itself so the
  // UI can telegraph it (e.g. Smolder's attacks show "⚔ 3 +🔥") and
  // executeEnemyTurn doesn't have to round-trip through the registry.
  const onHit = def.onHitStatus
    ? { status: def.onHitStatus.kind, stacks: def.onHitStatus.stacks }
    : undefined
  return {
    intent: onHit
      ? { kind: 'attack', amount, onHit }
      : { kind: 'attack', amount },
    rng: r2,
  }
}

export function rollBlockIntent(
  def: ArchetypeDef,
  rng: RngState,
): { intent: Intent; rng: RngState } {
  const [amount, r2] = rollInRange(rng, def.blockRange)
  return { intent: { kind: 'block', amount }, rng: r2 }
}

export function rollTileBurnIntent(
  def: ArchetypeDef,
  rng: RngState,
): { intent: Intent; rng: RngState } {
  // tile-burn: no roll — count is fixed per archetype. Cell selection
  // happens at fire time in executeEnemyTurn (it needs the live board).
  const count = def.tileBurnCount ?? 1
  return { intent: { kind: 'tile-burn', count }, rng }
}

// Shared logic for the three ally-target kinds. Returns null if no
// sibling is alive — caller (rollIntent) then falls back to attack so
// the rolling enemy still has a turn.
function pickAllySibling(
  livingAllies: readonly Enemy[],
  rollerEnemyId: string | undefined,
  rng: RngState,
): { targetAllyId: string; rng: RngState } | null {
  const siblings = livingAllies.filter(
    (e) => e.hp > 0 && e.id !== rollerEnemyId,
  )
  if (siblings.length === 0) return null
  const [idx, r2] = nextInt(rng, siblings.length)
  return { targetAllyId: siblings[idx]!.id, rng: r2 }
}

export function rollHealAllyIntent(
  def: ArchetypeDef,
  rng: RngState,
  livingAllies: readonly Enemy[],
  rollerEnemyId: string | undefined,
): { intent: Intent; rng: RngState } | null {
  const pick = pickAllySibling(livingAllies, rollerEnemyId, rng)
  if (!pick) return null
  const range = def.healAllyRange ?? { min: 2, max: 4 }
  const [amount, r3] = rollInRange(pick.rng, range)
  return {
    intent: { kind: 'heal-ally', amount, targetAllyId: pick.targetAllyId },
    rng: r3,
  }
}

export function rollShieldAllyIntent(
  def: ArchetypeDef,
  rng: RngState,
  livingAllies: readonly Enemy[],
  rollerEnemyId: string | undefined,
): { intent: Intent; rng: RngState } | null {
  const pick = pickAllySibling(livingAllies, rollerEnemyId, rng)
  if (!pick) return null
  const range = def.shieldAllyRange ?? { min: 2, max: 4 }
  const [amount, r3] = rollInRange(pick.rng, range)
  return {
    intent: { kind: 'shield-ally', amount, targetAllyId: pick.targetAllyId },
    rng: r3,
  }
}

export function rollBuffAllyIntent(
  def: ArchetypeDef,
  rng: RngState,
  livingAllies: readonly Enemy[],
  rollerEnemyId: string | undefined,
): { intent: Intent; rng: RngState } | null {
  const pick = pickAllySibling(livingAllies, rollerEnemyId, rng)
  if (!pick) return null
  // buff-ally: fixed stacks count, no range roll beyond the sibling pick.
  const stacks = def.buffAllyStacks ?? 2
  return {
    intent: { kind: 'buff-ally', stacks, targetAllyId: pick.targetAllyId },
    rng: pick.rng,
  }
}

export function rollColumnSmashIntent(rng: RngState): {
  intent: Intent
  rng: RngState
} {
  const [column, r2] = nextInt(rng, BOARD_WIDTH)
  return { intent: { kind: 'column-smash', column }, rng: r2 }
}

export function rollPetrifyRowIntent(rng: RngState): {
  intent: Intent
  rng: RngState
} {
  const [row, r2] = nextInt(rng, BOARD_HEIGHT)
  return { intent: { kind: 'petrify-row', row }, rng: r2 }
}

function rollInRange(rng: RngState, range: IntentRange): [number, RngState] {
  const span = range.max - range.min + 1
  const [delta, next] = nextInt(rng, span)
  return [range.min + delta, next]
}
