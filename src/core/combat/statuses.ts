import type {
  GameEvent,
  StatusInstance,
  StatusKind,
} from '../../types'

// Apply / re-apply rules (02-scope §Status effects):
// - Burn: stacks += new.stacks; duration = max(current, new).
// - Vulnerable, Weak: refresh duration only. Multiplier does not stack —
//   stacks stay clamped at 1 so the multiplier is binary on/off.
//
// All three share the same {stacks, duration} shape — the apply rule keys
// off `kind`, not the shape.
export function applyStatusToList(
  list: readonly StatusInstance[],
  incoming: StatusInstance,
): StatusInstance[] {
  const existing = list.find((s) => s.kind === incoming.kind)
  if (!existing) {
    const stacks =
      incoming.kind === 'burn' ? incoming.stacks : Math.min(1, incoming.stacks)
    return [...list, { kind: incoming.kind, stacks, duration: incoming.duration }]
  }
  if (incoming.kind === 'burn') {
    return list.map((s) =>
      s.kind === 'burn'
        ? {
            kind: 'burn',
            stacks: s.stacks + incoming.stacks,
            duration: Math.max(s.duration, incoming.duration),
          }
        : s,
    )
  }
  // Vulnerable / Weak: refresh duration; stacks stays at 1.
  return list.map((s) =>
    s.kind === incoming.kind
      ? {
          kind: s.kind,
          stacks: 1,
          duration: Math.max(s.duration, incoming.duration),
        }
      : s,
  )
}

export type TickResult = {
  statuses: StatusInstance[]
  // Damage to apply to the owner. Burn is the only DoT; routes through
  // the normal damage pipeline (caller calls applyDamage) so block can
  // absorb it and `damage-taken`/`damage-dealt` events fire as usual.
  burnDamage: number
  // Lifecycle events. Damage events come from the caller after applying
  // burnDamage through the pipeline — we don't see hp/block here.
  events: GameEvent[]
}

// Tick once at the owner's phase/turn start. Burn deals `stacks` damage,
// then every status decrements duration by 1; statuses at duration 0 are
// removed.
export function tickStatuses(
  ownerTag: 'player' | string,
  statuses: readonly StatusInstance[],
): TickResult {
  const events: GameEvent[] = []
  let burnDamage = 0
  const next: StatusInstance[] = []
  for (const s of statuses) {
    if (s.kind === 'burn') burnDamage += s.stacks
    const remaining = s.duration - 1
    if (remaining > 0) {
      next.push({ kind: s.kind, stacks: s.stacks, duration: remaining })
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
  return { statuses: next, burnDamage, events }
}

export function hasStatus(
  list: readonly StatusInstance[],
  kind: StatusKind,
): boolean {
  return list.some((s) => s.kind === kind)
}

// Outgoing damage from a source with Weak: ×0.5 (floor).
// Incoming damage on a target with Vulnerable: ×1.5 (floor).
// Both are binary because Vulnerable/Weak don't stack their multipliers.
// Order: Weak (source) → Vulnerable (target). Apply via composeDamage().
export function weakMultiplier(sourceStatuses: readonly StatusInstance[]): number {
  return hasStatus(sourceStatuses, 'weak') ? 0.5 : 1
}

export function vulnerableMultiplier(
  targetStatuses: readonly StatusInstance[],
): number {
  return hasStatus(targetStatuses, 'vulnerable') ? 1.5 : 1
}

// Compose the multipliers and floor the result. Used by both
// player-attack (red pool damage) and enemy-attack (intent amount) paths
// so the rounding rule (01-design §rounding) lives in one place.
export function composeDamage(
  rawAmount: number,
  sourceStatuses: readonly StatusInstance[],
  targetStatuses: readonly StatusInstance[],
): number {
  if (rawAmount <= 0) return 0
  const m = weakMultiplier(sourceStatuses) * vulnerableMultiplier(targetStatuses)
  return Math.floor(rawAmount * m)
}
