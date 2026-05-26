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
  type ShopOffer,
  type SpellId,
  type StatusKind,
  type UltimateId,
} from '../../types'
import { generateMap } from '../map/generate'
import { getSpell } from '../combat/spellRegistry'
import { canAffordSpell } from '../combat/mana'
import { makeDebugForceFight } from './actions/debug'
import {
  makeAcquireRelic,
  makeAcquireSpellReward,
  makeSkipReward,
} from './actions/rewards'
import {
  makeLeaveRest,
  makeRestHeal,
  makeRestUpgrade,
} from './actions/rest'
import {
  makeLeaveShop,
  makeRollShopOffer,
  makeShopBuyHeal,
  makeShopBuyRelic,
  makeShopBuySpell,
  makeShopRemoveRelic,
} from './actions/shop'
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
  // Phase I shop state. Rolled when a shop node is entered; nulled when
  // the player leaves. Mutated in-place when items are purchased so the
  // UI can render "sold out" rows.
  currentShopOffer: ShopOffer | null
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
  // Phase I: add a discoverable spell to the player's owned set (from
  // shop). No-op if already owned. Returns ok=false if the id isn't a
  // registered spell so callers can keep their UI honest about a stale
  // offer. For spell-kind reward offers (post-fight), use
  // acquireSpellReward instead — that path also credits the reward's
  // gold and clears pendingReward.
  acquireSpell: (id: SpellId) => { ok: boolean }
  acquireSpellReward: (id: SpellId) => { ok: boolean }
  // Phase I rest node — exactly one of these fires (or leaveRest if the
  // player backs out without picking).
  restHeal: () => { ok: boolean }
  restUpgrade: (relicId: string) => { ok: boolean }
  leaveRest: () => void
  // Phase I shop. rollShopOfferIfNeeded is idempotent — safe for the
  // screen to call on every mount; only the first call after entering
  // the shop actually rolls.
  rollShopOfferIfNeeded: () => void
  shopBuyRelic: (relicId: string) => { ok: boolean }
  shopBuySpell: (spellId: SpellId) => { ok: boolean }
  shopBuyHeal: (kind: 'small' | 'big') => { ok: boolean }
  shopRemoveRelic: (relicId: string) => { ok: boolean }
  leaveShop: () => void
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
  // Dev-only: same pattern as debugForceMatch5 but plants a T-shape
  // prereq (interior intersection, blue 3-across at row 3 + 3-down at
  // col 2). Triggers the 3x3 area clear and the T-BURST! callout.
  debugForceMatchT: () => { from: Pos; to: Pos } | null
  // Dev-only: L-shape prereq (corner intersection, blue 3-across at
  // row 3 + 3-down at col 3 meeting at (3,3)). Triggers the +-shape
  // clear and the L-FLARE! callout.
  debugForceMatchL: () => { from: Pos; to: Pos } | null
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
  currentShopOffer: ShopOffer | null
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
    currentShopOffer: null,
    map,
    runPhase: 'map',
    boardTargetingSpell: null,
  }
}

function newSliceSeed(): string {
  return `slice-${Math.floor(Math.random() * 1e9).toString(36)}`
}

// Dev-only: paint a 3-color rotation that produces no 3-runs anywhere
// (palette[(x+y) % 3]). Shared by debugForceMatch5 / debugForceMatchT /
// debugForceMatchL so they can overlay the shape-specific prereq onto a
// guaranteed match-free base.
const SAFE_PALETTE: readonly ('red' | 'green' | 'yellow')[] = ['red', 'green', 'yellow']
function paintSafeBoard(cells: Cell[][]): void {
  for (let y = 0; y < cells.length; y++) {
    const row = cells[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      row[x] = { gemColor: SAFE_PALETTE[(x + y) % 3] ?? 'red' }
    }
  }
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
    acquireSpell: (id) => {
      // Validate against the registry so a stale UI offer can't sneak in
      // a non-existent spell id. Silent no-op if already owned — matches
      // the acquireRelic "dedupe + ok" pattern.
      try {
        getSpell(id)
      } catch {
        return { ok: false }
      }
      set((s) => {
        if (!s.fight.player.ownedSpellIds.includes(id)) {
          s.fight.player.ownedSpellIds.push(id)
        }
      })
      return { ok: true }
    },
    acquireSpellReward: makeAcquireSpellReward(set, get),
    restHeal: makeRestHeal(set, get),
    restUpgrade: makeRestUpgrade(set, get),
    leaveRest: makeLeaveRest(set, get),
    rollShopOfferIfNeeded: makeRollShopOffer(set, get),
    shopBuyRelic: makeShopBuyRelic(set, get),
    shopBuySpell: makeShopBuySpell(set, get),
    shopBuyHeal: makeShopBuyHeal(set, get),
    shopRemoveRelic: makeShopRemoveRelic(set, get),
    leaveShop: makeLeaveShop(set, get),
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
      set((s) => {
        paintSafeBoard(s.board.cells)
        const row3 = s.board.cells[3]
        const row4 = s.board.cells[4]
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
    debugForceMatchT: () => {
      // T-shape: horizontal blue run at row 3, cols 1-3, plus vertical
      // blue run at col 2, rows 3-5. Intersection (3, 2) is interior to
      // the horizontal run → classifies as T. Pre-place 4 of the 5
      // match cells + a blue source at (2, 2); the swap drops the
      // source into (3, 2) and completes both runs simultaneously.
      const cur = get()
      if (cur.fight.phase !== 'player-acting') return null
      set((s) => {
        const cells = s.board.cells
        paintSafeBoard(cells)
        const row2 = cells[2]
        const row3 = cells[3]
        const row4 = cells[4]
        const row5 = cells[5]
        if (!row2 || !row3 || !row4 || !row5) return
        row3[1] = { gemColor: 'blue' }
        row3[3] = { gemColor: 'blue' }
        row4[2] = { gemColor: 'blue' }
        row5[2] = { gemColor: 'blue' }
        row2[2] = { gemColor: 'blue' }
        s.board.selected = null
        s.fightCounter += 1
      })
      return { from: { x: 2, y: 2 }, to: { x: 2, y: 3 } }
    },
    debugForceMatchL: () => {
      // L-shape: horizontal blue run at row 3, cols 1-3, plus vertical
      // blue run at col 3, rows 3-5. Intersection (3, 3) is the end of
      // BOTH runs → classifies as L. Pre-place 4 of the 5 match cells
      // + a blue source at (3, 2); the swap drops the source into
      // (3, 3) and completes both runs simultaneously.
      const cur = get()
      if (cur.fight.phase !== 'player-acting') return null
      set((s) => {
        const cells = s.board.cells
        paintSafeBoard(cells)
        const row2 = cells[2]
        const row3 = cells[3]
        const row4 = cells[4]
        const row5 = cells[5]
        if (!row2 || !row3 || !row4 || !row5) return
        row3[1] = { gemColor: 'blue' }
        row3[2] = { gemColor: 'blue' }
        row4[3] = { gemColor: 'blue' }
        row5[3] = { gemColor: 'blue' }
        row2[3] = { gemColor: 'blue' }
        s.board.selected = null
        s.fightCounter += 1
      })
      return { from: { x: 3, y: 2 }, to: { x: 3, y: 3 } }
    },
    debugForceFight: makeDebugForceFight(set, get),
  })),
)
