// Particle trails take this long to travel from a gem to their HUD target.
// Popups, SFX, and HUD value bumps all schedule on this delay so they land
// when the trail visibly arrives.
export const TRAIL_ARRIVAL_MS = 700

export function scheduleAtTrailArrival(fn: () => void): number {
  return window.setTimeout(fn, TRAIL_ARRIVAL_MS)
}
