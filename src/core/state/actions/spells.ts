import {
  cloneRelicsForHooks,
  runOnSpellCast,
  runOnUltimateUsed,
  snapshotOf,
} from '../../relics/engine'
import {
  type Cell,
  type CombatPhase,
  type Enemy,
  type GameEvent,
  type GemColor,
  type PendingReward,
  type Player,
  type RunPhase,
  type SpellId,
  type StatusKind,
  type UltimateId,
} from '../../../types'
import type { RngState } from '../../rng/mulberry32'
import { rollPostFightReward } from '../../relics/reward'
import { rollGoldDrop } from '../../map/goldDrop'
import { applyCombatEvents } from '../../combat/applyCombatEvents'
import { getSpell, getUltimate } from '../../combat/spellRegistry'
import {
  canAffordSpell,
  consumeSpellCost,
  makeSpellCastEvent,
} from '../../combat/mana'
import { withImmediateSpellVisuals } from '../../combat/spellVisual'
import {
  resolveBlessedGround,
  resolveBrittle,
  resolveCinderLash,
  resolveFocus,
  resolveFrozenWall,
  resolveIgnite,
  resolvePurify,
  resolveRegenerate,
  resolveShatter,
  resolveTransmute,
} from '../../combat/spellResolvers'
import type { StoreSet, StoreGet } from './types'

function applySpellHooks(
  hookEvents: GameEvent[],
  player: Player,
  enemies: Enemy[],
  targetEnemyId: string | null,
): {
  player: Player
  enemies: Enemy[]
  targetEnemyId: string | null
  events: GameEvent[]
} {
  const applied = applyCombatEvents(hookEvents, player, enemies, targetEnemyId)
  return {
    player: applied.player,
    enemies: applied.enemies,
    targetEnemyId: applied.targetEnemyId,
    events: [...hookEvents, ...applied.derived],
  }
}

function computeBoardSpellOutcome(
  get: StoreGet,
  player: Player,
  enemies: Enemy[],
  targetEnemyId: string | null,
  board: Cell[][],
  boardRng: RngState,
): {
  player: Player
  enemies: Enemy[]
  targetEnemyId: string | null
  board: Cell[][]
  boardRng: RngState
  fightPhase: CombatPhase
  runPhase: RunPhase
  pendingReward: PendingReward | null
  lootRng: RngState
  completedNodeIds: string[]
  extraEvents: GameEvent[]
} {
  const current = get()
  const anyEnemyAlive = enemies.some((e) => e.hp > 0)
  let fightPhase: CombatPhase = current.fight.phase
  let runPhase: RunPhase = current.runPhase
  let pendingReward: PendingReward | null = current.pendingReward
  let lootRng = current.rng.loot
  const completedNodeIds = current.map.completedNodeIds.slice()
  const extraEvents: GameEvent[] = []
  let finalPlayer = player

  if (!anyEnemyAlive) {
    fightPhase = 'victory'
    extraEvents.push({ kind: 'phase-changed', phase: 'victory' })
    const curNode = current.map.currentNodeId
    if (curNode != null && !completedNodeIds.includes(curNode)) {
      completedNodeIds.push(curNode)
    }
    if (current.fight.isBoss) {
      finalPlayer = { ...finalPlayer, hp: finalPlayer.maxHp }
      runPhase = 'victory'
    } else if (pendingReward == null) {
      const clearedNode = current.map.nodes.find(
        (n) => n.id === current.map.currentNodeId,
      )
      let goldDrop = 0
      if (clearedNode) {
        const goldRoll = rollGoldDrop(clearedNode, lootRng)
        goldDrop = goldRoll.gold
        lootRng = goldRoll.rng
      }
      const rarity = current.fight.isElite === true ? 'uncommon' : 'common'
      const rolled = rollPostFightReward({
        ownedRelics: finalPlayer.relics,
        ownedSpellIds: finalPlayer.ownedSpellIds,
        rarity,
        rng: lootRng,
        gold: goldDrop,
      })
      pendingReward = rolled.reward
      lootRng = rolled.rng
      extraEvents.push({
        kind: 'reward-offered',
        offerKind: rolled.reward.kind,
        offeredRelicIds:
          rolled.reward.kind === 'relic' ? rolled.reward.offeredRelicIds : [],
        offeredSpellIds:
          rolled.reward.kind === 'spell' ? rolled.reward.offeredSpellIds : [],
        gold: rolled.reward.gold,
      })
      runPhase = 'reward'
    }
  }

  return {
    player: finalPlayer,
    enemies,
    targetEnemyId,
    board,
    boardRng,
    fightPhase,
    runPhase,
    pendingReward,
    lootRng,
    completedNodeIds,
    extraEvents,
  }
}

export function makeCastSpell(set: StoreSet, get: StoreGet) {
  return (id: SpellId): { ok: boolean; events: GameEvent[] } => {
    const current = get()
    if (current.fight.phase !== 'player-acting') {
      return { ok: false, events: [] }
    }
    if (current.fight.player.pendingSpells.includes(id)) {
      return { ok: false, events: [] }
    }
    if (
      id === 'purify' ||
      id === 'focus' ||
      id === 'volley' ||
      id === 'transmute' ||
      id === 'shatter' ||
      id === 'frozen-wall'
    ) {
      return { ok: false, events: [] }
    }
    const def = getSpell(id)
    if (!canAffordSpell(current.fight.player.mana, def.cost)) {
      return { ok: false, events: [] }
    }
    const needsTarget =
      id === 'ignite' || id === 'brittle' || id === 'cinder-lash'
    const targetId = current.fight.targetEnemyId
    if (needsTarget) {
      const t = targetId
        ? current.fight.enemies.find((e) => e.id === targetId && e.hp > 0)
        : undefined
      if (!t) return { ok: false, events: [] }
    }
    const event = makeSpellCastEvent(id, current.fight.player.mana)
    const writeRelics = cloneRelicsForHooks(current.fight.player.relics)
    const hookEvents = runOnSpellCast(
      { spellId: id },
      writeRelics,
      snapshotOf(
        current.fight.player,
        current.fight.enemies,
        current.fight.targetEnemyId,
        0,
      ),
    )
    const nextMana = consumeSpellCost(current.fight.player.mana, def.cost)
    let playerWithCost: Player = {
      ...current.fight.player,
      mana: nextMana,
      relics: writeRelics,
    }
    let enemies = [...current.fight.enemies]
    let fightTargetId = current.fight.targetEnemyId
    const hooks = applySpellHooks(
      hookEvents,
      playerWithCost,
      enemies,
      fightTargetId,
    )
    playerWithCost = hooks.player
    enemies = hooks.enemies
    fightTargetId = hooks.targetEnemyId

    if (def.resolution === 'immediate') {
      let nextPlayer: Player = playerWithCost
      let nextEnemies: Enemy[] = enemies
      const effectEvents: GameEvent[] = []
      if (id === 'ignite' && targetId) {
        const r = resolveIgnite(nextEnemies, targetId)
        nextEnemies = r.enemies
        effectEvents.push(...r.events)
      } else if (id === 'regenerate') {
        const r = resolveRegenerate(nextPlayer)
        nextPlayer = r.player
        effectEvents.push(...r.events)
      } else if (id === 'brittle' && targetId) {
        const r = resolveBrittle(nextEnemies, targetId)
        nextEnemies = r.enemies
        effectEvents.push(...r.events)
      } else if (id === 'cinder-lash' && targetId) {
        const r = resolveCinderLash(nextPlayer, nextEnemies, targetId)
        nextPlayer = r.player
        nextEnemies = r.enemies
        effectEvents.push(...r.events)
      } else if (id === 'blessed-ground') {
        const r = resolveBlessedGround(current.board.cells, current.rng.board)
        effectEvents.push(...r.events)
        set((s) => {
          s.board.cells = r.board
          s.rng.board = r.rng
          s.fight.player = nextPlayer
          s.fight.enemies = nextEnemies
        })
        return {
          ok: true,
          events: withImmediateSpellVisuals(id, [
            event,
            ...hooks.events,
            ...effectEvents,
          ]),
        }
      }
      set((s) => {
        s.fight.player = nextPlayer
        s.fight.enemies = nextEnemies
        s.fight.targetEnemyId = fightTargetId
      })
      return {
        ok: true,
        events: withImmediateSpellVisuals(id, [
          event,
          ...hooks.events,
          ...effectEvents,
        ]),
      }
    }
    set((s) => {
      s.fight.player = playerWithCost
      s.fight.enemies = enemies
      s.fight.targetEnemyId = fightTargetId
      s.fight.player.pendingSpells = [...playerWithCost.pendingSpells, id]
      if (id === 'skewer') {
        s.fight.player.skewerArmed = true
      } else if (id === 'surge') {
        s.fight.player.surgeArmed = true
      } else if (id === 'chain-lightning') {
        s.fight.player.chainLightningArmed = true
      }
    })
    return { ok: true, events: [event, ...hooks.events] }
  }
}

export function makeCastPurify(set: StoreSet, get: StoreGet) {
  return (statusKind: StatusKind): { ok: boolean; events: GameEvent[] } => {
    const current = get()
    if (current.fight.phase !== 'player-acting') {
      return { ok: false, events: [] }
    }
    const def = getSpell('purify')
    if (!canAffordSpell(current.fight.player.mana, def.cost)) {
      return { ok: false, events: [] }
    }
    if (!current.fight.player.statuses.some((s) => s.kind === statusKind)) {
      return { ok: false, events: [] }
    }
    const event = makeSpellCastEvent('purify', current.fight.player.mana)
    const writeRelics = cloneRelicsForHooks(current.fight.player.relics)
    const hookEvents = runOnSpellCast(
      { spellId: 'purify' },
      writeRelics,
      snapshotOf(
        current.fight.player,
        current.fight.enemies,
        current.fight.targetEnemyId,
        0,
      ),
    )
    const nextMana = consumeSpellCost(current.fight.player.mana, def.cost)
    const r = resolvePurify(
      { ...current.fight.player, mana: nextMana, relics: writeRelics },
      statusKind,
    )
    set((s) => {
      s.fight.player = r.player
    })
    return {
      ok: true,
      events: withImmediateSpellVisuals('purify', [
        event,
        ...hookEvents,
        ...r.events,
      ]),
    }
  }
}

export function makeCastShatter(set: StoreSet, get: StoreGet) {
  return (color: GemColor): { ok: boolean; events: GameEvent[] } => {
    const current = get()
    if (current.fight.phase !== 'player-acting') {
      return { ok: false, events: [] }
    }
    const def = getSpell('shatter')
    if (!canAffordSpell(current.fight.player.mana, def.cost)) {
      return { ok: false, events: [] }
    }
    const hasAny = current.board.cells.some((row) =>
      row.some((c) => c.gemColor === color),
    )
    if (!hasAny) {
      return { ok: false, events: [] }
    }

    const event = makeSpellCastEvent('shatter', current.fight.player.mana)
    const writeRelics = cloneRelicsForHooks(current.fight.player.relics)
    const hookEvents = runOnSpellCast(
      { spellId: 'shatter' },
      writeRelics,
      snapshotOf(
        current.fight.player,
        current.fight.enemies,
        current.fight.targetEnemyId,
        0,
      ),
    )
    const nextMana = consumeSpellCost(current.fight.player.mana, def.cost)
    const playerWithCost: Player = {
      ...current.fight.player,
      mana: nextMana,
      relics: writeRelics,
    }
    const hooks = applySpellHooks(
      hookEvents,
      playerWithCost,
      current.fight.enemies,
      current.fight.targetEnemyId,
    )
    const r = resolveShatter(
      hooks.player,
      hooks.enemies,
      current.board.cells,
      current.rng.board,
      color,
      hooks.targetEnemyId,
      current.fight.hexedColors ?? [],
      current.fight.drainedColors ?? [],
    )
    const outcome = computeBoardSpellOutcome(
      get,
      r.player,
      r.enemies,
      r.targetEnemyId,
      r.board,
      r.rng,
    )

    set((s) => {
      s.fight.player = outcome.player
      s.fight.enemies = outcome.enemies
      s.fight.targetEnemyId = outcome.targetEnemyId
      s.fight.phase = outcome.fightPhase
      s.board.cells = outcome.board
      s.rng.board = outcome.boardRng
      s.rng.loot = outcome.lootRng
      s.pendingReward = outcome.pendingReward
      s.runPhase = outcome.runPhase
      s.map.completedNodeIds = outcome.completedNodeIds
      s.boardTargetingSpell = null
    })
    return {
      ok: true,
      events: [event, ...hooks.events, ...r.events, ...outcome.extraEvents],
    }
  }
}

export function makeCastTransmute(set: StoreSet, get: StoreGet) {
  return (from: GemColor, to: GemColor): { ok: boolean; events: GameEvent[] } => {
    const current = get()
    if (current.fight.phase !== 'player-acting') {
      return { ok: false, events: [] }
    }
    if (from === to || from === 'purple' || to === 'purple') {
      return { ok: false, events: [] }
    }
    const def = getSpell('transmute')
    if (!canAffordSpell(current.fight.player.mana, def.cost)) {
      return { ok: false, events: [] }
    }
    const hasFrom = current.board.cells.some((row) =>
      row.some((c) => c.gemColor === from),
    )
    if (!hasFrom) return { ok: false, events: [] }

    const event = makeSpellCastEvent('transmute', current.fight.player.mana)
    const writeRelics = cloneRelicsForHooks(current.fight.player.relics)
    const hookEvents = runOnSpellCast(
      { spellId: 'transmute' },
      writeRelics,
      snapshotOf(
        current.fight.player,
        current.fight.enemies,
        current.fight.targetEnemyId,
        0,
      ),
    )
    const nextMana = consumeSpellCost(current.fight.player.mana, def.cost)
    const playerWithCost: Player = {
      ...current.fight.player,
      mana: nextMana,
      relics: writeRelics,
    }
    const hooks = applySpellHooks(
      hookEvents,
      playerWithCost,
      current.fight.enemies,
      current.fight.targetEnemyId,
    )
    const r = resolveTransmute(
      current.board.cells,
      from,
      to,
      current.rng.board,
      hooks.player,
      hooks.enemies,
      hooks.targetEnemyId,
      current.fight.hexedColors ?? [],
      current.fight.drainedColors ?? [],
    )
    const outcome = computeBoardSpellOutcome(
      get,
      r.player,
      r.enemies,
      r.targetEnemyId,
      r.board,
      r.rng,
    )
    set((s) => {
      s.fight.player = outcome.player
      s.fight.enemies = outcome.enemies
      s.fight.targetEnemyId = outcome.targetEnemyId
      s.fight.phase = outcome.fightPhase
      s.board.cells = outcome.board
      s.rng.board = outcome.boardRng
      s.rng.loot = outcome.lootRng
      s.pendingReward = outcome.pendingReward
      s.runPhase = outcome.runPhase
      s.map.completedNodeIds = outcome.completedNodeIds
      s.boardTargetingSpell = null
    })
    return {
      ok: true,
      events: [event, ...hooks.events, ...r.events, ...outcome.extraEvents],
    }
  }
}

export function makeCastFrozenWall(set: StoreSet, get: StoreGet) {
  return (row: number): { ok: boolean; events: GameEvent[] } => {
    const current = get()
    if (current.fight.phase !== 'player-acting') {
      return { ok: false, events: [] }
    }
    const def = getSpell('frozen-wall')
    if (!canAffordSpell(current.fight.player.mana, def.cost)) {
      return { ok: false, events: [] }
    }

    const event = makeSpellCastEvent('frozen-wall', current.fight.player.mana)
    const writeRelics = cloneRelicsForHooks(current.fight.player.relics)
    const hookEvents = runOnSpellCast(
      { spellId: 'frozen-wall' },
      writeRelics,
      snapshotOf(
        current.fight.player,
        current.fight.enemies,
        current.fight.targetEnemyId,
        0,
      ),
    )
    const nextMana = consumeSpellCost(current.fight.player.mana, def.cost)
    const hooks = applySpellHooks(
      hookEvents,
      { ...current.fight.player, mana: nextMana, relics: writeRelics },
      current.fight.enemies,
      current.fight.targetEnemyId,
    )
    const r = resolveFrozenWall(row, current.board.petrifiedRows)
    set((s) => {
      s.fight.player = hooks.player
      s.fight.enemies = hooks.enemies
      s.fight.targetEnemyId = hooks.targetEnemyId
      s.board.petrifiedRows = r.petrifiedRows
      s.boardTargetingSpell = null
    })
    return { ok: true, events: [event, ...hooks.events, ...r.events] }
  }
}

export function makeCastFocus(set: StoreSet, get: StoreGet) {
  return (from: GemColor, to: GemColor): { ok: boolean; events: GameEvent[] } => {
    const current = get()
    if (current.fight.phase !== 'player-acting') {
      return { ok: false, events: [] }
    }
    const def = getSpell('focus')
    if (!canAffordSpell(current.fight.player.mana, def.cost)) {
      return { ok: false, events: [] }
    }
    if (from === to) {
      return { ok: false, events: [] }
    }
    if (from === 'purple' || to === 'purple') {
      return { ok: false, events: [] }
    }
    const event = makeSpellCastEvent('focus', current.fight.player.mana)
    const writeRelics = cloneRelicsForHooks(current.fight.player.relics)
    const hookEvents = runOnSpellCast(
      { spellId: 'focus' },
      writeRelics,
      snapshotOf(
        current.fight.player,
        current.fight.enemies,
        current.fight.targetEnemyId,
        0,
      ),
    )
    const nextMana = consumeSpellCost(current.fight.player.mana, def.cost)
    const r = resolveFocus(
      { ...current.fight.player, mana: nextMana, relics: writeRelics },
      from,
      to,
    )
    set((s) => {
      s.fight.player = r.player
    })
    return { ok: true, events: [event, ...hookEvents, ...r.events] }
  }
}

export function makeCastVolley(set: StoreSet, get: StoreGet) {
  return (targets: string[]): { ok: boolean; events: GameEvent[] } => {
    const current = get()
    if (current.fight.phase !== 'player-acting') {
      return { ok: false, events: [] }
    }
    if (current.fight.player.pendingSpells.includes('volley')) {
      return { ok: false, events: [] }
    }
    const def = getSpell('volley')
    if (!canAffordSpell(current.fight.player.mana, def.cost)) {
      return { ok: false, events: [] }
    }
    if (targets.length !== 3) {
      return { ok: false, events: [] }
    }
    const living = new Set(
      current.fight.enemies.filter((e) => e.hp > 0).map((e) => e.id),
    )
    if (!targets.every((id) => living.has(id))) {
      return { ok: false, events: [] }
    }
    const event = makeSpellCastEvent('volley', current.fight.player.mana)
    const writeRelics = cloneRelicsForHooks(current.fight.player.relics)
    const hookEvents = runOnSpellCast(
      { spellId: 'volley' },
      writeRelics,
      snapshotOf(
        current.fight.player,
        current.fight.enemies,
        current.fight.targetEnemyId,
        0,
      ),
    )
    const nextMana = consumeSpellCost(current.fight.player.mana, def.cost)
    set((s) => {
      s.fight.player.mana = nextMana
      s.fight.player.pendingSpells.push('volley')
      s.fight.player.relics = writeRelics
      s.fight.player.volleyTargets = [...targets]
      s.fight.player.phasePools.red = 0
    })
    return { ok: true, events: [event, ...hookEvents] }
  }
}

export function makeCastUltimate(set: StoreSet, get: StoreGet) {
  return (id: UltimateId): { ok: boolean; events: GameEvent[] } => {
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
    const event = makeSpellCastEvent(id, current.fight.player.mana)
    const writeRelics = cloneRelicsForHooks(current.fight.player.relics)
    const hookEvents = runOnUltimateUsed(
      { spellId: id },
      writeRelics,
      snapshotOf(
        current.fight.player,
        current.fight.enemies,
        current.fight.targetEnemyId,
        0,
      ),
    )
    let player: Player = {
      ...current.fight.player,
      skillCharge: current.fight.player.skillCharge - def.chargeCost,
      relics: writeRelics,
    }
    let enemies = [...current.fight.enemies]
    let fightTargetId = current.fight.targetEnemyId
    const hooks = applySpellHooks(hookEvents, player, enemies, fightTargetId)
    player = hooks.player
    enemies = hooks.enemies
    fightTargetId = hooks.targetEnemyId
    set((s) => {
      s.fight.player = player
      s.fight.enemies = enemies
      s.fight.targetEnemyId = fightTargetId
      s.fight.player.pendingSpells.push(id)
    })
    return { ok: true, events: [event, ...hooks.events] }
  }
}
