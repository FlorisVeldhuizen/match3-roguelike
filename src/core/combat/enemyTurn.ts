import type { RngState } from '../rng/mulberry32'
import type { CombatPhase, Enemy, GameEvent, Player } from '../../types'
import { rollIntent } from './intents'
import { applyDamage } from './damage'
import { composeDamage, tickStatuses } from './statuses'

export type EnemyTurnResult = {
  player: Player
  enemies: Enemy[]
  rng: RngState
  phase: CombatPhase
  events: GameEvent[]
}

// Execute one enemy turn for every living enemy: tick statuses, resolve
// currentIntent (or have Riposte parry it), then advance pattern index
// and roll the *next* intent for telegraphing. Returns next phase
// ('player-acting' or 'game-over' if the player died). Caller is
// responsible for beginPlayerPhase before the next player swap — block
// zeroing happens at the start of the next player phase, AFTER any damage
// absorption that occurred during this enemy turn.
//
// Block intent is pre-applied at telegraph time (here for subsequent turns,
// in freshFight for the initial intent) so the enemy is already guarded
// when the player swaps. Processing a `block` currentIntent below is a
// no-op — the block already went up at the end of the previous turn.
//
// Riposte: if player.pendingSpells includes 'riposte' and the enemy's
// current intent is an attack, the attack is parried (player takes 0
// damage) and the full pre-block intent amount is dealt back to the
// attacking enemy. Consumes Riposte. If no attack came across the whole
// enemy turn, Riposte expires unused at the end of the turn.
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

    // Status tick at start of this enemy's turn (02-scope §Tick granularity).
    const ticked = tickStatuses(enemy.id, enemy.statuses)
    events.push(...ticked.events)
    let workingEnemy: Enemy = { ...enemy, statuses: ticked.statuses }
    if (ticked.burnDamage > 0 && workingEnemy.hp > 0) {
      const before = workingEnemy.hp
      const hpAfter = Math.max(0, before - ticked.burnDamage)
      const dealt = before - hpAfter
      workingEnemy = { ...workingEnemy, hp: hpAfter }
      events.push({
        kind: 'damage-dealt',
        targetId: workingEnemy.id,
        amount: dealt,
        blocked: 0,
        source: 'burn',
      })
      if (hpAfter === 0) {
        events.push({ kind: 'enemy-killed', enemyId: workingEnemy.id })
      }
    }

    nextEnemies = nextEnemies.map((e) =>
      e.id === workingEnemy.id ? workingEnemy : e,
    )

    if (workingEnemy.hp <= 0) {
      continue
    }

    const intent = workingEnemy.currentIntent
    let updatedEnemy: Enemy = workingEnemy

    if (intent.kind === 'attack') {
      const riposteArmed = nextPlayer.pendingSpells.includes('riposte')
      if (riposteArmed) {
        // Parry: player takes 0, counter for full pre-block intent amount.
        // Damage routes through the enemy's block via applyDamage; the
        // "pre-block" wording in spec refers to the incoming attack's
        // pre-player-block amount, not pre-enemy-block.
        const res = applyDamage(updatedEnemy.block, updatedEnemy.hp, intent.amount)
        if (res.blocked + res.hpDamage > 0) {
          updatedEnemy = {
            ...updatedEnemy,
            block: res.blockAfter,
            hp: res.hpAfter,
          }
          events.push({
            kind: 'riposte-counter',
            targetId: updatedEnemy.id,
            amount: intent.amount,
          })
          events.push({
            kind: 'damage-dealt',
            targetId: updatedEnemy.id,
            amount: res.hpDamage,
            blocked: res.blocked,
            source: 'riposte',
          })
          if (res.blockBroken) {
            events.push({ kind: 'block-broken', targetId: updatedEnemy.id })
          } else if (res.blockAbsorbed) {
            events.push({ kind: 'block-absorbed', targetId: updatedEnemy.id })
          }
          if (res.killed) {
            events.push({ kind: 'enemy-killed', enemyId: updatedEnemy.id })
          }
        }
        nextPlayer = {
          ...nextPlayer,
          pendingSpells: nextPlayer.pendingSpells.filter((id) => id !== 'riposte'),
        }
        events.push({ kind: 'pending-effect-resolved', spellId: 'riposte' })
      } else {
        const finalDamage = composeDamage(
          intent.amount,
          updatedEnemy.statuses,
          nextPlayer.statuses,
        )
        const res = applyDamage(nextPlayer.block, nextPlayer.hp, finalDamage)
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
      }
    } else if (intent.kind === 'block' && updatedEnemy.block === 0) {
      // Block intent + broken shield = "Staggered". The block already went
      // up at the previous telegraph; we don't take a second action here,
      // but we surface the recovery so the empty turn reads as a reward
      // for breaking the guard rather than a dead beat.
      events.push({ kind: 'enemy-staggered', enemyId: updatedEnemy.id })
    }

    // Telegraph next intent for the *next* player phase. If it's a block
    // intent, apply the block now so it's already in place when the player
    // attacks during their next phase. Skip if this enemy just died.
    if (updatedEnemy.hp > 0) {
      const nextIndex = updatedEnemy.nextIntentIndex + 1
      const rolled = rollIntent(updatedEnemy.archetype, nextIndex, nextRng)
      nextRng = rolled.rng
      let updatedBlock = updatedEnemy.block
      if (rolled.intent.kind === 'block') {
        updatedBlock = updatedBlock + rolled.intent.amount
        events.push({
          kind: 'enemy-block-gained',
          enemyId: updatedEnemy.id,
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
        enemyId: updatedEnemy.id,
        intent: rolled.intent,
      })
    }

    nextEnemies = nextEnemies.map((e) =>
      e.id === updatedEnemy.id ? updatedEnemy : e,
    )
  }

  // Riposte expires unused at the end of the enemy turn if no attack came.
  if (nextPlayer.pendingSpells.includes('riposte')) {
    nextPlayer = {
      ...nextPlayer,
      pendingSpells: nextPlayer.pendingSpells.filter((id) => id !== 'riposte'),
    }
    events.push({ kind: 'pending-effect-resolved', spellId: 'riposte' })
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
