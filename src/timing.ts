export const TRAIL_ARRIVAL_MS = 700
/** Mana spend trails: pool → spell (shorter than board → pool earn). */
export const SPEND_TRAIL_ARRIVAL_MS = 420
/** Spell button → effect target (HP, status, etc.). */
export const SPELL_EFFECT_TRAIL_ARRIVAL_MS = 380

export function scheduleAtTrailArrival(fn: () => void): number {
  return window.setTimeout(fn, TRAIL_ARRIVAL_MS)
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
