import type { Enemy, GameEvent, StatusInstance } from '../../types'
import { applyDamage } from './damage'
import { composeDamage } from './statuses'

// Apply a single match's red-pool damage. AOE matches (T, L, line-5)
// hit every living enemy in left-to-right order; single line-3/4 stays
// on the current target. Per-enemy Vulnerable / Weak compose against
// player.statuses independently — Sharp Edge-style relic modifiers
// already ran on the pool, so the same modified amount fans out.
//
// Callers (the store's match walker today) own relic onEnemyKilled
// hooks and target re-point. This helper just routes the math + emits
// the descriptive events, returning the updated enemies and the ids
// killed by this match for the caller to chain through hooks.
export type AoeRedDamageResult = {
  enemies: Enemy[]
  events: GameEvent[]
  killedIds: string[]
}

// If the current target is dead or missing, return the leftmost living
// enemy's id. Otherwise return the current target unchanged. Single
// source of truth for the "target died → auto-reselect leftmost living"
// rule: the player-attack kill path in attemptSwap, and the post-enemy-
// turn re-point (target died to Thornmail / Burn during the enemy turn).
export function pickNextTarget(
  enemies: readonly Enemy[],
  currentTargetId: string | null,
): string | null {
  if (currentTargetId != null) {
    const cur = enemies.find((e) => e.id === currentTargetId)
    if (cur && cur.hp > 0) return currentTargetId
  }
  const nextLiving = enemies.find((e) => e.hp > 0)
  return nextLiving?.id ?? null
}

export function applyMatchRedDamage(
  enemies: Enemy[],
  targetEnemyId: string | null,
  amount: number,
  playerStatuses: StatusInstance[],
  isAoe: boolean,
): AoeRedDamageResult {
  if (amount <= 0) return { enemies, events: [], killedIds: [] }
  const events: GameEvent[] = []
  const killedIds: string[] = []
  const targetIds: string[] = isAoe
    ? enemies.filter((e) => e.hp > 0).map((e) => e.id)
    : targetEnemyId != null
      ? [targetEnemyId]
      : []
  let working = enemies
  for (const tid of targetIds) {
    const t = working.find((e) => e.id === tid)
    if (!t || t.hp <= 0) continue
    const finalDmg = composeDamage(amount, playerStatuses, t.statuses)
    const res = applyDamage(t.block, t.hp, finalDmg)
    if (res.blocked + res.hpDamage <= 0) continue
    working = working.map((e) =>
      e.id === t.id ? { ...e, block: res.blockAfter, hp: res.hpAfter } : e,
    )
    events.push({
      kind: 'damage-dealt',
      targetId: t.id,
      amount: res.hpDamage,
      blocked: res.blocked,
      source: 'player-attack',
    })
    if (res.blockBroken) {
      events.push({ kind: 'block-broken', targetId: t.id })
    } else if (res.blockAbsorbed) {
      events.push({ kind: 'block-absorbed', targetId: t.id })
    }
    if (res.killed) killedIds.push(t.id)
  }
  return { enemies: working, events, killedIds }
}
