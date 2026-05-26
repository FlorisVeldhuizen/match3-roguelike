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
import { applyFlagToCells } from '../board/flags'
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
    // Marker flag (not duration). Stores the source enemy's id so the
    // orphan sweep at the top of executeEnemyTurn can clear flags whose
    // owner died between telegraph and fire.
    const cells: Pos[] = []
    const h = board.length
    for (let y = 0; y < h; y++) {
      cells.push({ x: intent.column, y })
    }
    const nextBoard = applyFlagToCells(board, cells, 'pendingSmash', enemyId)
    return {
      board: nextBoard,
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
    const def = getArchetype(archetype)
    // Default 2 phases of lockout. The row stays petrified across the
    // telegraph phase AND the next phase, decremented at phase start.
    const duration = def.petrifyDuration ?? 2
    const nextPetrifiedRows: PetrifiedRows = {
      ...petrifiedRows,
      [intent.row]: Math.max(petrifiedRows[intent.row] ?? 0, duration),
    }
    // Emit cells for the FX layer even though storage is row-level —
    // overlays render per cell, so packaging the positions here keeps
    // the consumer simple.
    const cells: Pos[] = []
    const w = board[0]?.length ?? 0
    for (let x = 0; x < w; x++) {
      cells.push({ x, y: intent.row })
    }
    return {
      board,
      petrifiedRows: nextPetrifiedRows,
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
