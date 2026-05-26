import { nextInt, type RngState } from '../rng/mulberry32'
import {
  GEM_COLORS,
  MANA_CAPS,
  type Cell,
  type Enemy,
  type GameEvent,
  type GemColor,
  type ManaPools,
  type Player,
  type Pos,
  type StatusInstance,
  type StatusKind,
} from '../../types'
import { applyStatusToList } from './statuses'
import { applyGravity } from '../board/gravity'
import { applyMatchRedDamage } from './aoe'

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

// H2b.5: Shatter Color — first player-side board verb. Clears every
// gem of the target colour and applies the standard per-colour effect
// scaled by cell count:
//   - red    → single-target damage to the current target
//   - blue   → phasePools.blue (resolves at EOP into block) + mana.blue
//   - green  → immediate heal + mana.green
//   - yellow → mana.yellow
//   - purple → skillCharge
// Runs gravity + refill inline (same shape as Brute's column-smash
// resolver). MVP scope: DOES NOT route through the runOnMatch relic
// hook chain — Sharp Edge / Iron Buckler / Cascade Crystal don't fire
// here. Lifting that requires extracting the match-processing pipeline
// out of attemptSwap, which is queued as a follow-up. The spell still
// fires runOnSpellCast via the caller (castShatter in actions/spells).
export function resolveShatter(
  player: Player,
  enemies: Enemy[],
  board: Cell[][],
  rng: RngState,
  color: GemColor,
  targetEnemyId: string | null,
): {
  player: Player
  enemies: Enemy[]
  board: Cell[][]
  rng: RngState
  events: GameEvent[]
  // ids of enemies that died as a result of this shatter (red only;
  // other colours can't kill). Caller (castShatter) runs the
  // onEnemyKilled relic chain + re-points the current target.
  killedIds: string[]
} {
  // Collect cells of the target colour. Empty result = no-op (the
  // picker UI should disable in this case, but the resolver stays
  // safe).
  const cellsCleared: Pos[] = []
  for (let y = 0; y < board.length; y++) {
    const row = board[y]
    if (!row) continue
    for (let x = 0; x < row.length; x++) {
      if (row[x]?.gemColor === color) {
        cellsCleared.push({ x, y })
      }
    }
  }
  if (cellsCleared.length === 0) {
    return { player, enemies, board, rng, events: [], killedIds: [] }
  }
  const count = cellsCleared.length
  const events: GameEvent[] = []
  const killedIds: string[] = []

  // Per-colour effect. Mirrors the per-match commit logic in
  // attemptSwap, just inlined for shatter's single-event payout.
  let nextPlayer = player
  let nextEnemies = enemies
  if (color === 'red') {
    const aoe = applyMatchRedDamage(
      enemies,
      targetEnemyId,
      count,
      player.statuses,
      false, // single-target — shatter focuses the damage on the current target
    )
    nextEnemies = aoe.enemies
    events.push(...aoe.events)
    killedIds.push(...aoe.killedIds)
  } else if (color === 'blue') {
    nextPlayer = {
      ...nextPlayer,
      phasePools: { ...nextPlayer.phasePools, blue: nextPlayer.phasePools.blue + count },
      mana: {
        ...nextPlayer.mana,
        blue: Math.min(MANA_CAPS.blue, nextPlayer.mana.blue + count),
      },
    }
  } else if (color === 'green') {
    const before = nextPlayer.hp
    const next = Math.min(nextPlayer.maxHp, before + count)
    const healed = next - before
    nextPlayer = {
      ...nextPlayer,
      hp: next,
      phasePools: { ...nextPlayer.phasePools, green: nextPlayer.phasePools.green + count },
      mana: {
        ...nextPlayer.mana,
        green: Math.min(MANA_CAPS.green, nextPlayer.mana.green + count),
      },
    }
    if (healed > 0) {
      events.push({ kind: 'healed', amount: healed })
    }
  } else if (color === 'yellow') {
    nextPlayer = {
      ...nextPlayer,
      mana: {
        ...nextPlayer.mana,
        yellow: Math.min(MANA_CAPS.yellow, nextPlayer.mana.yellow + count),
      },
    }
  } else if (color === 'purple') {
    nextPlayer = {
      ...nextPlayer,
      skillCharge: nextPlayer.skillCharge + count,
    }
  }
  // Pool-gained drives the trail/particle FX layer and the SFX bed.
  // Emit AFTER any per-colour event so animation ordering matches the
  // normal cascade pipeline (damage/heal lands first, trail flies in).
  events.push({ kind: 'pool-gained', color, amount: count })

  // gems-cleared drives the clear-burst animation + clack SFX (same
  // event the cascade pipeline + column-smash both use).
  events.push({ kind: 'gems-cleared', cells: cellsCleared })

  // Null the cleared cells, run gravity, refill from above. Uses the
  // spell's rng stream — shatter is player-initiated, so the spawn
  // colours should be deterministic against the player-side rng
  // rather than the enemy-side one. Caller passes `rng.board`.
  const cleared: (Cell | null)[][] = board.map((row, y) =>
    row.map((cell, x) =>
      cell?.gemColor === color && cellsCleared.some((c) => c.x === x && c.y === y)
        ? null
        : cell,
    ),
  )
  const { board: fallen, movements } = applyGravity(cleared)
  if (movements.length > 0) events.push({ kind: 'gems-fell', movements })
  let nextRng = rng
  const spawns: { at: Pos; color: GemColor }[] = []
  const refilled: Cell[][] = fallen.map((row, y) =>
    row.map((c, x): Cell => {
      if (c) return c
      const [idx, nr] = nextInt(nextRng, GEM_COLORS.length)
      nextRng = nr
      const fresh = GEM_COLORS[idx]
      if (!fresh) throw new Error('shatter: refill color oob')
      spawns.push({ at: { x, y }, color: fresh })
      return { gemColor: fresh }
    }),
  )
  if (spawns.length > 0) events.push({ kind: 'gems-spawned', spawns })

  return {
    player: nextPlayer,
    enemies: nextEnemies,
    board: refilled,
    rng: nextRng,
    events,
    killedIds,
  }
}

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
