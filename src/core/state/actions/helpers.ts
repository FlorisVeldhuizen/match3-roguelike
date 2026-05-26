import { nextInt, type RngState } from '../../rng/mulberry32'
import { rollIntent } from '../../combat/intents'
import { getArchetype } from '../../combat/archetypeRegistry'
import { resetFightFlags } from '../../relics/engine'
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  type Cell,
  type Enemy,
  type EnemyArchetype,
  type FightState,
  type RelicInstance,
} from '../../../types'
import type { BoardState } from '../store'

const PLAYER_MAX_HP = 40

// Single source of truth for a "clean" BoardState — used by every
// new-fight transition (enterNode, debugForceFight, restart's
// initialState). All board-affecting effects reset here: cells get
// the freshly-generated grid (which wipes gem-bound flags like
// burning); board-level state (selected, petrifiedRows, and any
// future addition like a frozen-tiles map or a global board
// modifier) is reset to its empty default. Adding a new board-level
// effect means extending this helper, not chasing every reset site.
export function freshBoardState(cells: Cell[][]): BoardState {
  return {
    width: BOARD_WIDTH,
    height: BOARD_HEIGHT,
    cells,
    selected: null,
    petrifiedRows: {},
  }
}

export function freshPlayer(relics: RelicInstance[] = []) {
  return {
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    block: 0,
    mana: { red: 0, blue: 0, green: 0, yellow: 0 },
    skillCharge: 0,
    phasePools: { red: 0, blue: 0, green: 0 },
    statuses: [],
    pendingSpells: [],
    carryBlockNextPhase: false,
    relics,
    // Phase I: run-persistent currency. freshPlayer is called per-fight,
    // so callers that want to carry gold across fights (enterNode) must
    // copy it over after — same pattern as HP.
    gold: 0,
  }
}

export function freshFight(
  enemyRng: RngState,
  relics: RelicInstance[] = [],
  options: { archetypes?: EnemyArchetype[]; isBoss?: boolean } = {},
): { fight: FightState; rng: RngState } {
  // H2a: archetypes is a list (length 1-3 today; boss stays length 1).
  // If absent (boot sentinel, tests that bypass the map), fall back to
  // a single rng pick over the current archetype pool.
  let archetypes = options.archetypes
  let workingRng = enemyRng
  if (!archetypes || archetypes.length === 0) {
    const candidates: EnemyArchetype[] = ['brute', 'smolder', 'skirmisher']
    const [archIdx, n] = nextInt(enemyRng, candidates.length)
    archetypes = [candidates[archIdx] ?? 'brute']
    workingRng = n
  }
  const builtEnemies: Enemy[] = []
  archetypes.forEach((archetype, i) => {
    const def = getArchetype(archetype)
    const first = rollIntent(archetype, 0, workingRng)
    workingRng = first.rng
    builtEnemies.push({
      id: `enemy-${i + 1}`,
      name: def.name,
      archetype,
      hp: def.maxHp,
      maxHp: def.maxHp,
      // Initial block intent is pre-applied so the enemy is already
      // guarded when the player makes their first move. Mirrors the
      // telegraph-time pre-application done by executeEnemyTurn.
      block: first.intent.kind === 'block' ? first.intent.amount : 0,
      currentIntent: first.intent,
      nextIntentIndex: 0,
      statuses: [],
    })
  })
  const fight: FightState = {
    phase: 'player-acting',
    player: freshPlayer(resetFightFlags(relics)),
    enemies: builtEnemies,
    targetEnemyId: builtEnemies[0]?.id ?? null,
    hexedColors: [],
  }
  if (options.isBoss) fight.isBoss = true
  return {
    fight,
    rng: workingRng,
  }
}
