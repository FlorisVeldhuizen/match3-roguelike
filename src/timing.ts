// Particle trails take this long to travel from a gem to their HUD target.
// Popups, SFX, and HUD value bumps all schedule on this delay so they land
// when the trail visibly arrives.
export const TRAIL_ARRIVAL_MS = 700

export function scheduleAtTrailArrival(fn: () => void): number {
  return window.setTimeout(fn, TRAIL_ARRIVAL_MS)
}

// Gem-motion timings. Shared between the Pixi AnimationController (which
// tweens the gem sprites) and HTML cell-anchored overlays (e.g.
// BurningOverlay) so decorations animate over the exact same window as
// the gem they ride on.
export const SWAP_MS = 200
export const DROP_PER_CELL_MS = 45
// Minimum fall portion (gem in flight) before the bounce window. The fall
// scales with distance so a column lands in cascade; this floor only
// prevents pathologically fast 1-frame falls.
export const DROP_MIN_FALL_MS = 65

export function fallDurationMs(distance: number): number {
  return Math.max(DROP_MIN_FALL_MS, DROP_PER_CELL_MS * distance)
}

// cubic-bezier approximations of the easing curves used by the sprite
// tweens (tweenSwap: easeOutQuad, tweenDrop fall phase: easeInQuad).
// Used as inline CSS `transition-timing-function` so cell-anchored HTML
// overlays read as the same motion as the sprites underneath.
export const SWAP_BEZIER = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'
export const FALL_BEZIER = 'cubic-bezier(0.55, 0.085, 0.68, 0.53)'
