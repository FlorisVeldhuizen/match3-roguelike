import type { RngState } from '../rng/mulberry32'
import type {
  Cell,
  Enemy,
  EnemyArchetype,
  GameEvent,
  Intent,
  IntentKind,
  PetrifiedRows,
  Pos,
} from '../../types'
import { getArchetype } from './archetypeRegistry'
import {
  rollAttackIntent,
  rollBlockIntent,
  rollBuffAllyIntent,
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
): { intent: Intent; rng: RngState } {
  const def = getArchetype(archetype)
  const kind: IntentKind | undefined = def.pattern[patternIndex % def.pattern.length]
  if (kind === undefined) throw new Error('rollIntent: empty pattern')

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
      return rollColumnSmashIntent(rng)
    case 'petrify-row':
      return rollPetrifyRowIntent(rng)
  }
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
