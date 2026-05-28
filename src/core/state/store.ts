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
  type WardedRows,
  type Pos,
  type RunPhase,
  type ShopOffer,
  type SpellId,
  type StatusKind,
  type UltimateId,
} from '../../types'
import { generateMap } from '../map/generate'
import { getSpell, listUltimates } from '../combat/spellRegistry'
import { canAffordSpell } from '../combat/mana'
import { makeDebugForceFight } from './actions/debug'
import { makeAcquireRelic, makeAcquireSpellReward, makeSkipReward } from './actions/rewards'
import { makeLeaveRest, makeRestHeal, makeRestUpgrade } from './actions/rest'
import {
  makeLeaveShop,
  makeRollShopOffer,
  makeShopBuyHeal,
  makeShopBuyRelic,
  makeShopBuySpell,
  makeShopPawnRelic,
} from './actions/shop'
import { makeEnterNode, makeRestart } from './actions/nodes'
import { freshBoardState, freshPlayer } from './actions/helpers'
import {
  makeCastSpell,
  makeCastPurify,
  makeCastFocus,
  makeCastVolley,
  makeCastShatter,
  makeCastTransmute,
  makeCastFrozenWall,
  makeCastUltimate,
} from './actions/spells'
import { makeSelectCell, makeSetTargetEnemy, makeAttemptSwap } from './actions/swap'

export type BoardState = {
  width: number
  height: number
  cells: Cell[][]
  selected: Pos | null
  petrifiedRows: PetrifiedRows
  wardedRows: WardedRows
}

export type GameStore = {
  board: BoardState
  rng: RngStreams
  rootSeed: string
  fight: FightState
  fightCounter: number
  pendingReward: PendingReward | null
  currentShopOffer: ShopOffer | null
  map: MapState
  runPhase: RunPhase
  selectCell: (pos: Pos | null) => void
  setTargetEnemy: (id: string) => void
  attemptSwap: (a: Pos, b: Pos) => { valid: boolean; events: GameEvent[] }
  castSpell: (id: SpellId) => { ok: boolean; events: GameEvent[] }
  castUltimate: (id: UltimateId) => { ok: boolean; events: GameEvent[] }
  castPurify: (statusKind: StatusKind) => {
    ok: boolean
    events: GameEvent[]
  }
  castFocus: (from: GemColor, to: GemColor) => { ok: boolean; events: GameEvent[] }
  castVolley: (targets: string[]) => {
    ok: boolean
    events: GameEvent[]
  }
  castShatter: (color: GemColor) => { ok: boolean; events: GameEvent[] }
  castTransmute: (from: GemColor, to: GemColor) => { ok: boolean; events: GameEvent[] }
  castFrozenWall: (row: number) => { ok: boolean; events: GameEvent[] }
  boardTargetingSpell: SpellId | null
  beginBoardTargeting: (spellId: SpellId) => boolean
  cancelBoardTargeting: () => void
  acquireRelic: (id: string) => { ok: boolean; events: GameEvent[] }
  acquireSpell: (id: SpellId) => { ok: boolean }
  acquireSpellReward: (id: SpellId) => { ok: boolean }
  restHeal: () => { ok: boolean }
  restUpgrade: (relicId: string) => { ok: boolean }
  leaveRest: () => void
  rollShopOfferIfNeeded: () => void
  shopBuyRelic: (relicId: string) => { ok: boolean }
  shopBuySpell: (spellId: SpellId) => { ok: boolean }
  shopBuyHeal: (kind: 'small' | 'big') => { ok: boolean }
  shopPawnRelic: (relicId: string) => { ok: boolean; gold?: number }
  leaveShop: () => void
  skipReward: () => void
  enterNode: (nodeId: string) => void
  restart: () => void
  debugForceMatch5: () => { from: Pos; to: Pos } | null
  debugForceMatchT: () => { from: Pos; to: Pos } | null
  debugForceMatchL: () => { from: Pos; to: Pos } | null
  debugFillManaPools: () => void
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

// 3-color rotation that produces no 3-runs: palette[(x+y) % 3].
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
    selectCell: makeSelectCell(set),
    setTargetEnemy: makeSetTargetEnemy(set),
    attemptSwap: makeAttemptSwap(set, get),
    castSpell: makeCastSpell(set, get),
    castPurify: makeCastPurify(set, get),
    castFocus: makeCastFocus(set, get),
    castVolley: makeCastVolley(set, get),
    castShatter: makeCastShatter(set, get),
    castTransmute: makeCastTransmute(set, get),
    castFrozenWall: makeCastFrozenWall(set, get),
    beginBoardTargeting: (spellId) => {
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
    shopPawnRelic: makeShopPawnRelic(set, get),
    leaveShop: makeLeaveShop(set, get),
    skipReward: makeSkipReward(set, get),
    enterNode: makeEnterNode(set, get),
    restart: makeRestart(set, get, () => initialState(newSliceSeed())),
    debugForceMatch5: () => {
      const cur = get()
      if (cur.fight.phase !== 'player-acting') return null
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
        s.fightCounter += 1
      })
      return { from: { x: 3, y: 4 }, to: { x: 3, y: 3 } }
    },
    debugForceMatchT: () => {
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
    debugFillManaPools: () => {
      const maxCharge = listUltimates().reduce((m, u) => Math.max(m, u.chargeCost), 0)
      set((s) => {
        s.fight.player.mana = { ...MANA_CAPS }
        s.fight.player.skillCharge = maxCharge
      })
    },
    debugForceFight: makeDebugForceFight(set, get),
  })),
)
