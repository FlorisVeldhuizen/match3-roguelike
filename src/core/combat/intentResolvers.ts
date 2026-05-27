import { type RngState } from '../rng/mulberry32'
import type {
  Cell,
  DrainedColor,
  Enemy,
  GameEvent,
  GemColor,
  HexedColor,
  Intent,
  PetrifiedRows,
  Player,
  Pos,
} from '../../types'
import { pickGemColorWeighted } from '../board/gemSpawn'
import { applyCombatEvents } from './applyCombatEvents'
import { applyDamage } from './damage'
import { applyStatusToList, composeDamage } from './statuses'
import { getArchetype } from './archetypeRegistry'
import { applyFlagToCells, getFlag, pickClusterCellsWithoutFlag } from '../board/flags'
import { applyGravity } from '../board/gravity'
import {
  cloneRelicsForHooks,
  interceptFatalDamage,
  runOnBlockBroken,
  runOnDamageTaken,
  snapshotOf,
} from '../relics/engine'

export function resolveAttackIntent(
  intent: Extract<Intent, { kind: 'attack' }>,
  source: Enemy,
  player: Player,
  nextEnemies: Enemy[],
  targetEnemyId: string | null = null,
): { source: Enemy; player: Player; events: GameEvent[] } {
  const events: GameEvent[] = []
  let updatedEnemy = source
  let nextPlayer = player

  const riposteArmed = nextPlayer.pendingSpells.includes('riposte')
  if (riposteArmed) {
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
    // Reflect onHit rider back at attacker on counter
    const onHit = intent.onHit
    if (onHit && res.hpDamage > 0 && updatedEnemy.hp > 0) {
      const newStatus = { kind: onHit.status, stacks: onHit.stacks }
      updatedEnemy = {
        ...updatedEnemy,
        statuses: applyStatusToList(updatedEnemy.statuses, newStatus),
      }
      events.push({
        kind: 'status-applied',
        target: updatedEnemy.id,
        status: newStatus,
        source: { kind: 'player' },
      })
    }
    nextPlayer = {
      ...nextPlayer,
      pendingSpells: nextPlayer.pendingSpells.filter((id) => id !== 'riposte'),
    }
    events.push({ kind: 'pending-effect-resolved', spellId: 'riposte' })
    return { source: updatedEnemy, player: nextPlayer, events }
  }

  const finalDamage = composeDamage(intent.amount, updatedEnemy.statuses, nextPlayer.statuses)
  const res = applyDamage(nextPlayer.block, nextPlayer.hp, finalDamage)
  let finalHp = res.hpAfter
  const writeRelics = cloneRelicsForHooks(nextPlayer.relics)
  if (res.killed) {
    const intercept = interceptFatalDamage(
      { incoming: finalDamage, source: 'enemy-attack' },
      writeRelics,
      snapshotOf(nextPlayer, nextEnemies, null, 0),
    )
    if (intercept.result) {
      finalHp = intercept.result.hpFloor
      events.push(...intercept.events)
    }
  }
  nextPlayer = {
    ...nextPlayer,
    block: res.blockAfter,
    hp: finalHp,
    relics: writeRelics,
  }
  const actualHpDamage = res.hpDamage - (finalHp - res.hpAfter)
  const willApplyRider = intent.onHit != null && res.hpDamage > 0 ? intent.onHit.status : undefined
  events.push({
    kind: 'damage-taken',
    amount: actualHpDamage,
    blocked: res.blocked,
    source: 'enemy-attack',
    attackerId: updatedEnemy.id,
    ...(willApplyRider ? { onHitRider: willApplyRider } : {}),
  })
  if (res.blockBroken) {
    events.push({ kind: 'block-broken', targetId: 'player' })
    const bbEvents = runOnBlockBroken(
      { target: 'player' },
      writeRelics,
      snapshotOf(nextPlayer, nextEnemies, targetEnemyId, 0),
    )
    events.push(...bbEvents)
    const bbApplied = applyCombatEvents(bbEvents, nextPlayer, nextEnemies, targetEnemyId)
    nextEnemies = bbApplied.enemies
    events.push(...bbApplied.derived)
  } else if (res.blockAbsorbed) {
    events.push({ kind: 'block-absorbed', targetId: 'player' })
  }
  const dtEvents = runOnDamageTaken(
    {
      amount: res.hpDamage,
      blocked: res.blocked,
      source: 'enemy-attack',
      attackerId: updatedEnemy.id,
    },
    writeRelics,
    snapshotOf(nextPlayer, nextEnemies, targetEnemyId, 0),
  )
  for (const ev of dtEvents) {
    if (ev.kind === 'damage-dealt' && ev.source === 'thornmail' && updatedEnemy.hp > 0) {
      const reflectRes = applyDamage(updatedEnemy.block, updatedEnemy.hp, ev.amount)
      updatedEnemy = {
        ...updatedEnemy,
        block: reflectRes.blockAfter,
        hp: reflectRes.hpAfter,
      }
      events.push({
        kind: 'damage-dealt',
        targetId: updatedEnemy.id,
        amount: reflectRes.hpDamage,
        blocked: reflectRes.blocked,
        source: 'thornmail',
      })
      if (reflectRes.blockBroken) {
        events.push({ kind: 'block-broken', targetId: updatedEnemy.id })
      } else if (reflectRes.blockAbsorbed) {
        events.push({ kind: 'block-absorbed', targetId: updatedEnemy.id })
      }
      if (reflectRes.killed) {
        events.push({ kind: 'enemy-killed', enemyId: updatedEnemy.id })
      }
    } else {
      events.push(ev)
    }
  }
  // onHit rider: status applied only when attack lands HP damage
  const onHit = intent.onHit
  if (onHit && res.hpDamage > 0) {
    const newStatus = {
      kind: onHit.status,
      stacks: onHit.stacks,
    }
    nextPlayer = {
      ...nextPlayer,
      statuses: applyStatusToList(nextPlayer.statuses, newStatus),
    }
    events.push({
      kind: 'status-applied',
      target: 'player',
      status: newStatus,
      source: { kind: 'enemy', enemyId: updatedEnemy.id },
    })
  }
  // Shade lifesteal: heal self for a fraction of HP damage dealt.
  const archDef = getArchetype(updatedEnemy.archetype)
  if (archDef.onHitSelfHeal && res.hpDamage > 0 && updatedEnemy.hp > 0) {
    const healAmount = Math.ceil(res.hpDamage * archDef.onHitSelfHeal)
    const healedHp = Math.min(updatedEnemy.maxHp, updatedEnemy.hp + healAmount)
    const actualHeal = healedHp - updatedEnemy.hp
    if (actualHeal > 0) {
      updatedEnemy = { ...updatedEnemy, hp: healedHp }
      events.push({
        kind: 'ally-healed',
        sourceId: updatedEnemy.id,
        targetId: updatedEnemy.id,
        amount: actualHeal,
      })
    }
  }
  return { source: updatedEnemy, player: nextPlayer, events }
}

export function resolveBlockIntent(source: Enemy): { events: GameEvent[] } {
  if (source.block !== 0) return { events: [] }
  return {
    events: [{ kind: 'enemy-staggered', enemyId: source.id }],
  }
}

export function resolveTileBurnIntent(
  intent: Extract<Intent, { kind: 'tile-burn' }>,
  source: Enemy,
  board: Cell[][],
  rng: RngState,
): { board: Cell[][]; rng: RngState; events: GameEvent[] } {
  const def = getArchetype(source.archetype)
  const duration = def.tileBurnDuration ?? 2
  const { cells, rng: pickRng } = pickClusterCellsWithoutFlag(board, 'burning', intent.count, rng)
  if (cells.length === 0) return { board, rng: pickRng, events: [] }
  const nextBoard = applyFlagToCells(board, cells, 'burning', duration)
  return {
    board: nextBoard,
    rng: pickRng,
    events: [
      {
        kind: 'tile-burn-placed',
        cells,
        enemyId: source.id,
        duration,
      },
    ],
  }
}

export function resolveColumnSmashIntent(
  intent: Extract<Intent, { kind: 'column-smash' }>,
  source: Enemy,
  board: Cell[][],
  rng: RngState,
): { board: Cell[][]; rng: RngState; events: GameEvent[] } {
  const events: GameEvent[] = []
  const col = intent.column
  const cellsCleared: Pos[] = []
  const cleared: (Cell | null)[][] = board.map((row, y) =>
    row.map((cell, x) => {
      if (x !== col) return cell
      cellsCleared.push({ x, y })
      return null
    }),
  )
  events.push({
    kind: 'column-smash-resolved',
    enemyId: source.id,
    column: col,
    cells: cellsCleared,
  })
  if (cellsCleared.length === 0) return { board, rng, events }

  events.push({ kind: 'gems-cleared', cells: cellsCleared })

  const { board: fallen, movements } = applyGravity(cleared)
  if (movements.length > 0) events.push({ kind: 'gems-fell', movements })
  let nextRng = rng
  const spawns: { at: Pos; color: GemColor }[] = []
  const refilled: Cell[][] = fallen.map((row, y) =>
    row.map((c, x): Cell => {
      if (c) return c
      const [color, nr] = pickGemColorWeighted(nextRng)
      nextRng = nr
      spawns.push({ at: { x, y }, color })
      return { gemColor: color }
    }),
  )
  if (spawns.length > 0) events.push({ kind: 'gems-spawned', spawns })
  return { board: refilled, rng: nextRng, events }
}

export function resolvePetrifyRowIntent(
  intent: Extract<Intent, { kind: 'petrify-row' }>,
  source: Enemy,
  petrifiedRows: PetrifiedRows,
): { petrifiedRows: PetrifiedRows; events: GameEvent[] } {
  const def = getArchetype(source.archetype)
  const duration = def.petrifyDuration ?? 2
  const nextRows: PetrifiedRows = {
    ...petrifiedRows,
    [intent.row]: Math.max(petrifiedRows[intent.row] ?? 0, duration),
  }
  return {
    petrifiedRows: nextRows,
    events: [
      {
        kind: 'petrify-fired',
        enemyId: source.id,
        row: intent.row,
        duration,
      },
    ],
  }
}

export function resolveColorHexIntent(
  intent: Extract<Intent, { kind: 'color-hex' }>,
  source: Enemy,
  hexedColors: readonly HexedColor[],
): { hexedColors: HexedColor[]; events: GameEvent[] } {
  const def = getArchetype(source.archetype)
  const duration = def.colorHexDuration ?? 2
  const next: HexedColor[] = hexedColors.slice()
  const existing = next.findIndex((h) => h.color === intent.color)
  if (existing >= 0) {
    const cur = next[existing]!
    next[existing] = {
      color: intent.color,
      turnsLeft: Math.max(cur.turnsLeft, duration),
    }
  } else {
    next.push({ color: intent.color, turnsLeft: duration })
  }
  return {
    hexedColors: next,
    events: [
      {
        kind: 'color-hex-fired',
        enemyId: source.id,
        color: intent.color,
        turnsLeft: duration,
      },
    ],
  }
}

export function resolveClusterShoveIntent(
  source: Enemy,
  board: Cell[][],
  rng: RngState,
): { board: Cell[][]; rng: RngState; events: GameEvent[] } {
  const events: GameEvent[] = []
  type Move = { src: Pos; dst: Pos; color: GemColor }
  const moves: Move[] = []
  for (let y = 0; y < board.length; y++) {
    const row = board[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      const cell = row[x]
      const flag = getFlag(cell, 'pendingShove')
      if (!flag || !cell) continue
      if (flag.sourceEnemyId !== source.id) continue
      moves.push({ src: { x, y }, dst: flag.dst, color: cell.gemColor })
    }
  }

  if (moves.length === 0) {
    events.push({
      kind: 'cluster-shove-resolved',
      enemyId: source.id,
      moves: [],
    })
    return { board, rng, events }
  }

  const cleared: (Cell | null)[][] = board.map((row) => row.slice())
  for (const m of moves) {
    const row = cleared[m.src.y]
    if (row) row[m.src.x] = null
  }
  for (const m of moves) {
    const row = cleared[m.dst.y]
    if (row) row[m.dst.x] = { gemColor: m.color }
  }

  events.push({
    kind: 'cluster-shove-resolved',
    enemyId: source.id,
    moves: moves.map((m) => ({
      source: m.src,
      destination: m.dst,
      color: m.color,
    })),
  })
  events.push({ kind: 'gems-cleared', cells: moves.map((m) => m.src) })

  const { board: fallen, movements } = applyGravity(cleared)
  if (movements.length > 0) events.push({ kind: 'gems-fell', movements })

  let nextRng = rng
  const spawns: { at: Pos; color: GemColor }[] = []
  const refilled: Cell[][] = fallen.map((row, y) =>
    row.map((c, x): Cell => {
      if (c) return c
      const [color, nr] = pickGemColorWeighted(nextRng)
      nextRng = nr
      spawns.push({ at: { x, y }, color })
      return { gemColor: color }
    }),
  )
  if (spawns.length > 0) events.push({ kind: 'gems-spawned', spawns })

  return { board: refilled, rng: nextRng, events }
}

export function resolveHealAllyIntent(
  intent: Extract<Intent, { kind: 'heal-ally' }>,
  source: Enemy,
  nextEnemies: Enemy[],
): { enemies: Enemy[]; events: GameEvent[] } {
  const target = nextEnemies.find((e) => e.id === intent.targetAllyId && e.hp > 0)
  if (!target) return { enemies: nextEnemies, events: [] }
  const healed = Math.min(intent.amount, target.maxHp - target.hp)
  if (healed <= 0) return { enemies: nextEnemies, events: [] }
  const healedTarget: Enemy = { ...target, hp: target.hp + healed }
  return {
    enemies: nextEnemies.map((e) => (e.id === target.id ? healedTarget : e)),
    events: [
      {
        kind: 'ally-healed',
        sourceId: source.id,
        targetId: target.id,
        amount: healed,
      },
    ],
  }
}

export function resolveBuffAllyIntent(
  intent: Extract<Intent, { kind: 'buff-ally' }>,
  source: Enemy,
  nextEnemies: Enemy[],
): { enemies: Enemy[]; events: GameEvent[] } {
  const target = nextEnemies.find((e) => e.id === intent.targetAllyId && e.hp > 0)
  if (!target) return { enemies: nextEnemies, events: [] }
  const newStatus = { kind: 'strength' as const, stacks: intent.stacks }
  const buffedTarget: Enemy = {
    ...target,
    statuses: applyStatusToList(target.statuses, newStatus),
  }
  return {
    enemies: nextEnemies.map((e) => (e.id === target.id ? buffedTarget : e)),
    events: [
      {
        kind: 'status-applied',
        target: target.id,
        status: newStatus,
        source: { kind: 'enemy', enemyId: source.id },
      },
    ],
  }
}

export function resolveShieldAllyIntent(
  intent: Extract<Intent, { kind: 'shield-ally' }>,
  source: Enemy,
  nextEnemies: Enemy[],
): { enemies: Enemy[]; events: GameEvent[] } {
  const target = nextEnemies.find((e) => e.id === intent.targetAllyId && e.hp > 0)
  if (!target) return { enemies: nextEnemies, events: [] }
  const shieldedTarget: Enemy = {
    ...target,
    block: target.block + intent.amount,
  }
  return {
    enemies: nextEnemies.map((e) => (e.id === target.id ? shieldedTarget : e)),
    events: [
      {
        kind: 'ally-shielded',
        sourceId: source.id,
        targetId: target.id,
        amount: intent.amount,
      },
    ],
  }
}

// ---------- Color drain (Leech) ----------
// Fire-time pushes a drained colour into FightState.drainedColors. When the
// player matches gems of that colour, the draining enemy heals (handled by
// the cascade processor). Same structure as color-hex but with a heal
// effect instead of Weak application.
export function resolveColorDrainIntent(
  intent: Extract<Intent, { kind: 'color-drain' }>,
  source: Enemy,
  drainedColors: readonly DrainedColor[],
): { drainedColors: DrainedColor[]; events: GameEvent[] } {
  const def = getArchetype(source.archetype)
  const duration = def.colorDrainDuration ?? 2
  const next: DrainedColor[] = drainedColors.slice()
  const existing = next.findIndex((d) => d.color === intent.color && d.enemyId === source.id)
  if (existing >= 0) {
    const cur = next[existing]!
    next[existing] = { ...cur, turnsLeft: Math.max(cur.turnsLeft, duration) }
  } else {
    next.push({ color: intent.color, enemyId: source.id, turnsLeft: duration })
  }
  return {
    drainedColors: next,
    events: [
      {
        kind: 'color-drain-fired',
        enemyId: source.id,
        color: intent.color,
        turnsLeft: duration,
      },
    ],
  }
}
