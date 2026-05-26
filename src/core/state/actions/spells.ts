import {
  runOnSpellCast,
  runOnUltimateUsed,
  snapshotOf,
} from '../../relics/engine'
import {
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
import { rollPostFightReward } from '../../relics/reward'
import { rollGoldDrop } from '../../map/goldDrop'
import { getSpell, getUltimate } from '../../combat/spellRegistry'
import { canAffordSpell, consumeSpellCost } from '../../combat/mana'
import {
  resolveBrittle,
  resolveCinderLash,
  resolveFocus,
  resolveIgnite,
  resolvePurify,
  resolveRegenerate,
  resolveShatter,
} from '../../combat/spellResolvers'
import type { StoreSet, StoreGet } from './types'

export function makeCastSpell(set: StoreSet, get: StoreGet) {
  return (id: SpellId): { ok: boolean; events: GameEvent[] } => {
    const current = get()
    if (current.fight.phase !== 'player-acting') {
      return { ok: false, events: [] }
    }
    if (current.fight.player.pendingSpells.includes(id)) {
      return { ok: false, events: [] }
    }
    if (id === 'purify' || id === 'focus' || id === 'volley') {
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
    const event: GameEvent = { kind: 'spell-cast', spellId: id }
    const writeRelics = current.fight.player.relics.map((r) => ({
      ...r,
      runFlags: { ...r.runFlags },
      fightFlags: { ...r.fightFlags },
    }))
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
    const playerWithCost: Player = {
      ...current.fight.player,
      mana: nextMana,
      relics: writeRelics,
    }
    if (def.resolution === 'immediate') {
      let nextPlayer: Player = playerWithCost
      let nextEnemies: Enemy[] = [...current.fight.enemies]
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
      }
      set((s) => {
        s.fight.player = nextPlayer
        s.fight.enemies = nextEnemies
      })
      return { ok: true, events: [event, ...hookEvents, ...effectEvents] }
    }
    set((s) => {
      s.fight.player.mana = nextMana
      s.fight.player.pendingSpells.push(id)
      s.fight.player.relics = writeRelics
      if (id === 'skewer') {
        s.fight.player.skewerArmed = true
      } else if (id === 'surge') {
        s.fight.player.surgeArmed = true
      }
    })
    return { ok: true, events: [event, ...hookEvents] }
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
    const event: GameEvent = { kind: 'spell-cast', spellId: 'purify' }
    const writeRelics = current.fight.player.relics.map((r) => ({
      ...r,
      runFlags: { ...r.runFlags },
      fightFlags: { ...r.fightFlags },
    }))
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
    return { ok: true, events: [event, ...hookEvents, ...r.events] }
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

    const event: GameEvent = { kind: 'spell-cast', spellId: 'shatter' }
    const writeRelics = current.fight.player.relics.map((r) => ({
      ...r,
      runFlags: { ...r.runFlags },
      fightFlags: { ...r.fightFlags },
    }))
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
    const r = resolveShatter(
      { ...current.fight.player, mana: nextMana, relics: writeRelics },
      current.fight.enemies,
      current.board.cells,
      current.rng.board,
      color,
      current.fight.targetEnemyId,
      current.fight.hexedColors ?? [],
    )

    const anyEnemyAlive = r.enemies.some((e) => e.hp > 0)
    let nextFightPhase: CombatPhase = current.fight.phase
    let nextRunPhase: RunPhase = current.runPhase
    let nextPendingReward: PendingReward | null = current.pendingReward
    let nextLootRng = current.rng.loot
    const completedNodeIds = current.map.completedNodeIds.slice()
    let finalPlayer = r.player
    const victoryEvents: GameEvent[] = []
    if (!anyEnemyAlive) {
      nextFightPhase = 'victory'
      victoryEvents.push({ kind: 'phase-changed', phase: 'victory' })
      const curNode = current.map.currentNodeId
      if (curNode != null && !completedNodeIds.includes(curNode)) {
        completedNodeIds.push(curNode)
      }
      if (current.fight.isBoss) {
        finalPlayer = { ...finalPlayer, hp: finalPlayer.maxHp }
        nextRunPhase = 'victory'
      } else if (nextPendingReward == null) {
        const clearedNode = current.map.nodes.find(
          (n) => n.id === current.map.currentNodeId,
        )
        let goldDrop = 0
        if (clearedNode) {
          const goldRoll = rollGoldDrop(clearedNode, nextLootRng)
          goldDrop = goldRoll.gold
          nextLootRng = goldRoll.rng
        }
        const rarity = current.fight.isElite === true ? 'uncommon' : 'common'
        const rolled = rollPostFightReward({
          ownedRelics: finalPlayer.relics,
          ownedSpellIds: finalPlayer.ownedSpellIds,
          rarity,
          rng: nextLootRng,
          gold: goldDrop,
        })
        nextPendingReward = rolled.reward
        nextLootRng = rolled.rng
        victoryEvents.push({
          kind: 'reward-offered',
          offerKind: rolled.reward.kind,
          offeredRelicIds:
            rolled.reward.kind === 'relic' ? rolled.reward.offeredRelicIds : [],
          offeredSpellIds:
            rolled.reward.kind === 'spell' ? rolled.reward.offeredSpellIds : [],
          gold: rolled.reward.gold,
        })
        nextRunPhase = 'reward'
      }
    }

    set((s) => {
      s.fight.player = finalPlayer
      s.fight.enemies = r.enemies
      s.fight.targetEnemyId = r.targetEnemyId
      s.fight.phase = nextFightPhase
      s.board.cells = r.board
      s.rng.board = r.rng
      s.rng.loot = nextLootRng
      s.pendingReward = nextPendingReward
      s.runPhase = nextRunPhase
      s.map.completedNodeIds = completedNodeIds
      s.boardTargetingSpell = null
    })
    return {
      ok: true,
      events: [event, ...hookEvents, ...r.events, ...victoryEvents],
    }
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
    const event: GameEvent = { kind: 'spell-cast', spellId: 'focus' }
    const writeRelics = current.fight.player.relics.map((r) => ({
      ...r,
      runFlags: { ...r.runFlags },
      fightFlags: { ...r.fightFlags },
    }))
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
    const event: GameEvent = { kind: 'spell-cast', spellId: 'volley' }
    const writeRelics = current.fight.player.relics.map((r) => ({
      ...r,
      runFlags: { ...r.runFlags },
      fightFlags: { ...r.fightFlags },
    }))
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
    const event: GameEvent = { kind: 'spell-cast', spellId: id }
    const writeRelics = current.fight.player.relics.map((r) => ({
      ...r,
      runFlags: { ...r.runFlags },
      fightFlags: { ...r.fightFlags },
    }))
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
    set((s) => {
      s.fight.player.skillCharge -= def.chargeCost
      s.fight.player.pendingSpells.push(id)
      s.fight.player.relics = writeRelics
    })
    return { ok: true, events: [event, ...hookEvents] }
  }
}
