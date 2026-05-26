import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { generateBoard } from '../board/generation'
import { forkStreams, type RngStreams } from '../rng/streams'
import {
  type Cell,
  type EnemyArchetype,
  type FightState,
  type GameEvent,
  type GemColor,
  type MapState,
  type PendingReward,
  type PetrifiedRows,
  type Pos,
  type RunPhase,
  type SpellId,
  type StatusKind,
  type UltimateId,
} from '../../types'
import { generateMap } from '../map/generate'
import { getSpell } from '../combat/spellRegistry'
import { canAffordSpell } from '../combat/mana'
import { makeDebugForceFight } from './actions/debug'
import { makeAcquireRelic, makeSkipReward } from './actions/rewards'
import { makeEnterNode, makeRestart } from './actions/nodes'
import { freshBoardState, freshPlayer } from './actions/helpers'
import {
  makeCastSpell,
  makeCastPurify,
  makeCastFocus,
  makeCastVolley,
  makeCastShatter,
  makeCastUltimate,
} from './actions/spells'
import { makeSelectCell, makeSetTargetEnemy, makeAttemptSwap } from './actions/swap'

export type BoardState = {
  width: number
  height: number
  cells: Cell[][]
  selected: Pos | null
  // H2b: row index → player phases remaining for Defender's petrify
  // lockout. detectMatches reads this to exclude petrified rows as
  // match anchors. Position-bound (does NOT travel with gems via
  // gravity — the row stays locked regardless of which gems flow
  // through). Empty by default; entries cleared when ticking to 0.
  petrifiedRows: PetrifiedRows
}

export type GameStore = {
  board: BoardState
  rng: RngStreams
  rootSeed: string
  fight: FightState
  // Monotonic counter bumped each time a fresh fight starts (enterNode for
  // fight/elite/boss, restart). UI layers (Pixi BoardScene, HUD displays)
  // watch this for "rebuild from scratch" — wholesale board.cells swaps
  // are otherwise invisible to subscribers that compare references.
  fightCounter: number
  // Rolled when a non-boss fight transitions to 'victory'; nulled by
  // acquireRelic / skipReward. UI mounts RewardScreen on runPhase==='reward'.
  pendingReward: PendingReward | null
  // H1: procedural map + run-level phase machine. runPhase drives the
  // top-level screen (map / fight / reward / victory / game-over) while
  // fight.phase still drives in-fight transitions.
  map: MapState
  runPhase: RunPhase
  selectCell: (pos: Pos | null) => void
  // Manual target override (click-to-target). Only valid during
  // 'player-acting'; no-op on dead/missing enemies. Auto-reselect on kill
  // is handled inline in attemptSwap / resolveEndOfPhase already.
  setTargetEnemy: (id: string) => void
  attemptSwap: (a: Pos, b: Pos) => { valid: boolean; events: GameEvent[] }
  castSpell: (id: SpellId) => { ok: boolean; events: GameEvent[] }
  castUltimate: (id: UltimateId) => { ok: boolean; events: GameEvent[] }
  // H4a picker-arg spells. UI opens a modal on the spell-tray button
  // click and dispatches the action below on confirm.
  castPurify: (statusKind: StatusKind) => {
    ok: boolean
    events: GameEvent[]
  }
  castFocus: (
    from: GemColor,
    to: GemColor,
  ) => { ok: boolean; events: GameEvent[] }
  castVolley: (targets: string[]) => {
    ok: boolean
    events: GameEvent[]
  }
  castShatter: (color: GemColor) => { ok: boolean; events: GameEvent[] }
  // Board-pick targeting mode for spells that read a cell click as
  // their arg (H2b.5 Shatter is the first; future Banish / Mark /
  // Petrify-player will plug into the same field). null = normal swap
  // mode; otherwise the id of the spell currently awaiting a click.
  // BoardScene reads this and dispatches per-spell on pointer-down.
  // Cleared by a successful cast, by ESC, or on fight reset.
  boardTargetingSpell: SpellId | null
  // Enter board-targeting mode for the named spell. Gates on player
  // phase + spell affordability. Returns true if the mode was entered,
  // false if refused — the UI can use this to keep the button pressed
  // visual in sync.
  beginBoardTargeting: (spellId: SpellId) => boolean
  cancelBoardTargeting: () => void
  acquireRelic: (id: string) => { ok: boolean; events: GameEvent[] }
  skipReward: () => void
  // Map navigation. Validates against getReachableFrom; no-op on invalid
  // target. Spins up a fresh fight for fight/elite/boss nodes; auto-
  // completes shop/rest nodes for H1 (Phase I implements them).
  enterNode: (nodeId: string) => void
  restart: () => void
  // Dev-only: rewrites board.cells to a safe (no-match) palette pattern
  // with a planted line-5 prereq, then returns the swap coords that
  // will trigger the match-5 cascade. Caller (DevTools) dispatches the
  // actual swap via the debug bus so animations play normally through
  // BoardScene.performSwap. Bumps fightCounter so the BoardScene
  // rebuilds sprites against the new cells.
  debugForceMatch5: () => { from: Pos; to: Pos } | null
  // Dev-only: force-start a fight against the given archetype, bypassing
  // map navigation. HP + mana carry from the current fight state (same
  // semantics as enterNode), but no map node is marked completed and
  // currentNodeId is left untouched — purely a sandbox.
  debugForceFight: (archetypes: EnemyArchetype | EnemyArchetype[]) => void
}

function initialState(seed: string): {
  board: BoardState
  rng: RngStreams
  rootSeed: string
  fight: FightState
  fightCounter: number
  pendingReward: PendingReward | null
  map: MapState
  runPhase: RunPhase
  boardTargetingSpell: SpellId | null
} {
  const streams = forkStreams(seed)
  // H1: map is rolled at boot; the fight roll is deferred to enterNode so
  // each fight-node entry consumes rng.enemy in node-order. The sentinel
  // board + fight below exist purely to satisfy non-null UI contracts —
  // they are overwritten the moment the player picks a fight node.
  const { board, rng: nextBoardRng } = generateBoard(streams.board)
  const { map, rng: nextMapRng } = generateMap(streams.map)
  const sentinelFight: FightState = {
    phase: 'player-acting',
    player: freshPlayer([]),
    enemies: [],
    targetEnemyId: null,
  }
  return {
    board: freshBoardState(board),
    rng: { ...streams, board: nextBoardRng, map: nextMapRng },
    rootSeed: seed,
    fight: sentinelFight,
    fightCounter: 0,
    pendingReward: null,
    map,
    runPhase: 'map',
    boardTargetingSpell: null,
  }
}

function newSliceSeed(): string {
  return `slice-${Math.floor(Math.random() * 1e9).toString(36)}`
}

const SLICE_SEED = newSliceSeed()

export const useGameStore = create<GameStore>()(
  immer((set, get) => ({
    ...initialState(SLICE_SEED),
    selectCell: makeSelectCell(set, get),
    setTargetEnemy: makeSetTargetEnemy(set, get),
    attemptSwap: makeAttemptSwap(set, get),
    castSpell: makeCastSpell(set, get),
    castPurify: makeCastPurify(set, get),
    castFocus: makeCastFocus(set, get),
    castVolley: makeCastVolley(set, get),
    castShatter: makeCastShatter(set, get),
    beginBoardTargeting: (spellId) => {
      // Gate: must be the player's turn AND the spell must be
      // affordable. Per-spell extra gates (e.g. "no gems of any
      // colour" for Shatter, which is impossible mid-fight but
      // defensive) live in the cast action itself, so this can stay
      // generic across future board-pick spells.
      const s = get()
      if (s.fight.phase !== 'player-acting') return false
      const def = getSpell(spellId)
      if (!canAffordSpell(s.fight.player.mana, def.cost)) return false
      set((st) => {
        st.boardTargetingSpell = spellId
      })
      return true
    },
    cancelBoardTargeting: () => {
      set((s) => {
        s.boardTargetingSpell = null
      })
    },
    castUltimate: makeCastUltimate(set, get),
    acquireRelic: makeAcquireRelic(set, get),
    skipReward: makeSkipReward(set, get),
    enterNode: makeEnterNode(set, get),
    restart: makeRestart(set, get, () => initialState(newSliceSeed())),
    debugForceMatch5: () => {
      // Hard guard: only valid while the player can swap. Avoids running
      // during a cascade or enemy turn (which would clash with the AC
      // queue) or at game-over / victory (where attemptSwap returns
      // invalid anyway).
      const cur = get()
      if (cur.fight.phase !== 'player-acting') return null

      // Safe 3-color rotation: palette[(x + y) % 3] produces no 3-runs
      // anywhere. Same trick as cascade.test.ts's buildSafeBoard. We
      // then overlay the line-5 prereq: 4 blues at row 3 cols 1, 2, 4,
      // 5 (split so the row has no pre-existing match), with a blue at
      // (3, 4) that will swap up into (3, 3) to complete the line. (3,
      // 3) is left at the palette default (red per (3+3)%3) so the
      // pre-swap board is match-free.
      const palette: ('red' | 'green' | 'yellow')[] = ['red', 'green', 'yellow']
      set((s) => {
        const cells = s.board.cells
        for (let y = 0; y < cells.length; y++) {
          const row = cells[y]
          if (!row) continue
          for (let x = 0; x < row.length; x++) {
            row[x] = { gemColor: palette[(x + y) % 3] ?? 'red' }
          }
        }
        const row3 = cells[3]
        const row4 = cells[4]
        if (!row3 || !row4) return
        for (const x of [1, 2, 4, 5]) {
          row3[x] = { gemColor: 'blue' }
        }
        row4[3] = { gemColor: 'blue' }
        s.board.selected = null
        // Bump fightCounter so subscribers (BoardScene sprite grid,
        // BurningOverlay, BlessedOverlay) rebuild against the new cells.
        s.fightCounter += 1
      })
      return { from: { x: 3, y: 4 }, to: { x: 3, y: 3 } }
    },
    debugForceFight: makeDebugForceFight(set, get),
  })),
)
