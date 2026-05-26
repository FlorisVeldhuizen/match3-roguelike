import {
  MANA_CAPS,
  type Enemy,
  type GameEvent,
  type HexedColor,
  type Player,
} from '../../types'
import { applyMultiplier } from './math'
import { getCascadeMultiplier } from './multipliers'
import {
  runOnCascade,
  runOnEnemyKilled,
  runOnMatch,
  snapshotOf,
} from '../relics/engine'
import { applyMatchRedDamage, pickNextTarget } from './aoe'
import { applyStatusToList } from './statuses'
import { getStatusTemplate, BURN_FROM_TILE_BONUS } from './statuses'

// Cascade event processor. Walks a stream of cascade-shape events
// (cascade-start / match-found / tile-burn-triggered, plus any
// pass-through events from the cascade walker like gems-cleared,
// gems-fell, gems-spawned) and produces the augmented stream — with
// pool-gained, damage-dealt, healed, enemy-killed events filled in —
// along with the updated player/enemies/target state.
//
// Extracted from attemptSwap (was inlined there). Now also driven by
// castShatter so Sharp Edge / Iron Buckler / Cascade Crystal fire on
// shatter the same way they fire on a regular match.
//
// Handles per-match Surge/Skewer consumption: each match-found event
// reads the player's armed flags, applies them, and clears both the
// flag and the matching pendingSpells entry. Volley-pending state
// redirects red damage into phasePools without applying immediate
// damage (Volley resolves at EOP).
export function processCascadeEvents(
  cascadeEvents: readonly GameEvent[],
  initialPlayer: Player,
  initialEnemies: Enemy[],
  initialTargetEnemyId: string | null,
  // H2c: read-only set of currently-hexed colours. When a match-found
  // event lands on a hexed colour, Weak is applied to the player with
  // stacks = match.cells.length. The set itself doesn't tick here —
  // tickHexedColors runs at the enemy-phase boundary in actions/swap.ts.
  hexedColors: readonly HexedColor[] = [],
): {
  player: Player
  enemies: Enemy[]
  targetEnemyId: string | null
  events: GameEvent[]
} {
  let player = initialPlayer
  let enemies = initialEnemies
  let targetEnemyId = initialTargetEnemyId
  const stream: GameEvent[] = []
  let cascadeLevel = 0

  for (const ev of cascadeEvents) {
    // Pass-through: the input event itself goes into the augmented
    // stream first, then any processor-emitted tail events follow.
    stream.push(ev)

    // Burning cells cleared this cascade step apply Burn to the player.
    // Magnitude = cells.length + content-side bonus. StS triangle math
    // → 1 cell = 2 Burn → 3 dmg total; 4 cells = 5 Burn → 15 dmg.
    if (ev.kind === 'tile-burn-triggered') {
      const incoming = {
        ...getStatusTemplate('burn'),
        stacks: ev.cells.length + BURN_FROM_TILE_BONUS,
      }
      player = {
        ...player,
        statuses: applyStatusToList(player.statuses, incoming),
      }
      stream.push({
        kind: 'status-applied',
        target: 'player',
        status: incoming,
        source: { kind: 'board-cells', cells: ev.cells },
      })
      continue
    }

    if (ev.kind === 'cascade-start') {
      cascadeLevel = ev.level
      const onCascade = runOnCascade(
        { level: ev.level },
        player.relics,
        snapshotOf(player, enemies, targetEnemyId, cascadeLevel),
      )
      stream.push(...onCascade)
      continue
    }

    if (ev.kind !== 'match-found') continue

    // Surge: a one-shot armed by casting Surge bumps THIS match's
    // cascade level by +2 (affects relic onMatch hooks AND the raw
    // multiplier). Consumed below after processing finishes.
    const surgeConsumed = player.surgeArmed === true
    const effectiveCascade = surgeConsumed ? cascadeLevel + 2 : cascadeLevel

    // Per-match payload: raw amount = size × cascade × blessed,
    // assigned to the match's colour slot. Relics' onMatch hooks
    // mutate these deltas in acquisition order.
    const cascadeMult = getCascadeMultiplier(effectiveCascade)
    const mult = ev.blessed ? cascadeMult * 2 : cascadeMult
    const raw = applyMultiplier(ev.size, mult)
    // Phase I: gold matches pay 2g per cleared cell (3-match → 6g,
    // 5-line → 10g) before cascade / blessed multipliers. Doubling at
    // the base keeps Cascade Crystal & future cascade relics composable
    // with gold the same way they compose with mana.
    const goldRaw = applyMultiplier(ev.size * 2, mult)
    const initialDeltas = {
      red: ev.color === 'red' ? raw : 0,
      blue: ev.color === 'blue' ? raw : 0,
      green: ev.color === 'green' ? raw : 0,
      yellow: ev.color === 'yellow' ? raw : 0,
      purple: ev.color === 'purple' ? raw : 0,
      gold: ev.color === 'gold' ? goldRaw : 0,
    }
    const matchResult = runOnMatch(
      {
        match: { cells: ev.cells, color: ev.color, size: ev.size, shape: ev.shape },
        deltas: initialDeltas,
        cascadeLevel: effectiveCascade,
      },
      player.relics,
      snapshotOf(player, enemies, targetEnemyId, effectiveCascade),
    )
    stream.push(...matchResult.events)
    const finalDeltas = matchResult.payload.deltas

    // H3 multi-color mana: each colour delta accumulates into both the
    // immediate-effect track (R/B/G into phasePools, P into skillCharge)
    // AND the colour mana pool (per MANA_CAPS). Yellow goes only into
    // the colour mana pool (wild). Purple only into skillCharge.
    const m = player.mana
    player = {
      ...player,
      skillCharge: player.skillCharge + finalDeltas.purple,
      phasePools: {
        red: player.phasePools.red + finalDeltas.red,
        blue: player.phasePools.blue + finalDeltas.blue,
        green: player.phasePools.green + finalDeltas.green,
      },
      mana: {
        red: Math.min(MANA_CAPS.red, m.red + finalDeltas.red),
        blue: Math.min(MANA_CAPS.blue, m.blue + finalDeltas.blue),
        green: Math.min(MANA_CAPS.green, m.green + finalDeltas.green),
        yellow: Math.min(MANA_CAPS.yellow, m.yellow + finalDeltas.yellow),
      },
      // Phase I: gold accumulates run-wide. No cap; spending happens at
      // shop nodes between fights.
      gold: player.gold + finalDeltas.gold,
    }

    // H2c: hex side-effect. If this match's colour is currently hexed,
    // apply Weak with stacks=cells.length. Weak stacks additively
    // (per the H2c rule — see applyStatusToList), so chaining matches
    // of the hexed colour piles up duration. Fires BEFORE the red-damage
    // step below so the new Weak dampens this match's outgoing damage —
    // same-cascade composability matches the way Skewer/Surge consume
    // on this match.
    if (hexedColors.some((h) => h.color === ev.color)) {
      const stacks = ev.cells.length
      const incoming = { kind: 'weak' as const, stacks }
      player = {
        ...player,
        statuses: applyStatusToList(player.statuses, incoming),
      }
      stream.push({
        kind: 'hex-triggered',
        color: ev.color,
        stacks,
        cells: ev.cells,
      })
      stream.push({
        kind: 'status-applied',
        target: 'player',
        status: incoming,
        source: { kind: 'board-cells', cells: ev.cells },
      })
    }

    // AOE matches (T, L, line-5) fan red damage to all living enemies;
    // smaller line matches and shatter shapes stay single-target.
    const isAoe =
      ev.shape === 'T' || ev.shape === 'L' || (ev.shape === 'line' && ev.size === 5)

    // Emit pool-gained per non-zero delta in canonical order so the
    // animator/SFX layer sees a deterministic sequence. Gold is appended
    // last — it has no in-match side effect (no damage, no heal, no
    // mana credit), only the HUD-side gold counter bump.
    for (const color of ['red', 'blue', 'green', 'yellow', 'purple', 'gold'] as const) {
      const amount = finalDeltas[color]
      if (amount <= 0) continue
      stream.push({ kind: 'pool-gained', color, amount })
      if (color === 'gold') continue
      if (color === 'red') {
        // While Volley is pending, red damage stops landing — pool
        // accumulates instead, consumed at EOP.
        if (player.pendingSpells.includes('volley')) continue
        // Skewer doubles the red damage on this match (pool credit
        // above is NOT doubled — only damage applied). Consumed
        // below regardless of whether the doubled hit lands HP.
        const skewerConsumed = player.skewerArmed === true
        const dmgAmount = skewerConsumed ? amount * 2 : amount
        const aoe = applyMatchRedDamage(
          enemies,
          targetEnemyId,
          dmgAmount,
          player.statuses,
          isAoe,
        )
        enemies = aoe.enemies
        stream.push(...aoe.events)
        for (const killedId of aoe.killedIds) {
          stream.push({ kind: 'enemy-killed', enemyId: killedId })
          const killEvents = runOnEnemyKilled(
            { enemyId: killedId },
            player.relics,
            snapshotOf(player, enemies, targetEnemyId, cascadeLevel),
          )
          stream.push(...killEvents)
          if (killedId === targetEnemyId) {
            targetEnemyId = pickNextTarget(enemies, null)
          }
        }
      } else if (color === 'green') {
        const before = player.hp
        const next = Math.min(player.maxHp, player.hp + amount)
        const healed = next - before
        if (healed <= 0) continue
        player = { ...player, hp: next }
        stream.push({ kind: 'healed', amount: healed })
      }
    }

    // Skewer / Surge: one-shot match modifiers consumed by this match.
    // Clear both the per-player flag AND the corresponding entry in
    // pendingSpells so the PendingStrip drops the pip.
    if (player.skewerArmed === true) {
      player = {
        ...player,
        skewerArmed: false,
        pendingSpells: player.pendingSpells.filter((id) => id !== 'skewer'),
      }
      stream.push({ kind: 'pending-effect-resolved', spellId: 'skewer' })
    }
    if (surgeConsumed) {
      player = {
        ...player,
        surgeArmed: false,
        pendingSpells: player.pendingSpells.filter((id) => id !== 'surge'),
      }
      stream.push({ kind: 'pending-effect-resolved', spellId: 'surge' })
    }
  }

  return { player, enemies, targetEnemyId, events: stream }
}
