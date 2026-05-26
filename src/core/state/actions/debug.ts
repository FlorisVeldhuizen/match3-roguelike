import { generateBoard } from '../../board/generation'
import { runOnRoundStarted, snapshotOf } from '../../relics/engine'
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
    // Mana resets per fight — see nodes.ts for the rationale.
    const boardRoll = generateBoard(current.rng.board)
    runOnRoundStarted(
      { fightId: 0 },
      enemyRoll.fight.player.relics,
      snapshotOf(
        enemyRoll.fight.player,
        enemyRoll.fight.enemies,
        enemyRoll.fight.targetEnemyId,
        0,
      ),
    )
    set((s) => {
      s.fight = enemyRoll.fight
      s.rng.enemy = enemyRoll.rng
      // freshBoardState resets every board-affecting field together —
      // cells (wipes gem-bound flags), selected, petrifiedRows, and
      // any future addition. Mirrors enterNode's reset.
      s.board = freshBoardState(boardRoll.board)
      s.rng.board = boardRoll.rng
      s.fightCounter += 1
      s.runPhase = 'fight'
      s.boardTargetingSpell = null
    })
  }
}
