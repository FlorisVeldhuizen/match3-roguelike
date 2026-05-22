import type {
  CombatPhase,
  Enemy,
  GameEvent,
  Player,
} from '../../types'
import type { PoolDeltas } from './pools'

// Apply per-swap pool deltas to the player.
// Yellow → mana, purple → skill charge: both credit IMMEDIATELY (architecture §1).
// Red/blue/green accumulate in phasePools and resolve at end of player phase.
export function applyPoolDeltas(player: Player, deltas: PoolDeltas): Player {
  return {
    ...player,
    mana: player.mana + deltas.yellow,
    skillCharge: player.skillCharge + deltas.purple,
    phasePools: {
      red: player.phasePools.red + deltas.red,
      blue: player.phasePools.blue + deltas.blue,
      green: player.phasePools.green + deltas.green,
    },
  }
}

export type EndOfPhaseResult = {
  player: Player
  enemies: Enemy[]
  targetEnemyId: string | null
  phase: CombatPhase
  events: GameEvent[]
}

// Resolve end-of-player-phase: red → damage to target, blue → block, green → heal.
// Fires once per phase regardless of how many swaps/extra-turns rolled into it.
// Phase D scope only — no enemy intent or status processing.
export function resolveEndOfPhase(
  player: Player,
  enemies: Enemy[],
  targetEnemyId: string | null,
): EndOfPhaseResult {
  const events: GameEvent[] = []
  const pools = player.phasePools

  // Heal (capped at maxHp).
  let nextHp = player.hp
  if (pools.green > 0) {
    nextHp = Math.min(player.maxHp, player.hp + pools.green)
    const healed = nextHp - player.hp
    if (healed > 0) events.push({ kind: 'healed', amount: healed })
  }

  // Block: set to blue pool (any prior block from this phase is overwritten).
  const nextBlock = pools.blue
  if (nextBlock > 0) {
    events.push({ kind: 'block-gained', amount: nextBlock })
  }

  // Damage to currently targeted enemy.
  let nextEnemies = enemies
  let nextTargetId = targetEnemyId
  if (pools.red > 0 && nextTargetId) {
    const target = enemies.find((e) => e.id === nextTargetId)
    if (target && target.hp > 0) {
      const dmg = Math.min(target.hp, pools.red)
      nextEnemies = enemies.map((e) =>
        e.id === target.id ? { ...e, hp: e.hp - dmg } : e,
      )
      events.push({
        kind: 'damage-dealt',
        targetId: target.id,
        amount: dmg,
        source: 'player-attack',
      })
      const after = nextEnemies.find((e) => e.id === target.id)
      if (after && after.hp <= 0) {
        events.push({ kind: 'enemy-killed', enemyId: target.id })
        // Auto-select next living enemy (leftmost in array order).
        const nextLiving = nextEnemies.find(
          (e) => e.id !== target.id && e.hp > 0,
        )
        nextTargetId = nextLiving?.id ?? null
      }
    }
  }

  const updatedPlayer: Player = {
    ...player,
    hp: nextHp,
    block: nextBlock,
    phasePools: { red: 0, blue: 0, green: 0 },
  }

  const anyAlive = nextEnemies.some((e) => e.hp > 0)
  const nextPhase: CombatPhase = anyAlive ? 'enemy-acting' : 'victory'

  events.push({ kind: 'turn-ended' })
  events.push({ kind: 'phase-changed', phase: nextPhase })

  return {
    player: updatedPlayer,
    enemies: nextEnemies,
    targetEnemyId: nextTargetId,
    phase: nextPhase,
    events,
  }
}

// Start of a new player phase: block from previous phase is zeroed (the wall
// either absorbed the enemy hit or didn't — either way it's spent now), and
// phasePools start clean. Resolute and other phase-start hooks land here in
// Phase F.
export function beginPlayerPhase(player: Player): Player {
  return {
    ...player,
    block: 0,
    phasePools: { red: 0, blue: 0, green: 0 },
  }
}
