import { nextInt, type RngState } from '../rng/mulberry32'
import type {
  Cell,
  Enemy,
  GameEvent,
  GemColor,
  Intent,
  PetrifiedRows,
  Player,
  Pos,
} from '../../types'
import { GEM_COLORS } from '../../types'
import { applyDamage } from './damage'
import { applyStatusToList, composeDamage } from './statuses'
import { getArchetype } from './archetypeRegistry'
import { applyFlagToCells, pickClusterCellsWithoutFlag } from '../board/flags'
import { applyGravity } from '../board/gravity'
import {
  interceptFatalDamage,
  runOnDamageTaken,
  snapshotOf,
} from '../relics/engine'

// Per-intent-kind resolvers. Each is pure and returns only the slices it
// changed plus any events emitted. The dispatcher `resolveIntent` below
// glues a resolver call into the existing enemyTurn flow. Mirrors the
// `spellResolvers.ts` shape — varying signatures per kind, no fat
// shared-context type.
//
// Behavior preserved from the pre-refactor inlined switch — same event
// ordering, same edge cases, same RNG threading. The 244-test suite is
// the regression backstop.

// ---------- Attack ----------
// The heaviest resolver: handles Riposte parry, fatal-intercept (Stoneheart),
// onDamageTaken relic chain (Thornmail), and onHit status rider.
// Returns updated source enemy (Riposte counter or Thornmail can damage it)
// and updated player. nextEnemies (the working list of all enemies) is
// mutated via the returned `source` patch — caller maps it back in.
export function resolveAttackIntent(
  intent: Extract<Intent, { kind: 'attack' }>,
  source: Enemy,
  player: Player,
  nextEnemies: Enemy[],
): { source: Enemy; player: Player; events: GameEvent[] } {
  const events: GameEvent[] = []
  let updatedEnemy = source
  let nextPlayer = player

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
    // Reflect the attack's onHit rider back at the attacker — Smolder's
    // burn-on-hit becomes burn-on-counter. Same gate as the player-hit
    // path: rider only fires when the counter actually lands HP damage,
    // and not on an already-dead enemy.
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

  // Standard attack path.
  const finalDamage = composeDamage(
    intent.amount,
    updatedEnemy.statuses,
    nextPlayer.statuses,
  )
  const res = applyDamage(nextPlayer.block, nextPlayer.hp, finalDamage)
  let finalHp = res.hpAfter
  // Clone all relic flag bags up front so both fatal-intercept and
  // damage-taken listeners can write to runFlags / fightFlags.
  const writeRelics = nextPlayer.relics.map((r) => ({
    ...r,
    runFlags: { ...r.runFlags },
    fightFlags: { ...r.fightFlags },
  }))
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
  // If Stoneheart capped HP above the would-be value, the actual
  // damage taken is less than res.hpDamage. Recompute from the
  // delta so the FX layer shows the real number.
  const actualHpDamage = res.hpDamage - (finalHp - res.hpAfter)
  // Surface the onHit rider on damage-taken when it WILL proc this
  // hit (rider gate: onHit set AND the attack landed hp damage —
  // same gate as the apply below). FX/audio fold the status apply
  // into the impact moment instead of running a 350ms-later sequel.
  const willApplyRider =
    intent.onHit != null && res.hpDamage > 0
      ? intent.onHit.status
      : undefined
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
  } else if (res.blockAbsorbed) {
    events.push({ kind: 'block-absorbed', targetId: 'player' })
  }
  // onDamageTaken listeners (Thornmail). Engine emits descriptive
  // events; we scan for damage-dealt with source='thornmail' and
  // apply them through the attacker's block.
  const dtEvents = runOnDamageTaken(
    {
      amount: res.hpDamage,
      blocked: res.blocked,
      source: 'enemy-attack',
      attackerId: updatedEnemy.id,
    },
    writeRelics,
    snapshotOf(nextPlayer, nextEnemies, null, 0),
  )
  for (const ev of dtEvents) {
    if (
      ev.kind === 'damage-dealt' &&
      ev.source === 'thornmail' &&
      updatedEnemy.hp > 0
    ) {
      const reflectRes = applyDamage(
        updatedEnemy.block,
        updatedEnemy.hp,
        ev.amount,
      )
      updatedEnemy = {
        ...updatedEnemy,
        block: reflectRes.blockAfter,
        hp: reflectRes.hpAfter,
      }
      // Push the resolved damage-dealt with corrected block/hp split.
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
  // Smolder's onHitStatus rider: if the attack landed (any HP
  // damage), apply the configured status to the player. Status
  // riders only fire on real hits — fully-blocked attacks don't
  // tag the player (consistent with the "block matters" theme).
  // The rider lives on the intent itself (set when rolled) so the
  // UI's intent badge sees the same payload we resolve from.
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
  return { source: updatedEnemy, player: nextPlayer, events }
}

// ---------- Block (current-intent processing only — actual block was
// applied at telegraph time on the previous turn). Emits "Staggered" if
// the player broke the shield this phase. ----------
export function resolveBlockIntent(source: Enemy): { events: GameEvent[] } {
  if (source.block !== 0) return { events: [] }
  return {
    events: [{ kind: 'enemy-staggered', enemyId: source.id }],
  }
}

// ---------- Tile burn (Smolder) ----------
export function resolveTileBurnIntent(
  intent: Extract<Intent, { kind: 'tile-burn' }>,
  source: Enemy,
  board: Cell[][],
  rng: RngState,
): { board: Cell[][]; rng: RngState; events: GameEvent[] } {
  const def = getArchetype(source.archetype)
  const duration = def.tileBurnDuration ?? 2
  // Cluster pick: a fireball lands HERE, not as N independent
  // sparks across the board. Falls back to random fill if the
  // cluster can't grow large enough.
  const { cells, rng: pickRng } = pickClusterCellsWithoutFlag(
    board,
    'burning',
    intent.count,
    rng,
  )
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

// ---------- Column smash (Brute, H2b) ----------
// Smash the entire column at fire time. The threat is column-bound, not
// gem-bound: matching gems in the column during the player phase doesn't
// reduce the smash — new gems falling/spawning/swapping into the column
// will be smashed too. No payout (no pool fills, no cascade multiplier).
// Inlined gravity + refill keeps the board interactable when the player
// phase begins.
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

  // Drive the standard clear animation + clack SFX through the same
  // gems-cleared event the cascade pipeline uses for match clears. The
  // dedicated column-smash-resolved event is still above for FX layers
  // that want to add a heavier "smash" cue on top.
  events.push({ kind: 'gems-cleared', cells: cellsCleared })

  const { board: fallen, movements } = applyGravity(cleared)
  if (movements.length > 0) events.push({ kind: 'gems-fell', movements })
  let nextRng = rng
  const spawns: { at: Pos; color: GemColor }[] = []
  const refilled: Cell[][] = fallen.map((row, y) =>
    row.map((c, x): Cell => {
      if (c) return c
      const [idx, nr] = nextInt(nextRng, GEM_COLORS.length)
      nextRng = nr
      const color = GEM_COLORS[idx]
      if (!color) throw new Error('column-smash: refill color oob')
      spawns.push({ at: { x, y }, color })
      return { gemColor: color }
    }),
  )
  if (spawns.length > 0) events.push({ kind: 'gems-spawned', spawns })
  return { board: refilled, rng: nextRng, events }
}

// ---------- Petrify row (Defender, H2b) ----------
// Fire-time applies the row lockout. Telegraph only emits the
// petrify-placed event for the overlay's "warning" visual; the
// actual matches-blocked / swap-blocked behaviour starts now, when
// the resolver runs (one phase after the telegraph) — same cadence
// as an attack. Duration counts the player phases the lockout will
// stay active; tick happens at the start of each subsequent enemy
// turn (before the next resolver runs).
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

// ---------- Ally intents (Rallier, H4b) ----------
export function resolveHealAllyIntent(
  intent: Extract<Intent, { kind: 'heal-ally' }>,
  source: Enemy,
  nextEnemies: Enemy[],
): { enemies: Enemy[]; events: GameEvent[] } {
  const target = nextEnemies.find(
    (e) => e.id === intent.targetAllyId && e.hp > 0,
  )
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
  const target = nextEnemies.find(
    (e) => e.id === intent.targetAllyId && e.hp > 0,
  )
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
  const target = nextEnemies.find(
    (e) => e.id === intent.targetAllyId && e.hp > 0,
  )
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
