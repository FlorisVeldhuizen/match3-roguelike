import type {
  DamageSource,
  GameEvent,
  StatusInstance,
  StatusKind,
} from '../../types'

// Tile-burn Smolder bonus on top of the cleared-cell count. Keeps a
// 1-cell match meaningful (1 cell → 2 Burn → 3 dmg total) while letting
// the triangle curve scale sharply for multi-cell clears (4 cells →
// 5 Burn → 15 dmg). Lives next to the rest of Burn's mechanics — the
// cascade walker in store.ts reads it, and tuning it here re-balances
// the whole interaction.
export const BURN_FROM_TILE_BONUS = 1

// Apply / re-apply rules (StS pattern — one number per status). All
// kinds stack ADDITIVELY: stacks += incoming.stacks. Switched from
// refresh-max for Vulnerable/Weak in H2c after the Caster hex made the
// refresh feel like a hard cap (3-match → 3 Weak, repeat 3-match →
// still 3 Weak). Additive matches Burn's "the more you take, the
// longer you suffer" intuition and is consistent across all statuses.
//
// Note: the *multipliers* for Vulnerable/Weak are still binary (×1.5 /
// ×0.5, no compound) — only the duration accumulates. Burn/Regen tick
// damage/heal scales with stacks the same as before.
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
      ? { kind: s.kind, stacks: s.stacks + incoming.stacks } as StatusInstance
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
//
// Strength is explicitly excluded from decay — it never ticks down.
// It sticks until removed by an external effect.
export function tickStatuses(
  ownerTag: 'player' | string,
  statuses: readonly StatusInstance[],
): TickResult {
  const events: GameEvent[] = []
  let burnDamage = 0
  let regenHeal = 0
  const next: StatusInstance[] = []
  for (const s of statuses) {
    // Strength does not decay — keep it untouched and emit no tick event.
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
// Narrow return type: only damage-procing statuses ever appear here.
// Regen / Strength / Vulnerable / Weak don't tick damage, so they can't
// be the source of a damage event. Callers (AnimationController, HUD)
// receive a narrowed kind that's directly usable by procPopupTint and
// spawnStatusProcTrail without further refinement.
export function statusKindFromDamageSource(
  source: DamageSource,
): 'burn' | null {
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
//
// Strength applies as a flat additive bonus AFTER the Weak × Vulnerable
// multipliers are floored. This matches 01-design §rounding: floor the
// multiply, then add the flat bonus (no second floor needed — integers).
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
