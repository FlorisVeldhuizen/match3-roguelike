import type {
  CombatPhase,
  Enemy,
  GameEvent,
  Player,
} from '../../types'
import type { PoolDeltas } from './pools'

// Yellow → mana, purple → skill charge credit immediately.
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

// End of player phase. Damage (red) and heal (green) are already committed
// per-match by the store walker; this resolves the still-pooled blue → block.
export function resolveEndOfPhase(
  player: Player,
  enemies: Enemy[],
  targetEnemyId: string | null,
): EndOfPhaseResult {
  const events: GameEvent[] = []
  // Red/green pools tracked here serve as running meters for relics that
  // want to read "how much you dealt/healed this phase". They've already
  // been committed per-match.
  const pools = player.phasePools

  const nextEnemies = enemies
  const nextTargetId = targetEnemyId

  // Block overwrites any prior block from this phase.
  const nextBlock = pools.blue
  if (nextBlock > 0) {
    events.push({ kind: 'block-gained', amount: nextBlock })
  }

  const updatedPlayer: Player = {
    ...player,
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

// Block from previous phase is zeroed — the wall either absorbed the enemy
// hit or didn't, either way it's spent now.
export function beginPlayerPhase(player: Player): Player {
  return {
    ...player,
    block: 0,
    phasePools: { red: 0, blue: 0, green: 0 },
  }
}
