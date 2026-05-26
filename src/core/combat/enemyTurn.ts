import type { RngState } from '../rng/mulberry32'
import type {
  Cell,
  CombatPhase,
  Enemy,
  GameEvent,
  HexedColor,
  Intent,
  PetrifiedRows,
  Player,
} from '../../types'
import { applyIntentTelegraph, rollIntent } from './intents'
import { applyDamage } from './damage'
import { tickStatuses } from './statuses'
import {
  resolveAttackIntent,
  resolveBlockIntent,
  resolveBuffAllyIntent,
  resolveClusterShoveIntent,
  resolveColorHexIntent,
  resolveColumnSmashIntent,
  resolveHealAllyIntent,
  resolvePetrifyRowIntent,
  resolveShieldAllyIntent,
  resolveTileBurnIntent,
} from './intentResolvers'
import { detectMatches } from '../board/detectMatches'
import { runCascade } from '../board/cascade'
import { processCascadeEvents } from './cascadeProcessor'

export type EnemyTurnResult = {
  player: Player
  enemies: Enemy[]
  board: Cell[][]
  petrifiedRows: PetrifiedRows
  hexedColors: HexedColor[]
  rng: RngState
  phase: CombatPhase
  events: GameEvent[]
  targetEnemyId: string | null
}

export function executeEnemyTurn(
  player: Player,
  enemies: Enemy[],
  board: Cell[][],
  rng: RngState,
  petrifiedRows: PetrifiedRows = {},
  hexedColors: HexedColor[] = [],
  targetEnemyId: string | null = null,
): EnemyTurnResult {
  const events: GameEvent[] = []
  // Telegraph events deferred to end so all new intents pop in simultaneously
  const telegraphEvents: GameEvent[] = []
  const siblingNextIntents: Intent[] = []
  let nextPlayer: Player = player
  let nextEnemies: Enemy[] = enemies
  let nextBoard: Cell[][] = board
  let nextPetrifiedRows: PetrifiedRows = petrifiedRows
  let nextHexedColors: HexedColor[] = hexedColors
  let nextRng = rng
  let nextTargetEnemyId: string | null = targetEnemyId

  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue
    if (nextPlayer.hp <= 0) break

    const ticked = tickStatuses(enemy.id, enemy.statuses)
    let workingEnemy: Enemy = { ...enemy, statuses: ticked.statuses }
    if (ticked.burnDamage > 0 && workingEnemy.hp > 0) {
      const res = applyDamage(
        workingEnemy.block,
        workingEnemy.hp,
        ticked.burnDamage,
      )
      workingEnemy = {
        ...workingEnemy,
        hp: res.hpAfter,
        block: res.blockAfter,
      }
      events.push({
        kind: 'damage-dealt',
        targetId: workingEnemy.id,
        amount: res.hpDamage,
        blocked: res.blocked,
        source: 'burn',
      })
      if (res.blockBroken) {
        events.push({ kind: 'block-broken', targetId: workingEnemy.id })
      } else if (res.blockAbsorbed) {
        events.push({ kind: 'block-absorbed', targetId: workingEnemy.id })
      }
      if (res.killed) {
        events.push({ kind: 'enemy-killed', enemyId: workingEnemy.id })
      }
    }
    events.push(...ticked.events)

    nextEnemies = nextEnemies.map((e) =>
      e.id === workingEnemy.id ? workingEnemy : e,
    )

    if (workingEnemy.hp <= 0) {
      continue
    }

    const intent = workingEnemy.currentIntent
    let updatedEnemy: Enemy = workingEnemy

    if (intent.kind === 'attack') {
      const r = resolveAttackIntent(intent, updatedEnemy, nextPlayer, nextEnemies)
      updatedEnemy = r.source
      nextPlayer = r.player
      events.push(...r.events)
    } else if (intent.kind === 'tile-burn') {
      const r = resolveTileBurnIntent(intent, updatedEnemy, nextBoard, nextRng)
      nextBoard = r.board
      nextRng = r.rng
      events.push(...r.events)
    } else if (intent.kind === 'column-smash') {
      const r = resolveColumnSmashIntent(intent, updatedEnemy, nextBoard, nextRng)
      nextBoard = r.board
      nextRng = r.rng
      events.push(...r.events)
    } else if (intent.kind === 'petrify-row') {
      const r = resolvePetrifyRowIntent(intent, updatedEnemy, nextPetrifiedRows)
      nextPetrifiedRows = r.petrifiedRows
      events.push(...r.events)
    } else if (intent.kind === 'color-hex') {
      const r = resolveColorHexIntent(intent, updatedEnemy, nextHexedColors)
      nextHexedColors = r.hexedColors
      events.push(...r.events)
    } else if (intent.kind === 'cluster-shove') {
      const r = resolveClusterShoveIntent(updatedEnemy, nextBoard, nextRng)
      nextBoard = r.board
      nextRng = r.rng
      events.push(...r.events)
    } else if (intent.kind === 'block') {
      const r = resolveBlockIntent(updatedEnemy)
      events.push(...r.events)
    } else if (intent.kind === 'heal-ally') {
      const r = resolveHealAllyIntent(intent, updatedEnemy, nextEnemies)
      nextEnemies = r.enemies
      events.push(...r.events)
    } else if (intent.kind === 'buff-ally') {
      const r = resolveBuffAllyIntent(intent, updatedEnemy, nextEnemies)
      nextEnemies = r.enemies
      events.push(...r.events)
    } else if (intent.kind === 'shield-ally') {
      const r = resolveShieldAllyIntent(intent, updatedEnemy, nextEnemies)
      nextEnemies = r.enemies
      events.push(...r.events)
    }

    events.push({ kind: 'enemy-acted', enemyId: updatedEnemy.id })

    if (updatedEnemy.hp > 0) {
      const nextIndex = updatedEnemy.nextIntentIndex + 1
      const rolled = rollIntent(
        updatedEnemy.archetype,
        nextIndex,
        nextRng,
        nextEnemies,
        updatedEnemy.id,
        siblingNextIntents,
      )
      siblingNextIntents.push(rolled.intent)
      nextRng = rolled.rng
      let updatedBlock = updatedEnemy.block
      if (rolled.intent.kind === 'block') {
        updatedBlock = updatedBlock + rolled.intent.amount
        telegraphEvents.push({
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
      telegraphEvents.push({
        kind: 'intent-telegraphed',
        enemyId: updatedEnemy.id,
        intent: rolled.intent,
      })
      const tele = applyIntentTelegraph(
        nextBoard,
        nextPetrifiedRows,
        rolled.intent,
        updatedEnemy.id,
        updatedEnemy.archetype,
      )
      nextBoard = tele.board
      nextPetrifiedRows = tele.petrifiedRows
      telegraphEvents.push(...tele.events)
    }

    nextEnemies = nextEnemies.map((e) =>
      e.id === updatedEnemy.id ? updatedEnemy : e,
    )
  }

  if (nextPlayer.pendingSpells.includes('riposte')) {
    nextPlayer = {
      ...nextPlayer,
      pendingSpells: nextPlayer.pendingSpells.filter((id) => id !== 'riposte'),
    }
    events.push({ kind: 'pending-effect-resolved', spellId: 'riposte' })
  }

  // Post-action cascade: enemy board changes can create matches
  const postActionMatches = detectMatches(nextBoard)
  if (postActionMatches.length > 0) {
    const cascade = runCascade(nextBoard, nextRng, postActionMatches)
    nextBoard = cascade.board
    nextRng = cascade.rng
    const processed = processCascadeEvents(
      cascade.events,
      nextPlayer,
      nextEnemies,
      nextTargetEnemyId,
      nextHexedColors,
    )
    nextPlayer = processed.player
    nextEnemies = processed.enemies
    nextTargetEnemyId = processed.targetEnemyId
    events.push(...processed.events)
  }

  // Filter out telegraphs from enemies that died mid-turn
  const livingEnemyIds = new Set(
    nextEnemies.filter((e) => e.hp > 0).map((e) => e.id),
  )
  for (const ev of telegraphEvents) {
    if ('enemyId' in ev && !livingEnemyIds.has(ev.enemyId)) continue
    events.push(ev)
  }

  const anyEnemyAlive = nextEnemies.some((e) => e.hp > 0)
  const phase: CombatPhase =
    nextPlayer.hp <= 0 ? 'game-over' : anyEnemyAlive ? 'player-acting' : 'victory'
  // Terminal transitions emit phase-changed directly; player-acting deferred to caller
  if (phase === 'game-over' || phase === 'victory') {
    events.push({ kind: 'phase-changed', phase })
  }

  return {
    player: nextPlayer,
    enemies: nextEnemies,
    board: nextBoard,
    petrifiedRows: nextPetrifiedRows,
    hexedColors: nextHexedColors,
    rng: nextRng,
    phase,
    events,
    targetEnemyId: nextTargetEnemyId,
  }
}
