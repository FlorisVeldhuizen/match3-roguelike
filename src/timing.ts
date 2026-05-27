import type { TrailPurpose } from './types'

export const TRAIL_ARRIVAL_MS = 700
/** Mana spend trails: pool → spell (shorter than board → pool earn). */
export const SPEND_TRAIL_ARRIVAL_MS = 420
/** Spell button → effect target (HP, status, etc.). */
export const SPELL_EFFECT_TRAIL_ARRIVAL_MS = 380

/** Board verb overlays (petrify, hex, frozen wall, column smash, etc.) fade out over this window before unmount. */
export const BOARD_EFFECT_FIZZLE_MS = 1100

/** Straight-line px → ms for bezier trails (~500px ≈ TRAIL_ARRIVAL_MS before purpose scale). */
const TRAIL_MS_PER_PX = 0.92
const TRAIL_MS_OFFSET = 130
const TRAIL_SHORT_HOP_PX = 95
export const TRAIL_SHORT_HOP_MIN_MS = 175
export const TRAIL_MIN_MS = 260
export const TRAIL_MAX_MS = 760
/** Stagger between particles in one trail burst. */
export const TRAIL_PARTICLE_STAGGER_MS = 48

/** Per-route feel tuning (multiplies distance-based duration). */
const TRAIL_PURPOSE_SCALE: Record<TrailPurpose, number> = {
  'pool-earn': 1.38,
  'mana-spend': 1.05,
  'spell-effect': 0.88,
  'status-apply': 1.08,
  'status-proc': 0.95,
  'player-attack': 1.12,
  'verb-to-board': 1.22,
}

export type TrailPoint = { x: number; y: number }

export function trailDurationMs(distancePx: number, purpose?: TrailPurpose): number {
  const d = Math.max(0, distancePx)
  if (d < TRAIL_SHORT_HOP_PX) return TRAIL_SHORT_HOP_MIN_MS
  const scale = purpose ? TRAIL_PURPOSE_SCALE[purpose] : 1
  const raw = (d * TRAIL_MS_PER_PX + TRAIL_MS_OFFSET) * scale
  return Math.round(Math.min(TRAIL_MAX_MS, Math.max(TRAIL_MIN_MS, raw)))
}

export function trailDurationBetween(
  from: TrailPoint,
  to: TrailPoint,
  purpose?: TrailPurpose,
): number {
  return trailDurationMs(Math.hypot(to.x - from.x, to.y - from.y), purpose)
}

/** When the last particle in a burst reaches its target. */
export function trailBurstArrivalMs(baseDurationMs: number, particleCount: number): number {
  const n = Math.max(1, particleCount)
  return baseDurationMs + (n - 1) * TRAIL_PARTICLE_STAGGER_MS
}

export function scheduleAfterMs(fn: () => void, ms: number): number {
  return window.setTimeout(fn, ms)
}

export function scheduleAtTrailArrival(fn: () => void, ms: number = TRAIL_ARRIVAL_MS): number {
  return scheduleAfterMs(fn, ms)
}

export function scheduleAtSpendTrailArrival(fn: () => void): number {
  return window.setTimeout(fn, SPEND_TRAIL_ARRIVAL_MS)
}

export const STATUS_APPLY_AFTER_HIT_MS = 350

export const SWAP_MS = 200
export const DROP_PER_CELL_MS = 45
export const DROP_MIN_FALL_MS = 65

export function fallDurationMs(distance: number): number {
  return Math.max(DROP_MIN_FALL_MS, DROP_PER_CELL_MS * distance)
}

export const SWAP_BEZIER = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
export const FALL_BEZIER = 'cubic-bezier(0.55, 0.085, 0.68, 0.53)'
