import type { StatusKind } from '../types'

// Display layer for the 3 locked statuses (02-scope). Apply/tick logic
// lives in core/combat/statuses.ts — this file is just metadata the HUD
// reads (icon, name, tooltip) and stays in `content/` so future statuses
// register the same way.

export type StatusDef = {
  id: StatusKind
  name: string
  icon: string
  // Short summary for tooltips. `{stacks}` / `{duration}` placeholders
  // are filled by the HUD using the live instance.
  tooltip: string
}

const defs: Record<StatusKind, StatusDef> = {
  burn: {
    id: 'burn',
    name: 'Burn',
    icon: '🔥',
    tooltip:
      'Deals {stacks} damage at the start of your turn. {duration} turns left.',
  },
  vulnerable: {
    id: 'vulnerable',
    name: 'Vulnerable',
    icon: '💢',
    tooltip:
      'Takes 50% more damage from attacks. {duration} turns left.',
  },
  weak: {
    id: 'weak',
    name: 'Weak',
    icon: '🪶',
    tooltip:
      'Deals 50% less damage with attacks. {duration} turns left.',
  },
}

export function getStatusDef(kind: StatusKind): StatusDef {
  return defs[kind]
}

export function formatStatusTooltip(
  kind: StatusKind,
  stacks: number,
  duration: number,
): string {
  return defs[kind].tooltip
    .replace('{stacks}', String(stacks))
    .replace('{duration}', String(duration))
}
