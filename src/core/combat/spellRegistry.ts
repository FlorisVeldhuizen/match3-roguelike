import type { PendingSpellId, SpellId, UltimateId } from '../../types'

// Registry pattern (mirrors archetypeRegistry): content/ bootstraps the
// player class's spell defs at app start; combat engine looks them up
// without crossing the core→content boundary.
//
// Each def is the **single source of truth** for that spell — name, icon,
// cost, full description, short pending-state label, short pending-state
// description. UI (SpellTray button, PendingStrip pip, future battle log)
// reads from here so descriptions never drift across surfaces.

export type SpellDef = {
  id: SpellId
  name: string
  icon: string
  manaCost: number
  description: string
  // Short verb shown next to the name when this spell sits in the
  // pending strip (e.g. "queued" — "Bulwark — queued").
  pendingLabel: string
  // Short description shown in the pending-strip tooltip. Distinct from
  // `description` because once a spell is queued, the player only needs
  // to be reminded of *what's about to happen*, not how to cast it.
  pendingDescription: string
}

export type UltimateDef = {
  id: UltimateId
  name: string
  icon: string
  chargeCost: number
  description: string
  pendingLabel: string
  pendingDescription: string
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

// PendingStrip / battle log: look up display metadata for any cast-and-
// pending entry without branching on spell-vs-ultimate at the call site.
export type PendingMeta = {
  name: string
  icon: string
  pendingLabel: string
  pendingDescription: string
}

export function getPendingMeta(id: PendingSpellId): PendingMeta {
  if (isUltimateId(id)) {
    const def = getUltimate(id)
    return {
      name: def.name,
      icon: def.icon,
      pendingLabel: def.pendingLabel,
      pendingDescription: def.pendingDescription,
    }
  }
  const def = getSpell(id as SpellId)
  return {
    name: def.name,
    icon: def.icon,
    pendingLabel: def.pendingLabel,
    pendingDescription: def.pendingDescription,
  }
}
