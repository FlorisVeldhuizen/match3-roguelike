import { nextInt, type RngState } from '../rng/mulberry32'
import type { Enemy, GemColor, Intent, Pos } from '../../types'
import { BOARD_HEIGHT, BOARD_WIDTH, MANA_GEM_COLORS } from '../../types'
import { type ArchetypeDef, type IntentRange } from './archetypeRegistry'

export function rollAttackIntent(
  def: ArchetypeDef,
  rng: RngState,
): { intent: Intent; rng: RngState } {
  const [amount, r2] = rollInRange(rng, def.attackRange)
  const onHit = def.onHitStatus
    ? { status: def.onHitStatus.kind, stacks: def.onHitStatus.stacks }
    : undefined
  return {
    intent: onHit ? { kind: 'attack', amount, onHit } : { kind: 'attack', amount },
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
  // No roll — cell selection happens at fire time (needs live board).
  const count = def.tileBurnCount ?? 1
  return { intent: { kind: 'tile-burn', count }, rng }
}

function pickAllySibling(
  livingAllies: readonly Enemy[],
  rollerEnemyId: string | undefined,
  rng: RngState,
): { targetAllyId: string; rng: RngState } | null {
  const siblings = livingAllies.filter((e) => e.hp > 0 && e.id !== rollerEnemyId)
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
  const stacks = def.buffAllyStacks ?? 2
  return {
    intent: { kind: 'buff-ally', stacks, targetAllyId: pick.targetAllyId },
    rng: pick.rng,
  }
}

// Bounded retry; falls back to last roll if all values are claimed.
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

// Never gold — hex on a rare non-mana colour would feel like a dud.
export function rollColorHexIntent(
  rng: RngState,
  claimedColors: ReadonlySet<GemColor> = new Set(),
): { intent: Intent; rng: RngState } {
  let r = rng
  let lastIdx = 0
  for (let i = 0; i < 16; i++) {
    const [idx, nr] = nextInt(r, MANA_GEM_COLORS.length)
    r = nr
    lastIdx = idx
    const color = MANA_GEM_COLORS[idx]
    if (color && !claimedColors.has(color)) {
      return { intent: { kind: 'color-hex', color }, rng: r }
    }
  }
  const color = MANA_GEM_COLORS[lastIdx]
  if (!color) throw new Error('rollColorHexIntent: gem-color index oob')
  return { intent: { kind: 'color-hex', color }, rng: r }
}

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
  // Fallback for saturated boards (vanishingly rare with 8×8 + length 2).
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

// Color-drain: picks a mana color (never gold), same retry pattern as color-hex.
export function rollColorDrainIntent(
  rng: RngState,
  claimedColors: ReadonlySet<GemColor> = new Set(),
): { intent: Intent; rng: RngState } {
  let r = rng
  let lastIdx = 0
  for (let i = 0; i < 16; i++) {
    const [idx, nr] = nextInt(r, MANA_GEM_COLORS.length)
    r = nr
    lastIdx = idx
    const color = MANA_GEM_COLORS[idx]
    if (color && !claimedColors.has(color)) {
      return { intent: { kind: 'color-drain', color }, rng: r }
    }
  }
  const color = MANA_GEM_COLORS[lastIdx]
  if (!color) throw new Error('rollColorDrainIntent: gem-color index oob')
  return { intent: { kind: 'color-drain', color }, rng: r }
}

// Trick: resolves at fire time as either attack or block (50/50).
// The rolled intent is stored inside the trick wrapper so the resolver
// can execute it, but the telegraph shows "???" to the player.
export function rollTrickIntent(
  def: ArchetypeDef,
  rng: RngState,
): { intent: Intent; rng: RngState } {
  const [coin, r1] = nextInt(rng, 2)
  if (coin === 0) {
    const { intent: resolved, rng: r2 } = rollAttackIntent(def, r1)
    return { intent: { kind: 'trick', resolved }, rng: r2 }
  } else {
    const { intent: resolved, rng: r2 } = rollBlockIntent(def, r1)
    return { intent: { kind: 'trick', resolved }, rng: r2 }
  }
}

function rollInRange(rng: RngState, range: IntentRange): [number, RngState] {
  const span = range.max - range.min + 1
  const [delta, next] = nextInt(rng, span)
  return [range.min + delta, next]
}
