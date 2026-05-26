import type { StatusInstance, StatusKind } from '../types'
import { registerStatusTemplate } from '../core/combat/statuses'

// Canonical default magnitudes for each status — "how big is a fresh
// Burn / Vulnerable / Weak / Strength". With the StS pattern (one number),
// stacks is the only field: it decays by 1 each tick. Smolder's onHit
// rider and any future relic that applies a status spread from these
// templates, overriding stacks where the magnitude differs.
// NOTE: Strength does NOT tick down — it sticks until removed. The
// template stacks=2 is used as the default application magnitude.
export const STATUS_TEMPLATES: Record<StatusKind, StatusInstance> = {
  // 2 Burn → ticks 2, then 1 (3 damage total over 2 turns).
  burn: { kind: 'burn', stacks: 2 },
  // Vulnerable / 2 Weak → multiplier active for 2 turns.
  vulnerable: { kind: 'vulnerable', stacks: 2 },
  weak: { kind: 'weak', stacks: 2 },
  // 3 Regen → heals 3, then 2, then 1 (6 HP total over 3 turns).
  // Mirror of Burn's decay. Used by H4a Regenerate spell.
  regen: { kind: 'regen', stacks: 3 },
  // 2 Strength → flat +2 to outgoing attacks. Stacks additively, never ticks.
  strength: { kind: 'strength', stacks: 2 },
}

// Side-effect registration at module load (main.tsx imports this file
// at bootstrap, same pattern as archetypes/spells).
for (const t of Object.values(STATUS_TEMPLATES)) {
  registerStatusTemplate(t)
}

// Display layer for the 3 locked statuses (02-scope). Apply/tick logic
// lives in core/combat/statuses.ts — this file is just metadata the HUD
// reads (icon, name, tooltip) and stays in `content/` so future statuses
// register the same way.

export type StatusDef = {
  id: StatusKind
  name: string
  icon: string
  // Short summary for tooltips. `{stacks}` placeholder is filled by
  // the HUD using the live instance.
  tooltip: string
}

const defs: Record<StatusKind, StatusDef> = {
  burn: {
    id: 'burn',
    name: 'Burn',
    icon: '🔥',
    tooltip:
      'Takes {stacks} damage at the start of each turn, then weakens by 1.',
  },
  vulnerable: {
    id: 'vulnerable',
    name: 'Vulnerable',
    icon: '💢',
    tooltip:
      'Takes 50% extra damage from attacks. {stacks} turns left.',
  },
  weak: {
    id: 'weak',
    name: 'Weak',
    icon: '🪶',
    tooltip:
      'Attacks deal 50% less damage. {stacks} turns left.',
  },
  regen: {
    id: 'regen',
    name: 'Regenerate',
    icon: '🌿',
    tooltip:
      'Heals {stacks} HP at the start of your turn, then weakens by 1.',
  },
  strength: {
    id: 'strength',
    name: 'Strength',
    icon: '🔱',
    tooltip:
      'Attacks deal {stacks} extra damage. Does not decay — sticks until removed.',
  },
}

export function getStatusDef(kind: StatusKind): StatusDef {
  return defs[kind]
}

export function formatStatusTooltip(kind: StatusKind, stacks: number): string {
  return defs[kind].tooltip.replace('{stacks}', String(stacks))
}
