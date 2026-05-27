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
import { withPendingSpellVisuals } from './spellVisual'
import {
  cloneRelicsForHooks,
  interceptFatalDamage,
  snapshotOf,
} from '../relics/engine'

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
    // Reinforce empowers Bulwark swing to full blue (not floor/2)
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
        const bulwarkFx: GameEvent[] = [
          {
            kind: 'damage-dealt',
            targetId: target.id,
            amount: res.hpDamage,
            blocked: res.blocked,
            source: 'player-attack',
          },
        ]
        if (res.blockBroken) {
          bulwarkFx.push({ kind: 'block-broken', targetId: target.id })
        } else if (res.blockAbsorbed) {
          bulwarkFx.push({ kind: 'block-absorbed', targetId: target.id })
        }
        events.push(...withPendingSpellVisuals('bulwark', bulwarkFx))
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

  // Volley: split deferred red pool into 3 chunks across chosen targets
  if (hasVolley && player.volleyTargets && player.volleyTargets.length === 3) {
    const total = pools.red
    if (total > 0) {
      const base = Math.floor(total / 3)
      const last = total - base * 2
      const chunks = [base, base, last]
      const volleyFx: GameEvent[] = []
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
        volleyFx.push({
          kind: 'damage-dealt',
          targetId: enemy.id,
          amount: res.hpDamage,
          blocked: res.blocked,
          source: 'player-attack',
        })
        if (res.blockBroken) {
          volleyFx.push({ kind: 'block-broken', targetId: enemy.id })
        } else if (res.blockAbsorbed) {
          volleyFx.push({ kind: 'block-absorbed', targetId: enemy.id })
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
      if (volleyFx.length > 0) {
        events.push(...withPendingSpellVisuals('volley', volleyFx))
      }
    }
    events.push({ kind: 'pending-effect-resolved', spellId: 'volley' })
  }

  if (nextBlock > 0) {
    const blockEv: GameEvent = { kind: 'block-gained', amount: nextBlock }
    if (hasReinforce) {
      events.push(...withPendingSpellVisuals('reinforce', [blockEv]))
    } else {
      events.push(blockEv)
    }
  }

  const nextPending = player.pendingSpells.filter(
    (id) => id !== 'bulwark' && id !== 'reinforce' && id !== 'volley',
  )

  const updatedPlayer: Player = {
    ...player,
    block: nextBlock,
    phasePools: { red: 0, blue: 0, green: 0 },
    pendingSpells: nextPending,
    carryBlockNextPhase:
      hasReinforce && !hasBulwark ? true : player.carryBlockNextPhase,
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

export function beginPlayerPhase(
  player: Player,
  enemies: readonly Enemy[] = [],
  targetEnemyId: string | null = null,
): PlayerPhaseBeginResult {
  const events: GameEvent[] = []
  const ticked = tickStatuses('player', player.statuses)

  let hp = player.hp
  let block = player.block
  let relics = player.relics
  if (ticked.burnDamage > 0 && hp > 0) {
    const res = applyDamage(block, hp, ticked.burnDamage)
    let finalHp = res.hpAfter
    if (res.killed) {
      const snap = snapshotOf(player, enemies, targetEnemyId, 0)
      const writeRelics = cloneRelicsForHooks(relics)
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
  // Regen heals AFTER burn so burn-then-regen resolves damage first
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
