import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { RngState } from '../rng/mulberry32'
import { generateBoard, hasValidSwap } from '../board/generation'
import { resolveSwap, type SwapResolution } from '../board/cascade'
import { forkStreams, type RngStreams } from '../rng/streams'
import {
  applyPoolDeltas,
  beginPlayerPhase,
  resolveEndOfPhase,
} from '../combat/turn'
import { executeEnemyTurn } from '../combat/enemyTurn'
import { rollIntent } from '../combat/intents'
import { applyDamage } from '../combat/damage'
import {
  computeMatchPayouts,
  hasExtraTurnMatch,
  withPoolGainedEvents,
} from '../combat/pools'
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  type Cell,
  type CombatPhase,
  type Enemy,
  type FightState,
  type GameEvent,
  type Player,
  type Pos,
  type SpellId,
  type UltimateId,
} from '../../types'
import { getArchetype } from '../combat/archetypeRegistry'
import { composeDamage } from '../combat/statuses'
import { getSpell, getUltimate } from '../combat/spellRegistry'

export type BoardState = {
  width: number
  height: number
  cells: Cell[][]
  selected: Pos | null
}

export type GameStore = {
  board: BoardState
  rng: RngStreams
  rootSeed: string
  fight: FightState
  selectCell: (pos: Pos | null) => void
  attemptSwap: (a: Pos, b: Pos) => { valid: boolean; events: GameEvent[] }
  castSpell: (id: SpellId) => { ok: boolean; events: GameEvent[] }
  castUltimate: (id: UltimateId) => { ok: boolean; events: GameEvent[] }
  restart: () => void
}

const PLAYER_MAX_HP = 40

function freshPlayer(): Player {
  return {
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    block: 0,
    mana: 0,
    skillCharge: 0,
    phasePools: { red: 0, blue: 0, green: 0 },
    statuses: [],
    pendingSpells: [],
  }
}

function freshFight(enemyRng: RngState): { fight: FightState; rng: RngState } {
  const archetype = 'brute'
  const def = getArchetype(archetype)
  const first = rollIntent(archetype, 0, enemyRng)
  const enemy: Enemy = {
    id: 'enemy-1',
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
  }
  return {
    fight: {
      phase: 'player-acting',
      player: freshPlayer(),
      enemies: [enemy],
      targetEnemyId: enemy.id,
    },
    rng: first.rng,
  }
}

function initialState(seed: string): {
  board: BoardState
  rng: RngStreams
  rootSeed: string
  fight: FightState
} {
  const streams = forkStreams(seed)
  const { board, rng: nextBoardRng } = generateBoard(streams.board)
  const { fight, rng: nextEnemyRng } = freshFight(streams.enemy)
  return {
    board: {
      width: BOARD_WIDTH,
      height: BOARD_HEIGHT,
      cells: board,
      selected: null,
    },
    rng: { ...streams, board: nextBoardRng, enemy: nextEnemyRng },
    rootSeed: seed,
    fight,
  }
}

function newSliceSeed(): string {
  return `slice-${Math.floor(Math.random() * 1e9).toString(36)}`
}

const SLICE_SEED = newSliceSeed()

export const useGameStore = create<GameStore>()(
  immer((set, get) => ({
    ...initialState(SLICE_SEED),
    selectCell: (pos) =>
      set((s) => {
        s.board.selected = pos
      }),
    attemptSwap: (a, b) => {
      const current = get()

      if (
        current.fight.phase === 'victory' ||
        current.fight.phase === 'game-over'
      ) {
        return { valid: false, events: [] }
      }

      let phase: CombatPhase = current.fight.phase
      let player = current.fight.player

      if (phase !== 'player-acting') {
        return { valid: false, events: [] }
      }

      const swap: SwapResolution = resolveSwap(
        current.board.cells,
        current.rng.board,
        a,
        b,
      )

      if (!swap.valid) {
        return { valid: false, events: swap.events }
      }

      let enemies = current.fight.enemies
      let targetEnemyId = current.fight.targetEnemyId
      let enemyRng = current.rng.enemy

      const deltas = computeMatchPayouts(swap.events)
      const decoratedSwap = withPoolGainedEvents(swap.events)
      player = applyPoolDeltas(player, deltas)

      // Walk the pool-gained-decorated stream and, after each red/green
      // pool-gained, apply the matched amount and inject a follow-up
      // damage-dealt / healed event in-place so damage and heal commit
      // *with* their gem match (animation-timed). Block (blue) still
      // pools to EOP — defensive setup must be ready before the enemy
      // attack.
      const damageHealStream: GameEvent[] = []
      for (const ev of decoratedSwap) {
        damageHealStream.push(ev)
        if (ev.kind !== 'pool-gained') continue
        if (ev.color === 'red') {
          if (targetEnemyId == null) continue
          const target = enemies.find((e) => e.id === targetEnemyId)
          if (!target || target.hp <= 0) continue
          const finalDmg = composeDamage(ev.amount, player.statuses, target.statuses)
          const res = applyDamage(target.block, target.hp, finalDmg)
          if (res.blocked + res.hpDamage <= 0) continue
          enemies = enemies.map((e) =>
            e.id === target.id
              ? { ...e, block: res.blockAfter, hp: res.hpAfter }
              : e,
          )
          damageHealStream.push({
            kind: 'damage-dealt',
            targetId: target.id,
            amount: res.hpDamage,
            blocked: res.blocked,
            source: 'player-attack',
          })
          if (res.blockBroken) {
            damageHealStream.push({ kind: 'block-broken', targetId: target.id })
          } else if (res.blockAbsorbed) {
            damageHealStream.push({
              kind: 'block-absorbed',
              targetId: target.id,
            })
          }
          if (res.killed) {
            damageHealStream.push({ kind: 'enemy-killed', enemyId: target.id })
            const nextLiving = enemies.find(
              (e) => e.id !== target.id && e.hp > 0,
            )
            targetEnemyId = nextLiving?.id ?? null
          }
        } else if (ev.color === 'green') {
          const before = player.hp
          const next = Math.min(player.maxHp, player.hp + ev.amount)
          const healed = next - before
          if (healed <= 0) continue
          player = { ...player, hp: next }
          damageHealStream.push({ kind: 'healed', amount: healed })
        }
      }

      // Post-cascade playability check. If the settled board has no
      // legal swap (rare with 5 colors on 8×8, but possible), regenerate
      // a fresh playable board and emit a `board-shuffled` event so the
      // animator can sell it. The reshuffle does not consume the turn.
      let finalBoard = swap.board
      let finalBoardRng = swap.rng
      const shuffleEvents: GameEvent[] = []
      if (!hasValidSwap(finalBoard)) {
        const regen = generateBoard(finalBoardRng)
        finalBoard = regen.board
        finalBoardRng = regen.rng
        const cells: { at: Pos; color: import('../../types').GemColor }[] = []
        for (let y = 0; y < finalBoard.length; y++) {
          const row = finalBoard[y]
          if (!row) continue
          for (let x = 0; x < row.length; x++) {
            const cell = row[x]
            if (!cell) continue
            cells.push({ at: { x, y }, color: cell.gemColor })
          }
        }
        shuffleEvents.push({ kind: 'board-shuffled', cells })
      }

      const tailEvents: GameEvent[] = []

      // 4+ matches grant an extra turn — UNLESS the swap also killed the
      // last enemy, in which case we want to fall through to
      // resolveEndOfPhase so the victory transition fires now, not on the
      // next swap.
      const anyEnemyAlive = enemies.some((e) => e.hp > 0)
      const extraTurn = anyEnemyAlive && hasExtraTurnMatch(swap.events)
      if (extraTurn) {
        // Stamp the first 4+ match in the stream so the animator pops the
        // "+1 TURN" callout at the moment of contact instead of waiting for
        // a post-cascade banner.
        for (let i = 0; i < damageHealStream.length; i++) {
          const ev = damageHealStream[i]
          if (ev && ev.kind === 'match-found' && ev.size >= 4) {
            damageHealStream[i] = { ...ev, grantsExtraTurn: true }
            break
          }
        }
        tailEvents.push({ kind: 'extra-turn-granted' })
      }

      if (!extraTurn) {
        const resolved = resolveEndOfPhase(player, enemies, targetEnemyId)
        player = resolved.player
        enemies = resolved.enemies
        targetEnemyId = resolved.targetEnemyId
        phase = resolved.phase
        tailEvents.push(...resolved.events)

        // If enemies still alive, enemy turn fires now. Then begin next player
        // phase so block zeroes and pools reset before the player swaps again.
        if (phase === 'enemy-acting') {
          const enemyResult = executeEnemyTurn(player, enemies, enemyRng)
          player = enemyResult.player
          enemies = enemyResult.enemies
          enemyRng = enemyResult.rng
          phase = enemyResult.phase
          tailEvents.push(...enemyResult.events)

          if (phase === 'player-acting') {
            const begin = beginPlayerPhase(player)
            player = begin.player
            phase = begin.phase
            tailEvents.push(...begin.events)
            if (phase === 'game-over') {
              tailEvents.push({ kind: 'phase-changed', phase: 'game-over' })
            }
          }
        }
      }

      set((s) => {
        s.board.cells = finalBoard
        s.rng.board = finalBoardRng
        s.rng.enemy = enemyRng
        s.board.selected = null
        s.fight.phase = phase
        s.fight.player = player
        s.fight.enemies = enemies
        s.fight.targetEnemyId = targetEnemyId
      })

      return {
        valid: true,
        events: [...damageHealStream, ...shuffleEvents, ...tailEvents],
      }
    },
    // Free-action spell cast. Cost paid on cast; effect resolves at EOP
     // (Bulwark/Reinforce) or on the next enemy attack (Riposte).
    // 01-design rules: cast window = player phase + board settled + can
    // pay cost. "Board settled" check belongs in UI (button disabled
    // while AnimationController is draining) — engine just gates on
    // phase and cost.
    castSpell: (id: SpellId) => {
      const current = get()
      if (current.fight.phase !== 'player-acting') {
        return { ok: false, events: [] }
      }
      if (current.fight.player.pendingSpells.includes(id)) {
        return { ok: false, events: [] }
      }
      const def = getSpell(id)
      if (current.fight.player.mana < def.manaCost) {
        return { ok: false, events: [] }
      }
      const event: GameEvent = { kind: 'spell-cast', spellId: id }
      set((s) => {
        s.fight.player.mana -= def.manaCost
        s.fight.player.pendingSpells.push(id)
      })
      return { ok: true, events: [event] }
    },
    castUltimate: (id: UltimateId) => {
      const current = get()
      if (current.fight.phase !== 'player-acting') {
        return { ok: false, events: [] }
      }
      if (current.fight.player.pendingSpells.includes(id)) {
        return { ok: false, events: [] }
      }
      const def = getUltimate(id)
      if (current.fight.player.skillCharge < def.chargeCost) {
        return { ok: false, events: [] }
      }
      const event: GameEvent = { kind: 'spell-cast', spellId: id }
      set((s) => {
        s.fight.player.skillCharge -= def.chargeCost
        s.fight.player.pendingSpells.push(id)
      })
      return { ok: true, events: [event] }
    },
    restart: () => {
      const fresh = initialState(newSliceSeed())
      set((s) => {
        s.board = fresh.board
        s.rng = fresh.rng
        s.rootSeed = fresh.rootSeed
        s.fight = fresh.fight
      })
    },
  })),
)
