import type {
  CombatPhase,
  Enemy,
  GameEvent,
  Player,
} from '../../types'
import type { PoolDeltas } from './pools'
import { applyDamage } from './damage'
import { composeDamage, tickStatuses } from './statuses'
import { interceptFatalDamage, snapshotOf } from '../relics/engine'

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
// per-match by the store walker; this resolves the still-pooled blue pool
// per Bulwark/Reinforce rules, then transitions to the enemy turn.
//
// Pending-spell precedence (01-design §Spells):
// - Bulwark wins: blue pool → attack at floor(blue/2), block becomes 0.
//   Reinforce, if also queued, doubles zero — wasted, no refund.
// - Reinforce without Bulwark: block becomes (blue × 2).
// - Neither queued: block = blue (the default).
//
// Riposte stays in pendingSpells across the enemy turn (it triggers on
// incoming attacks); Bulwark/Reinforce are cleared here.
export function resolveEndOfPhase(
  player: Player,
  enemies: Enemy[],
  targetEnemyId: string | null,
): EndOfPhaseResult {
  const events: GameEvent[] = []
  const pools = player.phasePools

  let nextEnemies = enemies
  let nextTargetId = targetEnemyId

  const hasBulwark = player.pendingSpells.includes('bulwark')
  const hasReinforce = player.pendingSpells.includes('reinforce')

  let nextBlock = pools.blue
  if (hasBulwark) {
    nextBlock = 0
    const rawAttack = Math.floor(pools.blue / 2)
    const target =
      targetEnemyId != null
        ? nextEnemies.find((e) => e.id === targetEnemyId && e.hp > 0)
        : undefined
    if (rawAttack > 0 && target) {
      const dmg = composeDamage(rawAttack, player.statuses, target.statuses)
      const res = applyDamage(target.block, target.hp, dmg)
      if (res.blocked + res.hpDamage > 0) {
        nextEnemies = nextEnemies.map((e) =>
          e.id === target.id
            ? { ...e, block: res.blockAfter, hp: res.hpAfter }
            : e,
        )
        events.push({
          kind: 'damage-dealt',
          targetId: target.id,
          amount: res.hpDamage,
          blocked: res.blocked,
          source: 'player-attack',
        })
        if (res.blockBroken) {
          events.push({ kind: 'block-broken', targetId: target.id })
        } else if (res.blockAbsorbed) {
          events.push({ kind: 'block-absorbed', targetId: target.id })
        }
        if (res.killed) {
          events.push({ kind: 'enemy-killed', enemyId: target.id })
          const nextLiving = nextEnemies.find(
            (e) => e.id !== target.id && e.hp > 0,
          )
          nextTargetId = nextLiving?.id ?? null
        }
      }
    }
    events.push({ kind: 'pending-effect-resolved', spellId: 'bulwark' })
  } else if (hasReinforce) {
    nextBlock = pools.blue * 2
  }
  if (hasReinforce) {
    events.push({ kind: 'pending-effect-resolved', spellId: 'reinforce' })
  }

  if (nextBlock > 0) {
    events.push({ kind: 'block-gained', amount: nextBlock })
  }

  const nextPending = player.pendingSpells.filter(
    (id) => id !== 'bulwark' && id !== 'reinforce',
  )

  const updatedPlayer: Player = {
    ...player,
    block: nextBlock,
    phasePools: { red: 0, blue: 0, green: 0 },
    pendingSpells: nextPending,
    // Reinforce queues a one-shot block carry-over for the next phase
    // (01-design §Reinforce): normal "block zeros at next phase start"
    // is overridden once.
    carryBlockNextPhase: hasReinforce ? true : player.carryBlockNextPhase,
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

export type PlayerPhaseBeginResult = {
  player: Player
  events: GameEvent[]
  phase: CombatPhase
}

// Statuses tick once here: Burn routes through applyDamage so any block
// that survived the enemy turn (carryBlockNextPhase, or just the wall
// that absorbed the enemy hit and hasn't been zeroed yet) eats the burn
// first — armor protects from fire too. After the tick, block is zeroed
// (the wall is spent), unless Reinforce's carryBlockNextPhase flag is
// set. If Burn kills the player, returns phase='game-over'.
// Stoneheart needs to see lethal damage from any source, including burn
// ticks at phase start, so the engine fatal-intercept call lives here.
// `enemies` + `targetEnemyId` are passed through purely so the engine's
// snapshot is accurate (relics may read enemies); they're not mutated.
export function beginPlayerPhase(
  player: Player,
  enemies: readonly Enemy[] = [],
  targetEnemyId: string | null = null,
): PlayerPhaseBeginResult {
  const events: GameEvent[] = []
  const ticked = tickStatuses('player', player.statuses)

  // Event order matters for the FX layer: emit `damage-taken` (+ the
  // block-broken/absorbed sub-events) BEFORE the status-ticked /
  // status-expired events. That way the chip → HP particle trail spawns
  // while the status chip is still mounted in the UI; any chip-removing
  // expiry plays after the trail is already in flight.
  let hp = player.hp
  let block = player.block
  let relics = player.relics
  if (ticked.burnDamage > 0 && hp > 0) {
    const res = applyDamage(block, hp, ticked.burnDamage)
    let finalHp = res.hpAfter
    // Stoneheart (and any future on-fatal relic): if burn would kill,
    // give the chain a chance to pin HP to a floor.
    if (res.killed) {
      const snap = snapshotOf(player, enemies, targetEnemyId, 0)
      const writeRelics = relics.map((r) => ({
        ...r,
        runFlags: { ...r.runFlags },
        fightFlags: { ...r.fightFlags },
      }))
      const intercept = interceptFatalDamage(
        { incoming: ticked.burnDamage, source: 'burn' },
        writeRelics,
        snap,
      )
      if (intercept.result) {
        finalHp = intercept.result.hpFloor
        relics = writeRelics
        events.push(...intercept.events)
      }
    }
    hp = finalHp
    block = res.blockAfter
    events.push({
      kind: 'damage-taken',
      amount: res.hpDamage,
      blocked: res.blocked,
      source: 'burn',
    })
    if (res.blockBroken) {
      events.push({ kind: 'block-broken', targetId: 'player' })
    } else if (res.blockAbsorbed) {
      events.push({ kind: 'block-absorbed', targetId: 'player' })
    }
  }
  events.push(...ticked.events)

  const phase: CombatPhase = hp <= 0 ? 'game-over' : 'player-acting'
  // Reinforce's one-shot carry-over: keep whatever block survived the
  // enemy turn (already doubled at EOP) AND the burn tick above; clear
  // the flag so the next phase end zeros block normally.
  const carrying = player.carryBlockNextPhase
  return {
    player: {
      ...player,
      hp,
      block: carrying ? block : 0,
      phasePools: { red: 0, blue: 0, green: 0 },
      statuses: ticked.statuses,
      carryBlockNextPhase: false,
      relics,
    },
    events,
    phase,
  }
}
