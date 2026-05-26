import { type RngState } from '../rng/mulberry32'
import {
  MANA_CAPS,
  type Cell,
  type Enemy,
  type GameEvent,
  type GemColor,
  type HexedColor,
  type ManaPools,
  type Match,
  type Player,
  type Pos,
  type StatusInstance,
  type StatusKind,
} from '../../types'
import { applyStatusToList } from './statuses'
import { runCascade } from '../board/cascade'
import { processCascadeEvents } from './cascadeProcessor'

export const IGNITE_BURN_STACKS = 3
export const BRITTLE_VULN_STACKS = 2
export const CINDER_BURN_STACKS = 2
export const CINDER_HEAL = 2
// Bonus heal when stripping Burn rewards the "tank then cleanse" line.
export const PURIFY_BURN_HEAL = 3
// decay-decay-decay → 3+2+1 = 6 HP total
export const REGENERATE_STACKS = 3

export function resolveIgnite(
  enemies: readonly Enemy[],
  targetEnemyId: string,
): { enemies: Enemy[]; events: GameEvent[] } {
  const target = enemies.find((e) => e.id === targetEnemyId && e.hp > 0)
  if (!target) return { enemies: [...enemies], events: [] }
  const incoming: StatusInstance = { kind: 'burn', stacks: IGNITE_BURN_STACKS }
  const newStatuses = applyStatusToList(target.statuses, incoming)
  const updated = enemies.map((e) =>
    e.id === targetEnemyId ? { ...e, statuses: newStatuses } : e,
  )
  return {
    enemies: updated,
    events: [
      {
        kind: 'status-applied',
        target: targetEnemyId,
        status: incoming,
        source: { kind: 'player' },
      },
    ],
  }
}

export function resolveBrittle(
  enemies: readonly Enemy[],
  targetEnemyId: string,
): { enemies: Enemy[]; events: GameEvent[] } {
  const target = enemies.find((e) => e.id === targetEnemyId && e.hp > 0)
  if (!target) return { enemies: [...enemies], events: [] }
  const incoming: StatusInstance = {
    kind: 'vulnerable',
    stacks: BRITTLE_VULN_STACKS,
  }
  const newStatuses = applyStatusToList(target.statuses, incoming)
  const updated = enemies.map((e) =>
    e.id === targetEnemyId ? { ...e, statuses: newStatuses } : e,
  )
  return {
    enemies: updated,
    events: [
      {
        kind: 'status-applied',
        target: targetEnemyId,
        status: incoming,
        source: { kind: 'player' },
      },
    ],
  }
}

// Effects are independent: heal still happens if target dies mid-resolve.
export function resolveCinderLash(
  player: Player,
  enemies: readonly Enemy[],
  targetEnemyId: string,
): { player: Player; enemies: Enemy[]; events: GameEvent[] } {
  const events: GameEvent[] = []
  let nextEnemies: Enemy[] = [...enemies]
  const target = enemies.find((e) => e.id === targetEnemyId && e.hp > 0)
  if (target) {
    const incoming: StatusInstance = {
      kind: 'burn',
      stacks: CINDER_BURN_STACKS,
    }
    const newStatuses = applyStatusToList(target.statuses, incoming)
    nextEnemies = enemies.map((e) =>
      e.id === targetEnemyId ? { ...e, statuses: newStatuses } : e,
    )
    events.push({
      kind: 'status-applied',
      target: targetEnemyId,
      status: incoming,
      source: { kind: 'player' },
    })
  }
  const before = player.hp
  const next = Math.min(player.maxHp, before + CINDER_HEAL)
  const delta = next - before
  const nextPlayer = delta > 0 ? { ...player, hp: next } : player
  if (delta > 0) {
    events.push({ kind: 'healed', amount: delta })
  }
  return { player: nextPlayer, enemies: nextEnemies, events }
}

export function resolveRegenerate(player: Player): {
  player: Player
  events: GameEvent[]
} {
  const incoming: StatusInstance = {
    kind: 'regen',
    stacks: REGENERATE_STACKS,
  }
  const nextStatuses = applyStatusToList(player.statuses, incoming)
  return {
    player: { ...player, statuses: nextStatuses },
    events: [
      {
        kind: 'status-applied',
        target: 'player',
        status: incoming,
        source: { kind: 'player' },
      },
    ],
  }
}

export function resolvePurify(
  player: Player,
  statusKind: StatusKind,
): { player: Player; events: GameEvent[] } {
  const hadIt = player.statuses.some((s) => s.kind === statusKind)
  if (!hadIt) {
    return { player, events: [] }
  }
  const events: GameEvent[] = [
    { kind: 'status-expired', target: 'player', statusKind },
  ]
  let nextPlayer: Player = {
    ...player,
    statuses: player.statuses.filter((s) => s.kind !== statusKind),
  }
  if (statusKind === 'burn') {
    const before = nextPlayer.hp
    const next = Math.min(nextPlayer.maxHp, before + PURIFY_BURN_HEAL)
    const delta = next - before
    if (delta > 0) {
      nextPlayer = { ...nextPlayer, hp: next }
      events.push({ kind: 'healed', amount: delta })
    }
  }
  return { player: nextPlayer, events }
}

export const FOCUS_TRANSFER = 3

// shape='shatter' → single-target (not AOE), no new blessed flags spawned.
export function resolveShatter(
  player: Player,
  enemies: Enemy[],
  board: Cell[][],
  rng: RngState,
  color: GemColor,
  targetEnemyId: string | null,
  hexedColors: readonly HexedColor[] = [],
): {
  player: Player
  enemies: Enemy[]
  targetEnemyId: string | null
  board: Cell[][]
  rng: RngState
  events: GameEvent[]
} {
  const cellsCleared: Pos[] = []
  for (let y = 0; y < board.length; y++) {
    const row = board[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      if (row[x]?.gemColor === color) {
        cellsCleared.push({ x, y })
      }
    }
  }
  if (cellsCleared.length === 0) {
    return {
      player,
      enemies,
      targetEnemyId,
      board,
      rng,
      events: [],
    }
  }

  const synthMatch: Match = {
    cells: cellsCleared,
    color,
    size: cellsCleared.length,
    shape: 'shatter',
  }
  const cascadeResult = runCascade(board, rng, [synthMatch])

  const processed = processCascadeEvents(
    cascadeResult.events,
    player,
    enemies,
    targetEnemyId,
    hexedColors,
  )

  return {
    player: processed.player,
    enemies: processed.enemies,
    targetEnemyId: processed.targetEnemyId,
    board: cascadeResult.board,
    rng: cascadeResult.rng,
    events: processed.events,
  }
}

export function resolveFocus(
  player: Player,
  from: GemColor,
  to: GemColor,
): { player: Player; events: GameEvent[] } {
  if (from === to) return { player, events: [] }
  if (from === 'purple' || to === 'purple') return { player, events: [] }
  const m = player.mana
  const fromKey = from as keyof ManaPools
  const toKey = to as keyof ManaPools
  const have = m[fromKey]
  const cap = MANA_CAPS[toKey]
  const headroom = cap - m[toKey]
  const moved = Math.max(0, Math.min(have, FOCUS_TRANSFER, headroom))
  if (moved <= 0) return { player, events: [] }
  return {
    player: {
      ...player,
      mana: {
        ...m,
        [fromKey]: m[fromKey] - moved,
        [toKey]: m[toKey] + moved,
      },
    },
    events: [],
  }
}
