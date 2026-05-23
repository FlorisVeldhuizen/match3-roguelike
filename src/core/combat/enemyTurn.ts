import type { RngState } from '../rng/mulberry32'
import type { CombatPhase, Enemy, GameEvent, Player } from '../../types'
import { rollIntent } from './intents'
import { applyDamage } from './damage'

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
//
// Block intent is pre-applied at telegraph time (here for subsequent turns,
// in freshFight for the initial intent) so the enemy is already guarded
// when the player swaps. Processing a `block` currentIntent below is a
// no-op — the block already went up at the end of the previous turn.
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
      const res = applyDamage(nextPlayer.block, nextPlayer.hp, intent.amount)
      nextPlayer = {
        ...nextPlayer,
        block: res.blockAfter,
        hp: res.hpAfter,
      }
      events.push({
        kind: 'damage-taken',
        amount: res.hpDamage,
        blocked: res.blocked,
        source: 'enemy-attack',
      })
      if (res.blockBroken) {
        events.push({ kind: 'block-broken', targetId: 'player' })
      } else if (res.blockAbsorbed) {
        events.push({ kind: 'block-absorbed', targetId: 'player' })
      }
    } else if (intent.kind === 'block' && enemy.block === 0) {
      // Block intent + broken shield = "Staggered". The block already went
      // up at the previous telegraph; we don't take a second action here,
      // but we surface the recovery so the empty turn reads as a reward
      // for breaking the guard rather than a dead beat.
      events.push({ kind: 'enemy-staggered', enemyId: enemy.id })
    }

    // Telegraph next intent for the *next* player phase. If it's a block
    // intent, apply the block now so it's already in place when the player
    // attacks during their next phase.
    const nextIndex = enemy.nextIntentIndex + 1
    const rolled = rollIntent(enemy.archetype, nextIndex, nextRng)
    nextRng = rolled.rng
    let updatedBlock = updatedEnemy.block
    if (rolled.intent.kind === 'block') {
      updatedBlock = updatedBlock + rolled.intent.amount
      events.push({
        kind: 'enemy-block-gained',
        enemyId: enemy.id,
        amount: rolled.intent.amount,
      })
    }
    updatedEnemy = {
      ...updatedEnemy,
      block: updatedBlock,
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
