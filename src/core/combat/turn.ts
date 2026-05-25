import {
  MANA_CAPS,
  type CombatPhase,
  type Enemy,
  type GameEvent,
  type Player,
} from '../../types'
import type { PoolDeltas } from './pools'
import { applyDamage } from './damage'
import { composeDamage, tickStatuses } from './statuses'
import { interceptFatalDamage, snapshotOf } from '../relics/engine'

// H3: multi-color mana economy. Each colour delta accumulates BOTH into
// its immediate-effect track (red/blue/green → phasePools, purple →
// skillCharge) AND into the colour mana pool (per-cap). Yellow no
// longer flows into a single generic mana counter; it becomes wild
// mana in the colour pool. Purple does not contribute to mana.
export function applyPoolDeltas(player: Player, deltas: PoolDeltas): Player {
  const m = player.mana
  return {
    ...player,
    skillCharge: player.skillCharge + deltas.purple,
    phasePools: {
      red: player.phasePools.red + deltas.red,
      blue: player.phasePools.blue + deltas.blue,
      green: player.phasePools.green + deltas.green,
    },
    mana: {
      red: Math.min(MANA_CAPS.red, m.red + deltas.red),
      blue: Math.min(MANA_CAPS.blue, m.blue + deltas.blue),
      green: Math.min(MANA_CAPS.green, m.green + deltas.green),
      yellow: Math.min(MANA_CAPS.yellow, m.yellow + deltas.yellow),
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

// End of player phase. Heal (green) is committed per-match by the store
// walker; red damage normally fires per-match too unless Bash/Volley is
// pending (which defers red into phasePools.red for this resolver). Blue
// is resolved here per Bulwark/Reinforce rules. After resolution the
// phase transitions to the enemy turn.
//
// Pending-spell resolution (01-design §Spells):
// - Bulwark alone: blue pool → attack at floor(blue/2), block becomes 0.
// - Reinforce alone: block becomes (blue × 2) and carries into next phase.
// - Both queued (the synergy): Reinforce empowers the Bulwark swing —
//   attack at full blue (not floor/2), block becomes 0, and Reinforce
//   gives up its own double/carry. Both spells are spent on one strike.
// - Neither queued: block = blue (the default).
// - Volley queued: red pool splits into 3 chunks distributed across
//   the player's chosen targets; each chunk goes through composeDamage
//   + applyDamage. (H4a; Volley is the sole red-pool consumer.)
//
// Riposte stays in pendingSpells across the enemy turn (it triggers on
// incoming attacks); everything else is cleared here.
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
  const hasVolley = player.pendingSpells.includes('volley')

  let nextBlock = pools.blue
  if (hasBulwark) {
    nextBlock = 0
    // Reinforce, if also queued, empowers the swing to full blue damage
    // and gives up its own double/carry — both spells fire as one strike.
    const rawAttack = hasReinforce ? pools.blue : Math.floor(pools.blue / 2)
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

  // H4a Volley: split the deferred red pool into 3 chunks, applied
  // across the chosen targets. floor(pool/3) per chunk; remainder lands
  // on the LAST chunk so no damage is lost. Empty pool = no hits emitted.
  if (hasVolley && player.volleyTargets && player.volleyTargets.length === 3) {
    const total = pools.red
    if (total > 0) {
      const base = Math.floor(total / 3)
      const last = total - base * 2
      const chunks = [base, base, last]
      for (let i = 0; i < 3; i++) {
        const chunk = chunks[i]
        const targetIdAt = player.volleyTargets[i]
        if (chunk === undefined || chunk <= 0 || targetIdAt === undefined) {
          continue
        }
        const enemy = nextEnemies.find((e) => e.id === targetIdAt && e.hp > 0)
        if (!enemy) continue
        const dmg = composeDamage(chunk, player.statuses, enemy.statuses)
        const res = applyDamage(enemy.block, enemy.hp, dmg)
        if (res.blocked + res.hpDamage <= 0) continue
        nextEnemies = nextEnemies.map((e) =>
          e.id === enemy.id
            ? { ...e, block: res.blockAfter, hp: res.hpAfter }
            : e,
        )
        events.push({
          kind: 'damage-dealt',
          targetId: enemy.id,
          amount: res.hpDamage,
          blocked: res.blocked,
          source: 'player-attack',
        })
        if (res.blockBroken) {
          events.push({ kind: 'block-broken', targetId: enemy.id })
        } else if (res.blockAbsorbed) {
          events.push({ kind: 'block-absorbed', targetId: enemy.id })
        }
        if (res.killed) {
          events.push({ kind: 'enemy-killed', enemyId: enemy.id })
          if (enemy.id === nextTargetId) {
            const nextLiving = nextEnemies.find(
              (e) => e.id !== enemy.id && e.hp > 0,
            )
            nextTargetId = nextLiving?.id ?? null
          }
        }
      }
    }
    events.push({ kind: 'pending-effect-resolved', spellId: 'volley' })
  }

  if (nextBlock > 0) {
    events.push({ kind: 'block-gained', amount: nextBlock })
  }

  const nextPending = player.pendingSpells.filter(
    (id) => id !== 'bulwark' && id !== 'reinforce' && id !== 'volley',
  )

  const updatedPlayer: Player = {
    ...player,
    block: nextBlock,
    phasePools: { red: 0, blue: 0, green: 0 },
    pendingSpells: nextPending,
    // Reinforce queues a one-shot block carry-over for the next phase
    // (01-design §Reinforce): normal "block zeros at next phase start"
    // is overridden once. When Reinforce is combined with Bulwark, it is
    // spent empowering the swing instead — no carry.
    carryBlockNextPhase:
      hasReinforce && !hasBulwark ? true : player.carryBlockNextPhase,
    // H4a: Volley's target list lives until EOP resolves it. Clear once
    // consumed so it can't leak into a later phase (which would let a
    // second Volley re-use a stale list before the player picks again).
    volleyTargets: hasVolley ? undefined : player.volleyTargets,
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
  // H4a Regen tick: heal AFTER burn damage so burn-then-regen pairs
  // resolve damage first then heal. If burn killed and Stoneheart
  // pinned HP to 1, regen lifts off the floor.
  if (ticked.regenHeal > 0 && hp > 0) {
    const before = hp
    hp = Math.min(player.maxHp, hp + ticked.regenHeal)
    const healed = hp - before
    if (healed > 0) {
      events.push({ kind: 'healed', amount: healed })
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
