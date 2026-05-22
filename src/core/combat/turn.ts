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

  // Red (damage) and green (heal) are committed per-match by the store
  // walker — the pools tracked here are running meters for relics that
  // want to read "how much you dealt/healed this phase". By the time we
  // get to EOP, the damage/heal have already landed; we only resolve
  // block, which still needs to snap into place *before* the enemy
  // attacks.

  const nextEnemies = enemies
  const nextTargetId = targetEnemyId

  // Block: set to blue pool (any prior block from this phase is overwritten).
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
