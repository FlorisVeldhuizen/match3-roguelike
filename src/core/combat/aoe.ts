import type { Enemy, GameEvent, StatusInstance } from '../../types'
import { applyDamage } from './damage'
import { composeDamage } from './statuses'

export type AoeRedDamageResult = {
  enemies: Enemy[]
  events: GameEvent[]
  killedIds: string[]
}

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
