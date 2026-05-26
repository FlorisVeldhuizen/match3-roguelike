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
import { rollReward } from '../../relics/reward'
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

export function makeCastShatter(set: StoreSet, get: StoreGet) {
  // H2b.5 first player-side board verb. Picker picks the target gem
  // colour; every cell of that colour shatters and applies its normal
  // per-colour effect (red dmg / blue block pool / green heal /
  // yellow mana / purple skill charge) scaled by cell count, then
  // gravity + refill spawns fresh gems. Uses rng.board for the spawn
  // roll — shatter is a player action, so its determinism rides the
  // board rng stream rather than rng.enemy.
  //
  // Routes through the shared cascade walker inside resolveShatter,
  // so relic onMatch / onCascade hooks (Sharp Edge / Iron Buckler /
  // Cascade Crystal …) fire on the cleared cells and any gravity-
  // induced cascade follow-ups. runOnSpellCast fires here as it does
  // for every other spell.
  return (color: GemColor): { ok: boolean; events: GameEvent[] } => {
    const current = get()
    if (current.fight.phase !== 'player-acting') {
      return { ok: false, events: [] }
    }
    const def = getSpell('shatter')
    if (!canAffordSpell(current.fight.player.mana, def.cost)) {
      return { ok: false, events: [] }
    }
    // Refuse no-op casts (no cells of the picked colour on the board).
    // The picker UI should disable the option in this case but the
    // gate stays here as a defensive backstop.
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

    // Victory check — Shatter is the first immediate-damage spell that
    // can kill an enemy from a free action mid-phase, so the phase
    // transition can't wait for resolveEndOfPhase like a swap-driven
    // kill does. Mirror the victory branch in attemptSwap: roll the
    // reward, advance runPhase, append the node to completedNodeIds,
    // emit phase-changed.
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
        // Boss kill heals to full (same rule as the swap-driven boss
        // kill in attemptSwap). The run-victory screen follows.
        finalPlayer = { ...finalPlayer, hp: finalPlayer.maxHp }
        nextRunPhase = 'victory'
      } else if (nextPendingReward == null) {
        const rolled = rollReward(finalPlayer.relics, 'common', nextLootRng, 0)
        nextPendingReward = rolled.reward
        nextLootRng = rolled.rng
        victoryEvents.push({
          kind: 'reward-offered',
          offeredRelicIds: rolled.reward.offeredRelicIds,
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
      // Whichever path triggered the cast, the board-targeting mode
      // is consumed by it.
      s.boardTargetingSpell = null
    })
    return {
      ok: true,
      events: [event, ...hookEvents, ...r.events, ...victoryEvents],
    }
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
