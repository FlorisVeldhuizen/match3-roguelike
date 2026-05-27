import {
  MANA_CAPS,
  type DrainedColor,
  type Enemy,
  type GameEvent,
  type HexedColor,
  type Player,
} from '../../types'
import { applyCombatEvents } from './applyCombatEvents'
import { getArchetype } from './archetypeRegistry'
import { applyMultiplier } from './math'
import { getCascadeMultiplier } from './multipliers'
import {
  runOnCascade,
  runOnEnemyKilled,
  runOnMatch,
  snapshotOf,
} from '../relics/engine'
import { applyMatchRedDamage } from './aoe'
import { applyStatusToList } from './statuses'
import { getStatusTemplate, BURN_FROM_TILE_BONUS } from './statuses'

function checkEnrage(enemies: Enemy[], stream: GameEvent[]): Enemy[] {
  return enemies.map((e) => {
    if (e.enraged || e.hp <= 0) return e
    const def = getArchetype(e.archetype)
    if (!def.enragePattern) return e
    const threshold = def.enrageThreshold ?? 0.5
    if (e.hp / e.maxHp <= threshold) {
      stream.push({ kind: 'enemy-enraged', enemyId: e.id })
      return { ...e, enraged: true, nextIntentIndex: -1 }
    }
    return e
  })
}

export function processCascadeEvents(
  cascadeEvents: readonly GameEvent[],
  initialPlayer: Player,
  initialEnemies: Enemy[],
  initialTargetEnemyId: string | null,
  hexedColors: readonly HexedColor[] = [],
  drainedColors: readonly DrainedColor[] = [],
): {
  player: Player
  enemies: Enemy[]
  targetEnemyId: string | null
  events: GameEvent[]
} {
  let player = initialPlayer
  let enemies = initialEnemies
  let targetEnemyId = initialTargetEnemyId
  const stream: GameEvent[] = []
  let cascadeLevel = 0

  for (const ev of cascadeEvents) {
    stream.push(ev)

    if (ev.kind === 'tile-burn-triggered') {
      const incoming = {
        ...getStatusTemplate('burn'),
        stacks: ev.cells.length + BURN_FROM_TILE_BONUS,
      }
      player = {
        ...player,
        statuses: applyStatusToList(player.statuses, incoming),
      }
      stream.push({
        kind: 'status-applied',
        target: 'player',
        status: incoming,
        source: { kind: 'board-cells', cells: ev.cells },
      })
      continue
    }

    if (ev.kind === 'cascade-start') {
      cascadeLevel = ev.level
      const onCascade = runOnCascade(
        { level: ev.level },
        player.relics,
        snapshotOf(player, enemies, targetEnemyId, cascadeLevel),
      )
      stream.push(...onCascade)
      const cascadeApplied = applyCombatEvents(
        onCascade,
        player,
        enemies,
        targetEnemyId,
      )
      player = cascadeApplied.player
      enemies = cascadeApplied.enemies
      targetEnemyId = cascadeApplied.targetEnemyId
      stream.push(...cascadeApplied.derived)
      continue
    }

    if (ev.kind !== 'match-found') continue

    const surgeConsumed = player.surgeArmed === true
    let chainConsumed = false
    const effectiveCascade = surgeConsumed ? cascadeLevel + 2 : cascadeLevel

    const cascadeMult = getCascadeMultiplier(effectiveCascade)
    const mult = ev.blessed ? cascadeMult * 2 : cascadeMult
    const raw = applyMultiplier(ev.size, mult)
    const goldRaw = applyMultiplier(ev.size * 2, mult)
    const initialDeltas = {
      red: ev.color === 'red' ? raw : 0,
      blue: ev.color === 'blue' ? raw : 0,
      green: ev.color === 'green' ? raw : 0,
      yellow: ev.color === 'yellow' ? raw : 0,
      purple: ev.color === 'purple' ? raw : 0,
      gold: ev.color === 'gold' ? goldRaw : 0,
    }
    const matchResult = runOnMatch(
      {
        match: { cells: ev.cells, color: ev.color, size: ev.size, shape: ev.shape },
        deltas: initialDeltas,
        cascadeLevel: effectiveCascade,
      },
      player.relics,
      snapshotOf(player, enemies, targetEnemyId, effectiveCascade),
    )
    stream.push(...matchResult.events)
    const finalDeltas = matchResult.payload.deltas

    const m = player.mana
    player = {
      ...player,
      skillCharge: player.skillCharge + finalDeltas.purple,
      phasePools: {
        red: player.phasePools.red + finalDeltas.red,
        blue: player.phasePools.blue + finalDeltas.blue,
        green: player.phasePools.green + finalDeltas.green,
      },
      mana: {
        red: Math.min(MANA_CAPS.red, m.red + finalDeltas.red),
        blue: Math.min(MANA_CAPS.blue, m.blue + finalDeltas.blue),
        green: Math.min(MANA_CAPS.green, m.green + finalDeltas.green),
        yellow: Math.min(MANA_CAPS.yellow, m.yellow + finalDeltas.yellow),
      },
      gold: player.gold + finalDeltas.gold,
    }

    if (hexedColors.some((h) => h.color === ev.color)) {
      const stacks = ev.cells.length
      const incoming = { kind: 'weak' as const, stacks }
      player = {
        ...player,
        statuses: applyStatusToList(player.statuses, incoming),
      }
      stream.push({
        kind: 'hex-triggered',
        color: ev.color,
        stacks,
        cells: ev.cells,
      })
      stream.push({
        kind: 'status-applied',
        target: 'player',
        status: incoming,
        source: { kind: 'board-cells', cells: ev.cells },
      })
    }

    // Color-drain: matching a drained color heals the draining enemy.
    for (const drain of drainedColors) {
      if (drain.color !== ev.color) continue
      const drainEnemy = enemies.find((e) => e.id === drain.enemyId && e.hp > 0)
      if (!drainEnemy) continue
      const healAmount = ev.cells.length
      const healedHp = Math.min(drainEnemy.maxHp, drainEnemy.hp + healAmount)
      const actualHeal = healedHp - drainEnemy.hp
      if (actualHeal > 0) {
        enemies = enemies.map((e) =>
          e.id === drain.enemyId ? { ...e, hp: healedHp } : e,
        )
        stream.push({
          kind: 'drain-triggered',
          color: drain.color,
          healAmount: actualHeal,
          enemyId: drain.enemyId,
          cells: ev.cells,
        })
      }
    }

    const isAoe =
      ev.shape === 'T' || ev.shape === 'L' || (ev.shape === 'line' && ev.size === 5)

    for (const color of ['red', 'blue', 'green', 'yellow', 'purple', 'gold'] as const) {
      const amount = finalDeltas[color]
      if (amount <= 0) continue
      stream.push({ kind: 'pool-gained', color, amount })
      if (color === 'gold') continue
      if (color === 'red') {
        if (player.pendingSpells.includes('volley')) continue
        const skewerConsumed = player.skewerArmed === true
        const dmgAmount = skewerConsumed ? amount * 2 : amount
        chainConsumed = player.chainLightningArmed === true
        const aoe = applyMatchRedDamage(
          enemies,
          targetEnemyId,
          dmgAmount,
          player.statuses,
          isAoe || chainConsumed,
        )
        enemies = aoe.enemies
        stream.push(...aoe.events)
        // Check enrage after damage
        enemies = checkEnrage(enemies, stream)
        for (const killedId of aoe.killedIds) {
          stream.push({ kind: 'enemy-killed', enemyId: killedId })
          const killEvents = runOnEnemyKilled(
            { enemyId: killedId },
            player.relics,
            snapshotOf(player, enemies, targetEnemyId, cascadeLevel),
          )
          stream.push(...killEvents)
          const killApplied = applyCombatEvents(
            killEvents,
            player,
            enemies,
            targetEnemyId,
          )
          player = killApplied.player
          enemies = killApplied.enemies
          targetEnemyId = killApplied.targetEnemyId
          stream.push(...killApplied.derived)
        }
      } else if (color === 'green') {
        const before = player.hp
        const next = Math.min(player.maxHp, player.hp + amount)
        const healed = next - before
        if (healed <= 0) continue
        player = { ...player, hp: next }
        stream.push({ kind: 'healed', amount: healed })
      }
    }

    if (player.skewerArmed === true) {
      player = {
        ...player,
        skewerArmed: false,
        pendingSpells: player.pendingSpells.filter((id) => id !== 'skewer'),
      }
      stream.push({ kind: 'pending-effect-resolved', spellId: 'skewer' })
    }
    if (surgeConsumed) {
      player = {
        ...player,
        surgeArmed: false,
        pendingSpells: player.pendingSpells.filter((id) => id !== 'surge'),
      }
      stream.push({ kind: 'pending-effect-resolved', spellId: 'surge' })
    }
    if (chainConsumed) {
      player = {
        ...player,
        chainLightningArmed: false,
        pendingSpells: player.pendingSpells.filter((id) => id !== 'chain-lightning'),
      }
      stream.push({ kind: 'pending-effect-resolved', spellId: 'chain-lightning' })
    }
  }

  return { player, enemies, targetEnemyId, events: stream }
}
