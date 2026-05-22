import type { RngState } from '../rng/mulberry32'
import type { CombatPhase, Enemy, GameEvent, Player } from '../../types'
import { rollIntent } from './intents'

export type EnemyTurnResult = {
  player: Player
  enemies: Enemy[]
  rng: RngState
  phase: CombatPhase
  events: GameEvent[]
}

// Execute one enemy turn for every living enemy: resolve currentIntent,
// then advance pattern index and roll the *next* intent for telegraphing.
// Returns next phase ('player-acting' or 'game-over' if the player died).
// Caller is responsible for beginPlayerPhase before the next player swap —
// block zeroing happens at the start of the next player phase, AFTER any
// damage absorption that occurred during this enemy turn.
export function executeEnemyTurn(
  player: Player,
  enemies: Enemy[],
  rng: RngState,
): EnemyTurnResult {
  const events: GameEvent[] = []
  let nextPlayer: Player = player
  let nextEnemies: Enemy[] = enemies
  let nextRng = rng

  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue
    if (nextPlayer.hp <= 0) break

    const intent = enemy.currentIntent
    let updatedEnemy: Enemy = enemy

    if (intent.kind === 'attack') {
      const incoming = intent.amount
      const blocked = Math.min(nextPlayer.block, incoming)
      const hpDamage = incoming - blocked
      nextPlayer = {
        ...nextPlayer,
        block: nextPlayer.block - blocked,
        hp: Math.max(0, nextPlayer.hp - hpDamage),
      }
      events.push({
        kind: 'damage-taken',
        amount: hpDamage,
        blocked,
        source: 'enemy-attack',
      })
    } else {
      updatedEnemy = { ...updatedEnemy, block: updatedEnemy.block + intent.amount }
      events.push({
        kind: 'enemy-block-gained',
        enemyId: enemy.id,
        amount: intent.amount,
      })
    }

    // Telegraph next intent for the *next* player phase.
    const nextIndex = enemy.nextIntentIndex + 1
    const rolled = rollIntent(enemy.archetype, nextIndex, nextRng)
    nextRng = rolled.rng
    updatedEnemy = {
      ...updatedEnemy,
      currentIntent: rolled.intent,
      nextIntentIndex: nextIndex,
    }
    events.push({
      kind: 'intent-telegraphed',
      enemyId: enemy.id,
      intent: rolled.intent,
    })

    nextEnemies = nextEnemies.map((e) => (e.id === enemy.id ? updatedEnemy : e))
  }

  const phase: CombatPhase = nextPlayer.hp <= 0 ? 'game-over' : 'player-acting'
  events.push({ kind: 'phase-changed', phase })

  return {
    player: nextPlayer,
    enemies: nextEnemies,
    rng: nextRng,
    phase,
    events,
  }
}
