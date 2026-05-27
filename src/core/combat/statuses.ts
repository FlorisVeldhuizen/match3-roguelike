import type { DamageSource, GameEvent, StatusInstance, StatusKind } from '../../types'

export const BURN_FROM_TILE_BONUS = 1

// All statuses stack additively: stacks += incoming.stacks
export function applyStatusToList(
  list: readonly StatusInstance[],
  incoming: StatusInstance,
): StatusInstance[] {
  const existing = list.find((s) => s.kind === incoming.kind)
  if (!existing) {
    return [...list, { kind: incoming.kind, stacks: incoming.stacks }]
  }
  return list.map((s) =>
    s.kind === incoming.kind
      ? ({ kind: s.kind, stacks: s.stacks + incoming.stacks } as StatusInstance)
      : s,
  )
}

export type TickResult = {
  statuses: StatusInstance[]
  burnDamage: number
  regenHeal: number
  events: GameEvent[]
}

// Strength is excluded from decay — it never ticks down.
export function tickStatuses(
  ownerTag: 'player' | string,
  statuses: readonly StatusInstance[],
): TickResult {
  const events: GameEvent[] = []
  let burnDamage = 0
  let regenHeal = 0
  const next: StatusInstance[] = []
  for (const s of statuses) {
    if (s.kind === 'strength') {
      next.push(s)
      continue
    }
    if (s.kind === 'burn') burnDamage += s.stacks
    if (s.kind === 'regen') regenHeal += s.stacks
    const remaining = s.stacks - 1
    if (remaining > 0) {
      next.push({ kind: s.kind, stacks: remaining })
      events.push({
        kind: 'status-ticked',
        target: ownerTag,
        statusKind: s.kind,
        remaining,
      })
    } else {
      events.push({
        kind: 'status-expired',
        target: ownerTag,
        statusKind: s.kind,
      })
    }
  }
  return { statuses: next, burnDamage, regenHeal, events }
}

export function hasStatus(list: readonly StatusInstance[], kind: StatusKind): boolean {
  return list.some((s) => s.kind === kind)
}

export function weakMultiplier(sourceStatuses: readonly StatusInstance[]): number {
  return hasStatus(sourceStatuses, 'weak') ? 0.5 : 1
}

export function vulnerableMultiplier(targetStatuses: readonly StatusInstance[]): number {
  return hasStatus(targetStatuses, 'vulnerable') ? 1.5 : 1
}

const statusTemplates = new Map<StatusKind, StatusInstance>()

export function registerStatusTemplate(template: StatusInstance): void {
  statusTemplates.set(template.kind, template)
}

export function getStatusTemplate(kind: StatusKind): StatusInstance {
  const t = statusTemplates.get(kind)
  if (!t) throw new Error(`No status template registered for ${kind}`)
  return t
}

export function statusKindFromDamageSource(source: DamageSource): 'burn' | null {
  switch (source) {
    case 'burn':
      return 'burn'
    default:
      return null
  }
}

// Weak (source) ×0.5, Vulnerable (target) ×1.5, then Strength flat bonus
export function composeDamage(
  rawAmount: number,
  sourceStatuses: readonly StatusInstance[],
  targetStatuses: readonly StatusInstance[],
): number {
  if (rawAmount <= 0) return 0
  const m = weakMultiplier(sourceStatuses) * vulnerableMultiplier(targetStatuses)
  const strengthBonus = sourceStatuses.find((s) => s.kind === 'strength')?.stacks ?? 0
  return Math.floor(rawAmount * m) + strengthBonus
}
