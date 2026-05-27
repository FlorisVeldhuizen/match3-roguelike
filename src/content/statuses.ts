import type { StatusInstance, StatusKind } from '../types'
import { registerStatusTemplate } from '../core/combat/statuses'

// Strength does NOT tick down — sticks until removed
export const STATUS_TEMPLATES: Record<StatusKind, StatusInstance> = {
  burn: { kind: 'burn', stacks: 2 },
  vulnerable: { kind: 'vulnerable', stacks: 2 },
  weak: { kind: 'weak', stacks: 2 },
  regen: { kind: 'regen', stacks: 3 },
  strength: { kind: 'strength', stacks: 2 },
}

for (const t of Object.values(STATUS_TEMPLATES)) {
  registerStatusTemplate(t)
}

export type StatusDef = {
  id: StatusKind
  name: string
  icon: string
  tooltip: string
}

const defs: Record<StatusKind, StatusDef> = {
  burn: {
    id: 'burn',
    name: 'Burn',
    icon: '🔥',
    tooltip: 'Takes {stacks} damage at the start of each turn, then weakens by 1.',
  },
  vulnerable: {
    id: 'vulnerable',
    name: 'Vulnerable',
    icon: '💢',
    tooltip: 'Takes 50% extra damage from attacks. {stacks} turns left.',
  },
  weak: {
    id: 'weak',
    name: 'Weak',
    icon: '🪶',
    tooltip: 'Attacks deal 50% less damage. {stacks} turns left.',
  },
  regen: {
    id: 'regen',
    name: 'Regenerate',
    icon: '🌿',
    tooltip: 'Heals {stacks} HP at the start of your turn, then weakens by 1.',
  },
  strength: {
    id: 'strength',
    name: 'Strength',
    icon: '🔱',
    tooltip: 'Attacks deal {stacks} extra damage. Does not decay — sticks until removed.',
  },
}

export function getStatusDef(kind: StatusKind): StatusDef {
  return defs[kind]
}

export function formatStatusTooltip(kind: StatusKind, stacks: number): string {
  return defs[kind].tooltip.replace('{stacks}', String(stacks))
}
