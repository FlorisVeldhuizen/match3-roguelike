import { nextInt, type RngState } from '../../rng/mulberry32'
import { rollIntent } from '../../combat/intents'
import { getArchetype } from '../../combat/archetypeRegistry'
import { resetFightFlags } from '../../relics/engine'
import { listSpells } from '../../combat/spellRegistry'
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
    // Phase I: seed owned-spell set from the registry's starter flag.
    // Carries across fights via enterNode (mirrors gold / relics). Tests
    // that bypass the registry get an empty list — harmless because the
    // spell tray would just render nothing.
    ownedSpellIds: listSpells()
      .filter((s) => s.starter === true)
      .map((s) => s.id),
  }
}

// Phase I elite scaling. Applied per-enemy when freshFight is called with
// isElite=true. Hand-tuned to feel like a "tougher version of the same
// archetype": +40% HP, +1 to attack & block telegraphs. Stays additive on
// block / attack so weak archetypes still feel weak — the scaler is a
// danger amplifier, not an identity rewrite.
const ELITE_HP_SCALAR = 1.4
const ELITE_INTENT_BONUS = 1

export function freshFight(
  enemyRng: RngState,
  relics: RelicInstance[] = [],
  options: {
    archetypes?: EnemyArchetype[]
    isBoss?: boolean
    isElite?: boolean
  } = {},
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
  const isElite = options.isElite === true
  const builtEnemies: Enemy[] = []
  archetypes.forEach((archetype, i) => {
    const def = getArchetype(archetype)
    const first = rollIntent(archetype, 0, workingRng)
    workingRng = first.rng
    // Elite scaling: bump HP and (for attack / block intents) the rolled
    // amount. Other intent kinds (column-smash, petrify-row, ally-buff,
    // etc.) keep their telegraphed payload — scaling them would distort
    // the verb's design (e.g. a 2× column-smash is "smashes 2 columns",
    // a different mechanic, not a tougher version of the same one).
    const baseHp = isElite ? Math.round(def.maxHp * ELITE_HP_SCALAR) : def.maxHp
    let intent = first.intent
    let blockSeed = intent.kind === 'block' ? intent.amount : 0
    if (isElite) {
      if (intent.kind === 'attack') {
        intent = { ...intent, amount: intent.amount + ELITE_INTENT_BONUS }
      } else if (intent.kind === 'block') {
        intent = { ...intent, amount: intent.amount + ELITE_INTENT_BONUS }
        blockSeed = intent.amount
      }
    }
    builtEnemies.push({
      id: `enemy-${i + 1}`,
      name: def.name,
      archetype,
      hp: baseHp,
      maxHp: baseHp,
      // Initial block intent is pre-applied so the enemy is already
      // guarded when the player makes their first move. Mirrors the
      // telegraph-time pre-application done by executeEnemyTurn.
      block: blockSeed,
      currentIntent: intent,
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
  if (isElite) fight.isElite = true
  return {
    fight,
    rng: workingRng,
  }
}
