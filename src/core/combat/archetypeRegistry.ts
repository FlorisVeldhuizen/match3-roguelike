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
  tileBurnCount?: number
  tileBurnDuration?: number
  onHitStatus?: OnHitStatusDef
  healAllyRange?: IntentRange
  shieldAllyRange?: IntentRange
  buffAllyStacks?: number
  petrifyDuration?: number
  colorHexDuration?: number
  hexWeakStacksPerCell?: number
  clusterShoveLength?: number
  // Enrage: alternate pattern when HP drops below threshold (default 50%).
  enragePattern?: IntentKind[]
  enrageThreshold?: number
  // Leech: color-drain intent lifetime (player phases).
  colorDrainDuration?: number
  // Shade: fraction of HP damage dealt that heals the attacker (0-1).
  onHitSelfHeal?: number
}

const registry = new Map<EnemyArchetype, ArchetypeDef>()

export function registerArchetype(def: ArchetypeDef): void {
  registry.set(def.id, def)
}

export function getArchetype(id: EnemyArchetype): ArchetypeDef {
  const def = registry.get(id)
  if (!def) throw new Error(`Unknown enemy archetype: ${id}`)
  return def
}
