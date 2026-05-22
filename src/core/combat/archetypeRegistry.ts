import type { EnemyArchetype, IntentKind } from '../../types'

export type IntentRange = { min: number; max: number }

export type ArchetypeDef = {
  id: EnemyArchetype
  name: string
  maxHp: number
  pattern: IntentKind[]
  attackRange: IntentRange
  blockRange: IntentRange
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
