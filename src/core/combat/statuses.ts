import type {
  DamageSource,
  GameEvent,
  StatusInstance,
  StatusKind,
} from '../../types'

// Tile-burn Smolder bonus on top of the cleared-cell count. Keeps a
// 1-cell match meaningful (1 cell → Burn 2 → 3 dmg total) while letting
// the triangle curve scale sharply for multi-cell clears (4 cells →
// Burn 5 → 15 dmg). Lives next to the rest of Burn's mechanics — the
// cascade walker in store.ts reads it, and tuning it here re-balances
// the whole interaction.
export const BURN_FROM_TILE_BONUS = 1

// Apply / re-apply rules (StS pattern — one number per status):
// - Burn / Regen: stacks += incoming.stacks. Each tick deals/heals
//   stacks, then stacks decrements by 1. So Burn 3 deals 3 → 2 → 1
//   (6 total); Regen 3 heals 3 → 2 → 1 the same way. A fresh Burn 2
//   on top of an existing Burn 3 = Burn 5 (5+4+3+2+1=15).
// - Vulnerable / Weak: stacks = max(current, incoming.stacks). The
//   multiplier is binary (active iff stacks > 0); stacks doubles as
//   "turns left", which we refresh to the longer remaining.
export function applyStatusToList(
  list: readonly StatusInstance[],
  incoming: StatusInstance,
): StatusInstance[] {
  const existing = list.find((s) => s.kind === incoming.kind)
  if (!existing) {
    return [...list, { kind: incoming.kind, stacks: incoming.stacks }]
  }
  if (incoming.kind === 'burn' || incoming.kind === 'regen') {
    return list.map((s) =>
      s.kind === incoming.kind
        ? { kind: incoming.kind, stacks: s.stacks + incoming.stacks }
        : s,
    )
  }
  // Vulnerable / Weak: refresh by taking the longer remaining.
  return list.map((s) =>
    s.kind === incoming.kind
      ? { kind: s.kind, stacks: Math.max(s.stacks, incoming.stacks) }
      : s,
  )
}

export type TickResult = {
  statuses: StatusInstance[]
  // Damage to apply to the owner. Burn is the only DoT; routes through
  // the normal damage pipeline (caller calls applyDamage) so block can
  // absorb it and `damage-taken`/`damage-dealt` events fire as usual.
  burnDamage: number
  // Healing to apply to the owner from Regen. Capped at maxHp by the
  // caller (this layer doesn't see hp). Applied AFTER burnDamage so a
  // burn-then-regen pair always resolves damage first, then heal.
  regenHeal: number
  // Lifecycle events. Damage events come from the caller after applying
  // burnDamage through the pipeline — we don't see hp/block here.
  events: GameEvent[]
}

// Tick once at the owner's phase/turn start. For Burn/Regen, capture
// `stacks` as the damage/heal this tick BEFORE decrementing. Then every
// status decrements stacks by 1; statuses at stacks 0 are removed.
// Decay-while-acting is the StS Burn pattern: the same number
// represents intensity and remaining turns simultaneously.
export function tickStatuses(
  ownerTag: 'player' | string,
  statuses: readonly StatusInstance[],
): TickResult {
  const events: GameEvent[] = []
  let burnDamage = 0
  let regenHeal = 0
  const next: StatusInstance[] = []
  for (const s of statuses) {
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

// Content-side default shapes for each status, registered at bootstrap
// from content/statuses.ts. Lets core code apply Burn (or any future
// status) without crossing the content boundary, while content stays
// the single source of truth for "what does a fresh Burn look like".
// Mirrors archetypeRegistry / spellRegistry.
const statusTemplates = new Map<StatusKind, StatusInstance>()

export function registerStatusTemplate(template: StatusInstance): void {
  statusTemplates.set(template.kind, template)
}

export function getStatusTemplate(kind: StatusKind): StatusInstance {
  const t = statusTemplates.get(kind)
  if (!t) throw new Error(`No status template registered for ${kind}`)
  return t
}

// Single source of truth for "is this damage event a status-effect tick
// proc?". Returned StatusKind lets the FX layer route the proc through
// its chip-as-attacker pipeline (particle trail from chip → target,
// per-status SFX, delayed HP drain). Adding a new DoT later (Poison,
// Bleed, etc.) means adding both a DamageSource entry and a case here.
export function statusKindFromDamageSource(
  source: DamageSource,
): StatusKind | null {
  switch (source) {
    case 'burn':
      return 'burn'
    default:
      return null
  }
}

// Compose the multipliers and floor the result. Used by both
// player-attack (red pool damage) and enemy-attack (intent amount)
// paths so the rounding rule (01-design §rounding) lives in one place.
export function composeDamage(
  rawAmount: number,
  sourceStatuses: readonly StatusInstance[],
  targetStatuses: readonly StatusInstance[],
): number {
  if (rawAmount <= 0) return 0
  const m = weakMultiplier(sourceStatuses) * vulnerableMultiplier(targetStatuses)
  return Math.floor(rawAmount * m)
}
