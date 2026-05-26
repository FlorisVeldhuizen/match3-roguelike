import type { EnemyArchetype, IntentKind, StatusKind } from '../../types'

export type IntentRange = { min: number; max: number }

export type OnHitStatusDef = {
  kind: StatusKind
  stacks: number
}

export type ArchetypeDef = {
  id: EnemyArchetype
  name: string
  maxHp: number
  pattern: IntentKind[]
  attackRange: IntentRange
  blockRange: IntentRange
  // Smolder: tile-burn intent flags N cells as burning. Required only
  // for archetypes whose pattern includes 'tile-burn'.
  tileBurnCount?: number
  tileBurnDuration?: number
  // Optional rider on attack intents: applies a status to the player
  // when the attack lands (any hpDamage > 0). Smolder applies Burn.
  onHitStatus?: OnHitStatusDef
  // Ally-support intent ranges. Required for archetypes whose pattern
  // includes the corresponding ally-target kind.
  healAllyRange?: IntentRange
  shieldAllyRange?: IntentRange
  // buff-ally applies a fixed stack count (no range — balance parity with
  // standard status application).
  buffAllyStacks?: number
  // H2b: petrify-row flag lifetime (player phases of matchability lock).
  // Different semantics than smash: counts down each tick and is the
  // *active* effect (no fire-time payload). 2-3 is a meaningful lockout
  // without grinding the fight to a halt.
  petrifyDuration?: number
  // H2c: Caster's color-hex active lifetime. turnsLeft assigned at fire
  // time; decremented once per enemy phase. 2 is the design default —
  // matches petrifyDuration's "active across 2 player phases" cadence.
  colorHexDuration?: number
  // H2c: Caster's per-cell Weak stacks applied when a hexed-colour match
  // resolves. Default 1 (per-cell). Tuning lever — bump to 2 for a
  // harsher caster variant later.
  hexWeakStacksPerCell?: number
  // H2c: Swarmer's cluster-shove source-run length. Default 2.
  clusterShoveLength?: number
}

// Registry pattern (per 03-architecture §11): core can't import from content,
// so content/enemies.ts registers definitions at bootstrap and the combat
// engine looks them up here. Mirrors the relic-registry approach.
const registry = new Map<EnemyArchetype, ArchetypeDef>()

export function registerArchetype(def: ArchetypeDef): void {
  registry.set(def.id, def)
}

export function getArchetype(id: EnemyArchetype): ArchetypeDef {
  const def = registry.get(id)
  if (!def) throw new Error(`Unknown enemy archetype: ${id}`)
  return def
}
