import type { PendingSpellId, SpellId, UltimateId } from '../../types'

// Registry pattern (mirrors archetypeRegistry): content/ bootstraps the
// player class's spell defs at app start; combat engine looks them up
// without crossing the core→content boundary.

export type SpellDef = {
  id: SpellId
  name: string
  icon: string
  manaCost: number
  description: string
}

export type UltimateDef = {
  id: UltimateId
  name: string
  icon: string
  chargeCost: number
  description: string
}

const spellRegistry = new Map<SpellId, SpellDef>()
const ultimateRegistry = new Map<UltimateId, UltimateDef>()

export function registerSpell(def: SpellDef): void {
  spellRegistry.set(def.id, def)
}

export function registerUltimate(def: UltimateDef): void {
  ultimateRegistry.set(def.id, def)
}

export function getSpell(id: SpellId): SpellDef {
  const def = spellRegistry.get(id)
  if (!def) throw new Error(`Unknown spell: ${id}`)
  return def
}

export function getUltimate(id: UltimateId): UltimateDef {
  const def = ultimateRegistry.get(id)
  if (!def) throw new Error(`Unknown ultimate: ${id}`)
  return def
}

export function listSpells(): SpellDef[] {
  return [...spellRegistry.values()]
}

export function listUltimates(): UltimateDef[] {
  return [...ultimateRegistry.values()]
}

export function isUltimateId(id: PendingSpellId): id is UltimateId {
  return ultimateRegistry.has(id as UltimateId)
}
