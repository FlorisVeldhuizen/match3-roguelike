import { type RngState } from '../rng/mulberry32'
import {
  MANA_CAPS,
  type Cell,
  type DrainedColor,
  type Enemy,
  type GameEvent,
  type GemColor,
  type HexedColor,
  type ManaPools,
  type Match,
  type WardedRows,
  type Player,
  type Pos,
  type StatusInstance,
  type StatusKind,
} from '../../types'
import { nextInt } from '../rng/mulberry32'
import { applyStatusToList } from './statuses'
import { runCascade } from '../board/cascade'
import { detectMatches } from '../board/detectMatches'
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
  const updated = enemies.map((e) => (e.id === targetEnemyId ? { ...e, statuses: newStatuses } : e))
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
  const updated = enemies.map((e) => (e.id === targetEnemyId ? { ...e, statuses: newStatuses } : e))
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
    nextEnemies = enemies.map((e) => (e.id === targetEnemyId ? { ...e, statuses: newStatuses } : e))
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
  const events: GameEvent[] = [{ kind: 'status-expired', target: 'player', statusKind }]
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
  drainedColors: readonly DrainedColor[] = [],
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
    drainedColors,
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

// ---------- Transmute ----------
// Swap all gems of `fromColor` to `toColor` on the board. Triggers cascade.
export function resolveTransmute(
  board: Cell[][],
  fromColor: GemColor,
  toColor: GemColor,
  rng: RngState,
  player: Player,
  enemies: Enemy[],
  targetEnemyId: string | null,
  hexedColors: readonly HexedColor[],
  drainedColors: readonly DrainedColor[],
): {
  board: Cell[][]
  rng: RngState
  player: Player
  enemies: Enemy[]
  targetEnemyId: string | null
  events: GameEvent[]
} {
  if (fromColor === toColor) {
    return { board, rng, player, enemies, targetEnemyId, events: [] }
  }
  const transmuted: { at: Pos; color: GemColor }[] = []
  const nextBoard = board.map((row, y) =>
    row.map((cell, x) => {
      if (cell.gemColor !== fromColor) return cell
      transmuted.push({ at: { x, y }, color: toColor })
      return { ...cell, gemColor: toColor }
    }),
  )
  const prelude: GameEvent[] =
    transmuted.length > 0 ? [{ kind: 'gems-transmuted', cells: transmuted }] : []
  const cascadeResult = runCascade(nextBoard, rng, detectMatches(nextBoard))
  const processed = processCascadeEvents(
    cascadeResult.events,
    player,
    enemies,
    targetEnemyId,
    hexedColors,
    drainedColors,
  )
  return {
    board: cascadeResult.board,
    rng: cascadeResult.rng,
    player: processed.player,
    enemies: processed.enemies,
    targetEnemyId: processed.targetEnemyId,
    events: [...prelude, ...processed.events],
  }
}

// ---------- Blessed Ground ----------
// Bless N random cells.
export const BLESSED_GROUND_COUNT = 4

export function resolveBlessedGround(
  board: Cell[][],
  rng: RngState,
): { board: Cell[][]; rng: RngState; events: GameEvent[] } {
  const candidates: Pos[] = []
  for (let y = 0; y < board.length; y++) {
    const row = board[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      const cell = row[x]
      if (!cell?.flags?.blessed) {
        candidates.push({ x, y })
      }
    }
  }
  let r = rng
  const blessed: Pos[] = []
  let nextBoard = board
  for (let i = 0; i < BLESSED_GROUND_COUNT && candidates.length > 0; i++) {
    const [idx, nr] = nextInt(r, candidates.length)
    r = nr
    const pos = candidates.splice(idx, 1)[0]!
    blessed.push(pos)
    const row = nextBoard[pos.y]!.slice()
    row[pos.x] = {
      ...row[pos.x]!,
      flags: { ...row[pos.x]!.flags, blessed: true },
    }
    const b = nextBoard.slice()
    b[pos.y] = row
    nextBoard = b
  }
  return {
    board: nextBoard,
    rng: r,
    events:
      blessed.length > 0 ? [{ kind: 'tile-blessed-placed', cells: blessed, color: 'gold' }] : [],
  }
}

// ---------- Frozen Wall ----------
// Ward a player-chosen row for 1 turn — enemy board verbs cannot land there.
export function resolveFrozenWall(
  row: number,
  wardedRows: WardedRows,
): { wardedRows: WardedRows; events: GameEvent[] } {
  const duration = 1
  const next: WardedRows = { ...wardedRows, [row]: duration }
  return {
    wardedRows: next,
    events: [{ kind: 'frozen-wall-fired', row, duration }],
  }
}

// ---------- Chain Lightning ----------
// Marks the player's next red match as AOE (handled by cascadeProcessor).
export function resolveChainLightning(player: Player): { player: Player; events: GameEvent[] } {
  return {
    player: {
      ...player,
      chainLightningArmed: true,
    },
    events: [],
  }
}
