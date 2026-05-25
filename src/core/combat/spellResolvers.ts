import {
  MANA_CAPS,
  type Enemy,
  type GameEvent,
  type GemColor,
  type ManaPools,
  type Player,
  type StatusInstance,
  type StatusKind,
} from '../../types'
import { applyStatusToList } from './statuses'

// H4a immediate-effect spell resolvers. These run inline at cast time
// (no pendingSpells push, no EOP step). Pure: no mutation, no store
// access. Caller (store castSpell / castPurify / castFocus) handles
// the mana consumption, spell-cast event, and relic onSpellCast hook
// chain — these resolvers only produce the *effect*.

// ----- Apply-status helpers -----

// Burn count applied to the targeted enemy by Ignite.
export const IGNITE_BURN_STACKS = 3
// Vulnerable stacks applied by Brittle.
export const BRITTLE_VULN_STACKS = 2
// Cinder Lash: Burn applied to target + self heal amount.
export const CINDER_BURN_STACKS = 2
export const CINDER_HEAL = 2
// Purify: bonus heal when stripping Burn specifically (turns the
// "tank it then convert" line into a real win condition).
export const PURIFY_BURN_HEAL = 3
// Regenerate stacks applied to self (decay-decay-decay → 3+2+1 = 6 HP).
export const REGENERATE_STACKS = 3

// Ignite: apply Burn to the targeted living enemy. Returns the updated
// enemies array + a status-applied event. Caller is expected to have
// validated a living target exists.
export function resolveIgnite(
  enemies: readonly Enemy[],
  targetEnemyId: string,
): { enemies: Enemy[]; events: GameEvent[] } {
  const target = enemies.find((e) => e.id === targetEnemyId && e.hp > 0)
  if (!target) return { enemies: [...enemies], events: [] }
  const incoming: StatusInstance = { kind: 'burn', stacks: IGNITE_BURN_STACKS }
  const newStatuses = applyStatusToList(target.statuses, incoming)
  const updated = enemies.map((e) =>
    e.id === targetEnemyId ? { ...e, statuses: newStatuses } : e,
  )
  // The stacks reported is the just-applied amount (not cumulative),
  // mirroring how Smolder's onHit rider works.
  return {
    enemies: updated,
    events: [
      {
        kind: 'status-applied',
        target: targetEnemyId,
        status: incoming,
        source: { kind: 'player' },
      },
    ],
  }
}

// Brittle: apply Vulnerable to the targeted living enemy.
export function resolveBrittle(
  enemies: readonly Enemy[],
  targetEnemyId: string,
): { enemies: Enemy[]; events: GameEvent[] } {
  const target = enemies.find((e) => e.id === targetEnemyId && e.hp > 0)
  if (!target) return { enemies: [...enemies], events: [] }
  const incoming: StatusInstance = {
    kind: 'vulnerable',
    stacks: BRITTLE_VULN_STACKS,
  }
  const newStatuses = applyStatusToList(target.statuses, incoming)
  const updated = enemies.map((e) =>
    e.id === targetEnemyId ? { ...e, statuses: newStatuses } : e,
  )
  return {
    enemies: updated,
    events: [
      {
        kind: 'status-applied',
        target: targetEnemyId,
        status: incoming,
        source: { kind: 'player' },
      },
    ],
  }
}

// Cinder Lash: apply Burn to target + heal self. The two effects are
// independent — even if the heal caps, the Burn still lands; even if
// the target is dead, the heal still happens (but we still gate at
// cast on having a living target so the spell isn't useless).
export function resolveCinderLash(
  player: Player,
  enemies: readonly Enemy[],
  targetEnemyId: string,
): { player: Player; enemies: Enemy[]; events: GameEvent[] } {
  const events: GameEvent[] = []
  let nextEnemies: Enemy[] = [...enemies]
  const target = enemies.find((e) => e.id === targetEnemyId && e.hp > 0)
  if (target) {
    const incoming: StatusInstance = {
      kind: 'burn',
      stacks: CINDER_BURN_STACKS,
    }
    const newStatuses = applyStatusToList(target.statuses, incoming)
    nextEnemies = enemies.map((e) =>
      e.id === targetEnemyId ? { ...e, statuses: newStatuses } : e,
    )
    events.push({
      kind: 'status-applied',
      target: targetEnemyId,
      status: incoming,
      source: { kind: 'player' },
    })
  }
  // Self heal (capped at maxHp). Emits healed only on positive delta.
  const before = player.hp
  const next = Math.min(player.maxHp, before + CINDER_HEAL)
  const delta = next - before
  const nextPlayer = delta > 0 ? { ...player, hp: next } : player
  if (delta > 0) {
    events.push({ kind: 'healed', amount: delta })
  }
  return { player: nextPlayer, enemies: nextEnemies, events }
}

// Regenerate: apply Regen to self. Stacks accumulate with any existing
// Regen the player already had (same rule as re-applying Burn).
export function resolveRegenerate(player: Player): {
  player: Player
  events: GameEvent[]
} {
  const incoming: StatusInstance = {
    kind: 'regen',
    stacks: REGENERATE_STACKS,
  }
  const nextStatuses = applyStatusToList(player.statuses, incoming)
  return {
    player: { ...player, statuses: nextStatuses },
    events: [
      {
        kind: 'status-applied',
        target: 'player',
        status: incoming,
        source: { kind: 'player' },
      },
    ],
  }
}

// Purify: remove the named status ENTIRELY from the player (all stacks).
// If the cleared status was Burn, also heal PURIFY_BURN_HEAL HP — turns
// the "tank-the-burn-then-cleanse" line into a real heal swing. Caller
// gates via the picker UI; this returns events-empty if the named status
// isn't present.
export function resolvePurify(
  player: Player,
  statusKind: StatusKind,
): { player: Player; events: GameEvent[] } {
  const hadIt = player.statuses.some((s) => s.kind === statusKind)
  if (!hadIt) {
    return { player, events: [] }
  }
  const events: GameEvent[] = [
    { kind: 'status-expired', target: 'player', statusKind },
  ]
  let nextPlayer: Player = {
    ...player,
    statuses: player.statuses.filter((s) => s.kind !== statusKind),
  }
  if (statusKind === 'burn') {
    const before = nextPlayer.hp
    const next = Math.min(nextPlayer.maxHp, before + PURIFY_BURN_HEAL)
    const delta = next - before
    if (delta > 0) {
      nextPlayer = { ...nextPlayer, hp: next }
      events.push({ kind: 'healed', amount: delta })
    }
  }
  return { player: nextPlayer, events }
}

// Focus: move up to FOCUS_TRANSFER mana from `from` to `to` colour,
// respecting the source's current value and the target's cap. Yellow
// cost is consumed by the caller; this is the colour-shift effect.
export const FOCUS_TRANSFER = 3

export function resolveFocus(
  player: Player,
  from: GemColor,
  to: GemColor,
): { player: Player; events: GameEvent[] } {
  if (from === to) return { player, events: [] }
  if (from === 'purple' || to === 'purple') return { player, events: [] }
  const m = player.mana
  const fromKey = from as keyof ManaPools
  const toKey = to as keyof ManaPools
  const have = m[fromKey]
  const cap = MANA_CAPS[toKey]
  const headroom = cap - m[toKey]
  const moved = Math.max(0, Math.min(have, FOCUS_TRANSFER, headroom))
  if (moved <= 0) return { player, events: [] }
  return {
    player: {
      ...player,
      mana: {
        ...m,
        [fromKey]: m[fromKey] - moved,
        [toKey]: m[toKey] + moved,
      },
    },
    events: [],
  }
}
