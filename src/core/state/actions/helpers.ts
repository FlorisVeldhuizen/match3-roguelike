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
    gold: 0,
    ownedSpellIds: listSpells()
      .filter((s) => s.starter === true)
      .map((s) => s.id),
  }
}

// Additive on attack/block so weak archetypes stay weak — amplifier, not identity rewrite.
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
    // Only attack/block scale — other intents would change the verb's design if scaled.
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
      // Pre-applied so enemy is guarded before the player's first move.
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
