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

// Ally-target intents fall back to 'attack' when no siblings are alive.
export function rollIntent(
  archetype: EnemyArchetype,
  patternIndex: number,
  rng: RngState,
  livingAllies?: Enemy[],
  rollerEnemyId?: string,
  siblingNextIntents: readonly Intent[] = [],
): { intent: Intent; rng: RngState } {
  const def = getArchetype(archetype)
  const kind: IntentKind | undefined = def.pattern[patternIndex % def.pattern.length]
  if (kind === undefined) throw new Error('rollIntent: empty pattern')

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
      return rollClusterShoveIntent(
        def,
        rng,
        expandClaimsToCells(claims, BOARD_WIDTH, BOARD_HEIGHT),
      )
  }
}

export type IntentClaims = {
  columns: Set<number>
  rows: Set<number>
  cells: Set<string> // "x,y" keys
  colors: Set<GemColor>
}

export function emptyClaims(): IntentClaims {
  return { columns: new Set(), rows: new Set(), cells: new Set(), colors: new Set() }
}

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
  // tile-burn picks cells at fire time, not roll time — no claim needed.
}

export function aggregateSiblingClaims(
  siblingNextIntents: readonly Intent[],
): IntentClaims {
  const claims = emptyClaims()
  for (const i of siblingNextIntents) addIntentToClaims(i, claims)
  return claims
}

// Expands column/row claims into cell-level claims so cell-bound
// verbs (shove) avoid areas another verb will erase next turn.
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
    // Per-cell flags travel with gravity; matching a source clears its flag (counterplay).
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
    // Telegraph only — actual lockout applied by resolver next turn.
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
