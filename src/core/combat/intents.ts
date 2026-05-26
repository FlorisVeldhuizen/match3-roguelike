import type { RngState } from '../rng/mulberry32'
import type {
  Cell,
  Enemy,
  EnemyArchetype,
  GameEvent,
  GemColor,
  Intent,
  IntentKind,
  PetrifiedRows,
  Pos,
} from '../../types'
import { BOARD_HEIGHT, BOARD_WIDTH } from '../../types'
import { setFlag } from '../board/flags'
import { getArchetype } from './archetypeRegistry'
import {
  rollAttackIntent,
  rollBlockIntent,
  rollBuffAllyIntent,
  rollClusterShoveIntent,
  rollColorHexIntent,
  rollColumnSmashIntent,
  rollHealAllyIntent,
  rollPetrifyRowIntent,
  rollShieldAllyIntent,
  rollTileBurnIntent,
} from './intentRollers'

// Roll an intent at a given pattern index. The kind is scripted per archetype
// (deterministic by index); only the numeric value rolls from `rng.enemy`.
// Pattern repeats from the start of every encounter — same intent at same
// turn index regardless of when the player entered (design doc §3).
//
// Per-kind roll logic lives in `intentRollers.ts` — this function is a thin
// dispatcher that looks up the archetype's pattern entry, fans out to the
// right roller, and handles the ally-intent solo-fallback (drop to attack
// when no siblings are alive).
//
// `livingAllies` is required for ally-target intent kinds. The roller picks
// a target deterministically from rng and bakes `targetAllyId` into the
// intent so it can be telegraphed before the intent fires. If no allies are
// alive when an ally-target kind is rolled, the intent falls back to 'attack'
// — this prevents a crash in a solo-enemy encounter or when all allies died
// before this turn.
export function rollIntent(
  archetype: EnemyArchetype,
  patternIndex: number,
  rng: RngState,
  // Optional: pass the full enemy list so the roller can pick a target ally.
  // Includes the rolling enemy itself; the roller excludes it by id.
  livingAllies?: Enemy[],
  rollerEnemyId?: string,
  // Intents already rolled by sibling enemies earlier in this same
  // enemy turn (telegraphed for the next player turn). Each board-
  // affecting roller uses the appropriate slice of these claims to
  // avoid colliding with another enemy's pending effect: two Brutes
  // hitting the same column, a Defender and a Brute landing on the
  // same cells, a Swarmer shoving into a column about to be smashed,
  // etc. See aggregateSiblingClaims / expandClaimsToCells.
  siblingNextIntents: readonly Intent[] = [],
): { intent: Intent; rng: RngState } {
  const def = getArchetype(archetype)
  const kind: IntentKind | undefined = def.pattern[patternIndex % def.pattern.length]
  if (kind === undefined) throw new Error('rollIntent: empty pattern')

  // Aggregate once so every verb roller below shares the same view.
  const claims = aggregateSiblingClaims(siblingNextIntents)

  switch (kind) {
    case 'attack':
      return rollAttackIntent(def, rng)
    case 'block':
      return rollBlockIntent(def, rng)
    case 'tile-burn':
      return rollTileBurnIntent(def, rng)
    case 'heal-ally':
      return (
        rollHealAllyIntent(def, rng, livingAllies ?? [], rollerEnemyId) ??
        rollAttackIntent(def, rng) // solo-fallback
      )
    case 'shield-ally':
      return (
        rollShieldAllyIntent(def, rng, livingAllies ?? [], rollerEnemyId) ??
        rollAttackIntent(def, rng)
      )
    case 'buff-ally':
      return (
        rollBuffAllyIntent(def, rng, livingAllies ?? [], rollerEnemyId) ??
        rollAttackIntent(def, rng)
      )
    case 'column-smash':
      return rollColumnSmashIntent(rng, claims.columns)
    case 'petrify-row':
      return rollPetrifyRowIntent(rng, claims.rows)
    case 'color-hex':
      return rollColorHexIntent(rng, claims.colors)
    case 'cluster-shove':
      // Cell-bound: avoid both raw cell claims AND the cell expansion
      // of column/row axis claims (so a shove can't put gems where
      // another verb will erase them next turn).
      return rollClusterShoveIntent(
        def,
        rng,
        expandClaimsToCells(claims, BOARD_WIDTH, BOARD_HEIGHT),
      )
  }
}

// =====================================================================
// Intent-claim framework
// =====================================================================
// A telegraphed board verb "claims" some part of the board for its
// upcoming effect. Other board verbs rolling on the same turn should
// avoid overlapping that claim — otherwise two telegraphs paint
// markers on the same cell, two effects fire on the same gem, or one
// verb's effect erases another's. This framework lets every roller
// share one aggregated view of what's already spoken for, instead of
// each kind reasoning about the others ad-hoc.
//
// Claim "spaces": each verb adds itself to whichever space is most
// natural. Adding a new verb means (a) extending the type and (b)
// adding a case in addIntentToClaims — no caller changes needed.
//
//   - columns: whole-column effects (column-smash). Other column-bound
//              verbs avoid same-column.
//   - rows:    whole-row effects (petrify-row). Same idea.
//   - cells:   specific-cell effects (cluster-shove source+dst). Cell-
//              bound rollers avoid these AND the cell expansion of
//              column/row claims (via expandClaimsToCells).
//   - colors:  color-pool effects (color-hex). Color-bound rollers
//              avoid same-color.
//
// Future generic example: a hypothetical "3x3 area-clear" verb would
// add the 9 cells to `cells`, and cell-bound siblings would naturally
// avoid them.
export type IntentClaims = {
  columns: Set<number>
  rows: Set<number>
  cells: Set<string> // "x,y" keys
  colors: Set<GemColor>
}

export function emptyClaims(): IntentClaims {
  return { columns: new Set(), rows: new Set(), cells: new Set(), colors: new Set() }
}

// Mutates `claims` to include this intent's footprint. Switch is the
// single place a new verb plugs in.
function addIntentToClaims(intent: Intent, claims: IntentClaims): void {
  if (intent.kind === 'column-smash') {
    claims.columns.add(intent.column)
  } else if (intent.kind === 'petrify-row') {
    claims.rows.add(intent.row)
  } else if (intent.kind === 'cluster-shove') {
    for (const s of intent.sources) claims.cells.add(`${s.x},${s.y}`)
    for (const d of intent.destinations) claims.cells.add(`${d.x},${d.y}`)
  } else if (intent.kind === 'color-hex') {
    claims.colors.add(intent.color)
  }
  // tile-burn is intentionally NOT a claim: it picks cells at fire
  // time (not at roll time) and the resolver's
  // pickClusterCellsWithoutFlag already avoids overlap with existing
  // burning flags. attack/block/ally intents have no board footprint.
}

export function aggregateSiblingClaims(
  siblingNextIntents: readonly Intent[],
): IntentClaims {
  const claims = emptyClaims()
  for (const i of siblingNextIntents) addIntentToClaims(i, claims)
  return claims
}

// Cell-bound rollers (cluster-shove and any future cell-claiming verbs)
// want a single Set of forbidden cells. This expands axis claims
// (columns/rows) into their full cell footprints and merges with the
// already-cell claims. So a sibling Brute claiming column 3 blocks a
// Swarmer's shove from putting a gem anywhere in column 3 — without
// this expansion the Brute's smash would erase the shoved cells next
// turn, producing a visual "shove happened then was erased" beat.
export function expandClaimsToCells(
  claims: IntentClaims,
  boardWidth: number,
  boardHeight: number,
): Set<string> {
  const out = new Set(claims.cells)
  for (const col of claims.columns) {
    for (let y = 0; y < boardHeight; y++) out.add(`${col},${y}`)
  }
  for (const row of claims.rows) {
    for (let x = 0; x < boardWidth; x++) out.add(`${x},${row}`)
  }
  return out
}

// H2b: apply the telegraph flag for board-verb intents (column-smash,
// petrify-row). Called by both freshFight (initial intent) and
// executeEnemyTurn (next intent at end of enemy turn). Returns the
// updated board and petrifiedRows plus any telegraph events for the FX
// layer. No-op for intent kinds that don't have a telegraph flag.
export function applyIntentTelegraph(
  board: Cell[][],
  petrifiedRows: PetrifiedRows,
  intent: Intent,
  enemyId: string,
  archetype: EnemyArchetype,
): {
  board: Cell[][]
  petrifiedRows: PetrifiedRows
  events: GameEvent[]
} {
  if (intent.kind === 'column-smash') {
    // Column-bound threat — no cell flag is written. The overlay tracks
    // the threat by (enemyId, column) from the placed/resolved events,
    // and the resolver smashes the whole column at fire time. `cells`
    // still names every cell in the column for FX layers that want to
    // hang animation anchors per-cell without re-deriving the column.
    const cells: Pos[] = []
    const h = board.length
    for (let y = 0; y < h; y++) {
      cells.push({ x: intent.column, y })
    }
    return {
      board,
      petrifiedRows,
      events: [
        {
          kind: 'column-smash-placed',
          enemyId,
          column: intent.column,
          cells,
        },
      ],
    }
  }
  if (intent.kind === 'color-hex') {
    // Color-hex telegraph: no board mutation — the overlay pulses every
    // gem of the threatened colour by reading enemies[].currentIntent.
    // The active hex set (FightState.hexedColors) is only written when
    // the intent fires next turn (mirrors petrify-row's "telegraph then
    // fire" cadence).
    return {
      board,
      petrifiedRows,
      events: [
        {
          kind: 'color-hex-placed',
          enemyId,
          color: intent.color,
        },
      ],
    }
  }
  if (intent.kind === 'cluster-shove') {
    // Pre-flag each source cell with its own destination. Per-cell flag
    // lets counterplay work independently: matching one source clears
    // its flag without affecting the other. Flags travel with gems under
    // gravity, so the resolver scans the whole board for `pendingShove`
    // and shoves whichever cells still carry the flag at fire time.
    let nextBoard = board
    const len = Math.min(intent.sources.length, intent.destinations.length)
    for (let i = 0; i < len; i++) {
      const src = intent.sources[i]
      const dst = intent.destinations[i]
      if (!src || !dst) continue
      const row = nextBoard[src.y]
      if (!row) continue
      const cell = row[src.x]
      if (!cell) continue
      const updatedCell = setFlag(cell, 'pendingShove', {
        dst,
        sourceEnemyId: enemyId,
      })
      const nextRow = row.slice()
      nextRow[src.x] = updatedCell
      const newBoard = nextBoard.slice()
      newBoard[src.y] = nextRow
      nextBoard = newBoard
    }
    return {
      board: nextBoard,
      petrifiedRows,
      events: [
        {
          kind: 'cluster-shove-placed',
          enemyId,
          sources: intent.sources,
          destinations: intent.destinations,
        },
      ],
    }
  }
  if (intent.kind === 'petrify-row') {
    // Telegraph-only: emit the placed event for the FX layer (so the
    // overlay can render a "warning" treatment on the row), but do NOT
    // mutate petrifiedRows yet. The actual lockout is applied at fire
    // time by resolvePetrifyRowIntent — matching attack semantics
    // (telegraph this turn → effect lands next turn). The pending state
    // is derived by the overlay from enemies[].currentIntent so we
    // don't need to materialize a separate "pending" map.
    const def = getArchetype(archetype)
    const duration = def.petrifyDuration ?? 2
    const cells: Pos[] = []
    const w = board[0]?.length ?? 0
    for (let x = 0; x < w; x++) {
      cells.push({ x, y: intent.row })
    }
    return {
      board,
      petrifiedRows,
      events: [
        {
          kind: 'petrify-placed',
          enemyId,
          row: intent.row,
          cells,
          duration,
        },
      ],
    }
  }
  return { board, petrifiedRows, events: [] }
}
