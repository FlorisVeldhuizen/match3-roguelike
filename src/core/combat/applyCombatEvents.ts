import type { Enemy, GameEvent, Player } from '../../types'
import { pickNextTarget } from './aoe'
import { applyDamage } from './damage'
import { applyStatusToList } from './statuses'

export function applyCombatEvents(
  events: readonly GameEvent[],
  player: Player,
  enemies: Enemy[],
  targetEnemyId: string | null,
): {
  player: Player
  enemies: Enemy[]
  targetEnemyId: string | null
  derived: GameEvent[]
} {
  let nextPlayer = player
  let nextEnemies = enemies
  let nextTargetId = targetEnemyId
  const derived: GameEvent[] = []

  for (const ev of events) {
    if (ev.kind === 'damage-dealt' && ev.source === 'relic-effect') {
      const idx = nextEnemies.findIndex((e) => e.id === ev.targetId)
      if (idx < 0) continue
      const enemy = nextEnemies[idx]!
      if (enemy.hp <= 0) continue
      const res = applyDamage(enemy.block, enemy.hp, ev.amount)
      const updated: Enemy = {
        ...enemy,
        block: res.blockAfter,
        hp: res.hpAfter,
      }
      nextEnemies = nextEnemies.map((e) => (e.id === enemy.id ? updated : e))
      if (res.blockBroken) {
        derived.push({ kind: 'block-broken', targetId: enemy.id })
      } else if (res.blockAbsorbed) {
        derived.push({ kind: 'block-absorbed', targetId: enemy.id })
      }
      if (res.killed) {
        derived.push({ kind: 'enemy-killed', enemyId: enemy.id })
        if (enemy.id === nextTargetId) {
          nextTargetId = pickNextTarget(nextEnemies, null)
        }
      }
      continue
    }

    if (ev.kind === 'healed') {
      const before = nextPlayer.hp
      const nextHp = Math.min(nextPlayer.maxHp, nextPlayer.hp + ev.amount)
      if (nextHp > before) {
        nextPlayer = { ...nextPlayer, hp: nextHp }
      }
      continue
    }

    if (ev.kind === 'block-gained') {
      nextPlayer = { ...nextPlayer, block: nextPlayer.block + ev.amount }
      continue
    }

    if (ev.kind === 'status-applied') {
      if (ev.target === 'player') {
        nextPlayer = {
          ...nextPlayer,
          statuses: applyStatusToList(nextPlayer.statuses, ev.status),
        }
      } else {
        nextEnemies = nextEnemies.map((e) =>
          e.id === ev.target
            ? {
                ...e,
                statuses: applyStatusToList(e.statuses, ev.status),
              }
            : e,
        )
      }
    }
  }

  return {
    player: nextPlayer,
    enemies: nextEnemies,
    targetEnemyId: nextTargetId,
    derived,
  }
}
