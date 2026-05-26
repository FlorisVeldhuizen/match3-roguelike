import {
  runOnSpellCast,
  runOnUltimateUsed,
  snapshotOf,
} from '../../relics/engine'
import {
  type Enemy,
  type GameEvent,
  type GemColor,
  type Player,
  type SpellId,
  type StatusKind,
  type UltimateId,
} from '../../../types'
import { getSpell, getUltimate } from '../../combat/spellRegistry'
import { canAffordSpell, consumeSpellCost } from '../../combat/mana'
import {
  resolveBrittle,
  resolveCinderLash,
  resolveFocus,
  resolveIgnite,
  resolvePurify,
  resolveRegenerate,
} from '../../combat/spellResolvers'
import type { StoreSet, StoreGet } from './types'

export function makeCastSpell(set: StoreSet, get: StoreGet) {
  // Free-action spell cast. Cost paid on cast; effect resolves at EOP
  // (Bulwark/Reinforce/Volley), on the next enemy attack (Riposte),
  // on the next match (Skewer/Surge), or immediately (Ignite/
  // Regenerate/Brittle/Cinder Lash). 01-design rules: cast window =
  // player phase + board settled + can pay cost. "Board settled"
  // belongs in UI (button disabled while AC drains) — engine just
  // gates on phase and cost.
  //
  // H4a redesign: picker-arg spells (Purify, Focus, Volley) have their
  // own store actions. castSpell covers no-arg cases: Bulwark,
  // Reinforce, Ignite, Regenerate, Brittle, Skewer, Surge, Cinder Lash.
  return (id: SpellId): { ok: boolean; events: GameEvent[] } => {
    const current = get()
    if (current.fight.phase !== 'player-acting') {
      return { ok: false, events: [] }
    }
    if (current.fight.player.pendingSpells.includes(id)) {
      return { ok: false, events: [] }
    }
    // Spells that need picker args refuse the no-arg path.
    if (id === 'purify' || id === 'focus' || id === 'volley') {
      return { ok: false, events: [] }
    }
    const def = getSpell(id)
    if (!canAffordSpell(current.fight.player.mana, def.cost)) {
      return { ok: false, events: [] }
    }
    // Target-required spells reject without a living enemy in focus.
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
    // Pending-resolution spells (Bulwark/Reinforce/Skewer/Surge).
    // Skewer + Surge ALSO arm a one-shot flag consumed by the next
    // match (see cascade walker), in addition to entering pendingSpells
    // so the PendingStrip can show them.
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
  // H4a Purify: immediate. Args: which player status to remove. Strips
  // the chosen status ENTIRELY (all stacks). If it was Burn, also
  // heals PURIFY_BURN_HEAL. Picker UI offers only present statuses;
  // this action no-ops if the named status is absent, on top of the
  // standard affordability + phase gate.
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

export function makeCastFocus(set: StoreSet, get: StoreGet) {
  // H4a Focus: immediate. Args: source colour (mana taken from) and
  // target colour (mana added to). Picker UI is responsible for offering
  // only non-empty sources and non-capped targets; this action no-ops
  // (refunds nothing) on degenerate args.
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
  // H4a Volley: pending. Args: array of 3 enemy ids (the chosen targets,
  // one per hit). The sole red-pool consumer. Stored in
  // player.volleyTargets for EOP to read; cleared with the pending
  // entry at EOP.
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
    // Each target must be a living enemy in this fight.
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
      // Reset accumulated phasePools.red on cast so pre-cast red
      // (already dealt as damage) doesn't double-dip into the EOP
      // volley split.
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
