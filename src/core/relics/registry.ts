import type { RelicRarity } from '../../types'
import type { RelicDef } from './types'

// Registry pattern (mirrors spellRegistry / archetypeRegistry):
// content/relics.ts calls registerRelic() at module load; the engine looks
// up RelicDef by id at hook-execution time. Engine never imports content/.

const registry = new Map<string, RelicDef>()

export function registerRelic(def: RelicDef): void {
  registry.set(def.id, def)
}

export function getRelic(id: string): RelicDef {
  const def = registry.get(id)
  if (!def) throw new Error(`Unknown relic: ${id}`)
  return def
}

export function tryGetRelic(id: string): RelicDef | undefined {
  return registry.get(id)
}

export function listRelics(filter?: { rarity?: RelicRarity }): RelicDef[] {
  const all = [...registry.values()]
  if (!filter?.rarity) return all
  return all.filter((r) => r.rarity === filter.rarity)
}
