import type { EnemyArchetype, IntentKind, StatusKind } from '../../types'

export type IntentRange = { min: number; max: number }

export type OnHitStatusDef = {
  kind: StatusKind
  stacks: number
  duration: number
}

export type ArchetypeDef = {
  id: EnemyArchetype
  name: string
  maxHp: number
  pattern: IntentKind[]
  attackRange: IntentRange
  blockRange: IntentRange
  // Bleeder: tile-burn intent flags N cells as burning. Required only
  // for archetypes whose pattern includes 'tile-burn'.
  tileBurnCount?: number
  tileBurnDuration?: number
  // Optional rider on attack intents: applies a status to the player
  // when the attack lands (any hpDamage > 0). Bleeder applies Burn.
  onHitStatus?: OnHitStatusDef
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
