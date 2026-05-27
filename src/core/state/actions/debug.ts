import { generateBoard } from '../../board/generation'
import { applyCombatEvents } from '../../combat/applyCombatEvents'
import {
  cloneRelicsForHooks,
  runOnRoundStarted,
  snapshotOf,
} from '../../relics/engine'
import type { EnemyArchetype } from '../../../types'
import type { StoreSet, StoreGet } from './types'
import { freshBoardState, freshFight } from './helpers'

export function makeDebugForceFight(set: StoreSet, get: StoreGet) {
  return (archetypes: EnemyArchetype | EnemyArchetype[]): void => {
    const current = get()
    const list = Array.isArray(archetypes) ? archetypes : [archetypes]
    const enemyRoll = freshFight(current.rng.enemy, current.fight.player.relics, {
      archetypes: list,
    })
    enemyRoll.fight.player.hp = Math.min(
      enemyRoll.fight.player.maxHp,
      current.fight.player.hp,
    )
    const boardRoll = generateBoard(current.rng.board)
    const writeRelics = cloneRelicsForHooks(enemyRoll.fight.player.relics)
    const roundEvents = runOnRoundStarted(
      { fightId: 0 },
      writeRelics,
      snapshotOf(
        enemyRoll.fight.player,
        enemyRoll.fight.enemies,
        enemyRoll.fight.targetEnemyId,
        0,
      ),
    )
    const roundApplied = applyCombatEvents(
      roundEvents,
      enemyRoll.fight.player,
      enemyRoll.fight.enemies,
      enemyRoll.fight.targetEnemyId,
    )
    enemyRoll.fight.player = { ...roundApplied.player, relics: writeRelics }
    enemyRoll.fight.enemies = roundApplied.enemies
    enemyRoll.fight.targetEnemyId = roundApplied.targetEnemyId
    set((s) => {
      s.fight = enemyRoll.fight
      s.rng.enemy = enemyRoll.rng
      s.board = freshBoardState(boardRoll.board)
      s.rng.board = boardRoll.rng
      s.fightCounter += 1
      s.runPhase = 'fight'
      s.boardTargetingSpell = null
    })
  }
}
