import type { ReactNode } from 'react'
import type {
  ManaCost,
  PendingSpellId,
  SpellId,
  SpellResolution,
  UltimateId,
} from '../../types'

export type SpellDef = {
  id: SpellId
  name: string
  icon: string
  cost: ManaCost
  description: ReactNode
  resolution: SpellResolution
  pendingLabel: string
  pendingDescription: ReactNode
  starter?: boolean
}

export type UltimateDef = {
  id: UltimateId
  name: string
  icon: string
  chargeCost: number
  description: ReactNode
  pendingLabel: string
  pendingDescription: ReactNode
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

export function listSpellsForTray(
  ownedIds: readonly string[],
  unlockAll: boolean,
): SpellDef[] {
  if (unlockAll) return listSpells()
  const owned = new Set(ownedIds)
  return [...spellRegistry.values()].filter((s) => owned.has(s.id))
}

export function listUltimates(): UltimateDef[] {
  return [...ultimateRegistry.values()]
}

export function isUltimateId(id: PendingSpellId): id is UltimateId {
  return ultimateRegistry.has(id as UltimateId)
}

export type PendingMeta = {
  name: string
  icon: string
  pendingLabel: string
  pendingDescription: ReactNode
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
