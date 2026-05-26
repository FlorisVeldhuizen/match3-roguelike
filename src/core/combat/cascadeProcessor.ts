import {
  MANA_CAPS,
  type Enemy,
  type GameEvent,
  type HexedColor,
  type Player,
} from '../../types'
import { applyMultiplier } from './math'
import { getCascadeMultiplier } from './multipliers'
import {
  runOnCascade,
  runOnEnemyKilled,
  runOnMatch,
  snapshotOf,
} from '../relics/engine'
import { applyMatchRedDamage, pickNextTarget } from './aoe'
import { applyStatusToList } from './statuses'
import { getStatusTemplate, BURN_FROM_TILE_BONUS } from './statuses'

export function processCascadeEvents(
  cascadeEvents: readonly GameEvent[],
  initialPlayer: Player,
  initialEnemies: Enemy[],
  initialTargetEnemyId: string | null,
  hexedColors: readonly HexedColor[] = [],
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
      continue
    }

    if (ev.kind !== 'match-found') continue

    const surgeConsumed = player.surgeArmed === true
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
        const aoe = applyMatchRedDamage(
          enemies,
          targetEnemyId,
          dmgAmount,
          player.statuses,
          isAoe,
        )
        enemies = aoe.enemies
        stream.push(...aoe.events)
        for (const killedId of aoe.killedIds) {
          stream.push({ kind: 'enemy-killed', enemyId: killedId })
          const killEvents = runOnEnemyKilled(
            { enemyId: killedId },
            player.relics,
            snapshotOf(player, enemies, targetEnemyId, cascadeLevel),
          )
          stream.push(...killEvents)
          if (killedId === targetEnemyId) {
            targetEnemyId = pickNextTarget(enemies, null)
          }
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
  }

  return { player, enemies, targetEnemyId, events: stream }
}
