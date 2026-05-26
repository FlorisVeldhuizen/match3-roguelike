import { nextInt, type RngState } from '../rng/mulberry32'
import type { Enemy, GemColor, Intent, Pos } from '../../types'
import { BOARD_HEIGHT, BOARD_WIDTH, GEM_COLORS } from '../../types'
import { type ArchetypeDef, type IntentRange } from './archetypeRegistry'

// Per-intent-kind rollers. Each is pure: takes only what it needs (rng,
// archetype def, optional ally list for ally-target kinds) and returns
// the rolled intent + advanced rng. Mirrors the spellResolvers /
// intentResolvers pattern.
//
// Why varying signatures (not a uniform `(def, rng, ctx) => Intent`):
// - 'attack' / 'block' only need rng + def's range
// - 'tile-burn' needs def's tileBurnCount; no rng advance
// - ally intents need the live sibling list + the roller's id
// - 'column-smash' / 'petrify-row' need rng + board dimensions (constants)
// Forcing a single signature would either widen all callers or hide the
// real input shape behind a vague "context" object. Per-kind narrow
// signatures keep the call sites in `rollIntent` honest.

export function rollAttackIntent(
  def: ArchetypeDef,
  rng: RngState,
): { intent: Intent; rng: RngState } {
  const [amount, r2] = rollInRange(rng, def.attackRange)
  // Carry the archetype's onHitStatus onto the intent itself so the
  // UI can telegraph it (e.g. Smolder's attacks show "⚔ 3 +🔥") and
  // executeEnemyTurn doesn't have to round-trip through the registry.
  const onHit = def.onHitStatus
    ? { status: def.onHitStatus.kind, stacks: def.onHitStatus.stacks }
    : undefined
  return {
    intent: onHit
      ? { kind: 'attack', amount, onHit }
      : { kind: 'attack', amount },
    rng: r2,
  }
}

export function rollBlockIntent(
  def: ArchetypeDef,
  rng: RngState,
): { intent: Intent; rng: RngState } {
  const [amount, r2] = rollInRange(rng, def.blockRange)
  return { intent: { kind: 'block', amount }, rng: r2 }
}

export function rollTileBurnIntent(
  def: ArchetypeDef,
  rng: RngState,
): { intent: Intent; rng: RngState } {
  // tile-burn: no roll — count is fixed per archetype. Cell selection
  // happens at fire time in executeEnemyTurn (it needs the live board).
  const count = def.tileBurnCount ?? 1
  return { intent: { kind: 'tile-burn', count }, rng }
}

// Shared logic for the three ally-target kinds. Returns null if no
// sibling is alive — caller (rollIntent) then falls back to attack so
// the rolling enemy still has a turn.
function pickAllySibling(
  livingAllies: readonly Enemy[],
  rollerEnemyId: string | undefined,
  rng: RngState,
): { targetAllyId: string; rng: RngState } | null {
  const siblings = livingAllies.filter(
    (e) => e.hp > 0 && e.id !== rollerEnemyId,
  )
  if (siblings.length === 0) return null
  const [idx, r2] = nextInt(rng, siblings.length)
  return { targetAllyId: siblings[idx]!.id, rng: r2 }
}

export function rollHealAllyIntent(
  def: ArchetypeDef,
  rng: RngState,
  livingAllies: readonly Enemy[],
  rollerEnemyId: string | undefined,
): { intent: Intent; rng: RngState } | null {
  const pick = pickAllySibling(livingAllies, rollerEnemyId, rng)
  if (!pick) return null
  const range = def.healAllyRange ?? { min: 2, max: 4 }
  const [amount, r3] = rollInRange(pick.rng, range)
  return {
    intent: { kind: 'heal-ally', amount, targetAllyId: pick.targetAllyId },
    rng: r3,
  }
}

export function rollShieldAllyIntent(
  def: ArchetypeDef,
  rng: RngState,
  livingAllies: readonly Enemy[],
  rollerEnemyId: string | undefined,
): { intent: Intent; rng: RngState } | null {
  const pick = pickAllySibling(livingAllies, rollerEnemyId, rng)
  if (!pick) return null
  const range = def.shieldAllyRange ?? { min: 2, max: 4 }
  const [amount, r3] = rollInRange(pick.rng, range)
  return {
    intent: { kind: 'shield-ally', amount, targetAllyId: pick.targetAllyId },
    rng: r3,
  }
}

export function rollBuffAllyIntent(
  def: ArchetypeDef,
  rng: RngState,
  livingAllies: readonly Enemy[],
  rollerEnemyId: string | undefined,
): { intent: Intent; rng: RngState } | null {
  const pick = pickAllySibling(livingAllies, rollerEnemyId, rng)
  if (!pick) return null
  // buff-ally: fixed stacks count, no range roll beyond the sibling pick.
  const stacks = def.buffAllyStacks ?? 2
  return {
    intent: { kind: 'buff-ally', stacks, targetAllyId: pick.targetAllyId },
    rng: pick.rng,
  }
}

// Bounded-retry overlap avoidance. Roll a discrete value in [0, size);
// if it collides with `claimed`, retry up to `attempts` times. Fall
// back to the last roll if the claimed set is saturated (e.g. all
// columns already claimed) — no enemy turn should hang due to bad RNG.
function pickUnclaimedInt(
  rng: RngState,
  size: number,
  claimed: ReadonlySet<number>,
  attempts = 16,
): [number, RngState] {
  let r = rng
  let last = 0
  for (let i = 0; i < attempts; i++) {
    const [value, nr] = nextInt(r, size)
    r = nr
    last = value
    if (!claimed.has(value)) return [value, r]
  }
  return [last, r]
}

export function rollColumnSmashIntent(
  rng: RngState,
  claimedColumns: ReadonlySet<number> = new Set(),
): { intent: Intent; rng: RngState } {
  const [column, r2] = pickUnclaimedInt(rng, BOARD_WIDTH, claimedColumns)
  return { intent: { kind: 'column-smash', column }, rng: r2 }
}

export function rollPetrifyRowIntent(
  rng: RngState,
  claimedRows: ReadonlySet<number> = new Set(),
): { intent: Intent; rng: RngState } {
  const [row, r2] = pickUnclaimedInt(rng, BOARD_HEIGHT, claimedRows)
  return { intent: { kind: 'petrify-row', row }, rng: r2 }
}

// H2c: Caster picks the colour at roll time so the telegraph can render
// the threat (which colour to avoid matching next phase). Uniform over
// the 5 gem colours; future tuning could weight by board presence.
export function rollColorHexIntent(
  rng: RngState,
  claimedColors: ReadonlySet<GemColor> = new Set(),
): { intent: Intent; rng: RngState } {
  // Pick a color index whose color isn't already claimed. Same bounded-
  // retry pattern as the column/row pickers, but checks claim via the
  // resolved GemColor rather than the index, so the registry order
  // doesn't matter.
  let r = rng
  let lastIdx = 0
  for (let i = 0; i < 16; i++) {
    const [idx, nr] = nextInt(r, GEM_COLORS.length)
    r = nr
    lastIdx = idx
    const color = GEM_COLORS[idx]
    if (color && !claimedColors.has(color)) {
      return { intent: { kind: 'color-hex', color }, rng: r }
    }
  }
  const color = GEM_COLORS[lastIdx]
  if (!color) throw new Error('rollColorHexIntent: gem-color index oob')
  return { intent: { kind: 'color-hex', color }, rng: r }
}

// H2c: Swarmer rolls a 2-cell source run + 2-cell destination run.
// Orientation (horizontal/vertical) randomized; both runs share the
// same orientation so the move preserves shape. Destination must not
// overlap source — sampled with bounded retry, falls back to any
// non-overlapping run if 16 attempts fail to find a clean pick.
//
// `claimedCells` is the set of cells already spoken for by sibling
// enemies' telegraphed verbs (column-smash columns expanded to cells,
// petrify-row rows expanded to cells, other shoves' source+dest
// cells). Avoiding overlap prevents two telegraphs marking the same
// cell, prevents a Brute from erasing a Swarmer's shoved gems next
// turn, etc. See aggregateSiblingClaims / expandClaimsToCells in
// intents.ts. Falls back to an unconstrained pick if the board is
// saturated.
export function rollClusterShoveIntent(
  def: ArchetypeDef,
  rng: RngState,
  claimedCells: ReadonlySet<string> = new Set(),
): { intent: Intent; rng: RngState } {
  const length = def.clusterShoveLength ?? 2
  let r = rng
  const [oriIdx, r1] = nextInt(r, 2)
  const horizontal = oriIdx === 0
  r = r1

  const pickRun = (state: RngState): { run: Pos[]; rng: RngState } => {
    if (horizontal) {
      const [x, ra] = nextInt(state, BOARD_WIDTH - length + 1)
      const [y, rb] = nextInt(ra, BOARD_HEIGHT)
      const cells: Pos[] = []
      for (let i = 0; i < length; i++) cells.push({ x: x + i, y })
      return { run: cells, rng: rb }
    } else {
      const [x, ra] = nextInt(state, BOARD_WIDTH)
      const [y, rb] = nextInt(ra, BOARD_HEIGHT - length + 1)
      const cells: Pos[] = []
      for (let i = 0; i < length; i++) cells.push({ x, y: y + i })
      return { run: cells, rng: rb }
    }
  }

  const overlapsClaimed = (cells: Pos[]): boolean =>
    cells.some((p) => claimedCells.has(`${p.x},${p.y}`))

  // Pick a source that doesn't collide with existing flags. Bounded
  // retry; falls through to whatever the last attempt produced if the
  // board is saturated (very unlikely with length 2 + 8×8).
  let sources: Pos[] = []
  for (let attempt = 0; attempt < 16; attempt++) {
    const srcPick = pickRun(r)
    r = srcPick.rng
    if (!overlapsClaimed(srcPick.run)) {
      sources = srcPick.run
      break
    }
    if (attempt === 15) sources = srcPick.run
  }

  const overlaps = (a: Pos[], b: Pos[]): boolean =>
    a.some((p) => b.some((q) => p.x === q.x && p.y === q.y))

  let destinations: Pos[] = []
  for (let attempt = 0; attempt < 16; attempt++) {
    const dstPick = pickRun(r)
    r = dstPick.rng
    if (!overlaps(dstPick.run, sources) && !overlapsClaimed(dstPick.run)) {
      destinations = dstPick.run
      break
    }
  }
  // Fallback: nudge sources by one cell in-bounds and use that. Hits
  // only on pathological boards where all 16 attempts overlap (vanishingly
  // rare with 8×8 + length 2 — there are ~50 non-overlapping placements).
  if (destinations.length === 0) {
    if (horizontal) {
      const sx = sources[0]?.x ?? 0
      const sy = sources[0]?.y ?? 0
      const newX = sx >= BOARD_WIDTH - length ? 0 : sx + length
      destinations = []
      for (let i = 0; i < length; i++) destinations.push({ x: newX + i, y: sy })
    } else {
      const sx = sources[0]?.x ?? 0
      const sy = sources[0]?.y ?? 0
      const newY = sy >= BOARD_HEIGHT - length ? 0 : sy + length
      destinations = []
      for (let i = 0; i < length; i++) destinations.push({ x: sx, y: newY + i })
    }
  }

  return { intent: { kind: 'cluster-shove', sources, destinations }, rng: r }
}

function rollInRange(rng: RngState, range: IntentRange): [number, RngState] {
  const span = range.max - range.min + 1
  const [delta, next] = nextInt(rng, span)
  return [range.min + delta, next]
}
