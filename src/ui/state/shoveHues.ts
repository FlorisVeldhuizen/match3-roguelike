import type { Enemy } from '../../types'

// Per-swarmer accent hues for the cluster-shove overlay. With multiple
// swarmers on the board, every shove threat used to render in the same
// teal — three crisscrossing source rings + destination markers + lines
// fused into one indistinct mass. Hue-by-position lets the eye trace
// "this swarmer's run goes here, this other one's goes there" at a
// glance. The palette is picked for hue distance (~120°-ish apart on
// the wheel) while staying in the same desaturation band so no single
// threat shouts louder than its neighbours.
//
// One hue per enemy index in the row (stable for a fight, since
// enemies are added once and never reordered). Four hues cover the
// max-encounter count without collisions; if a future encounter needs
// more, add hues here.
export const SHOVE_HUES = [170, 290, 38, 130] as const

// Returns the hue (degrees, for `hsl()`) for this enemy, OR null if the
// enemy isn't on the board / is dead. Stable per enemy across renders
// since it keys off the array order.
export function shoveHueFor(enemies: Enemy[], enemyId: string): number | null {
  const idx = enemies.findIndex((e) => e.id === enemyId)
  if (idx < 0) return null
  return SHOVE_HUES[idx % SHOVE_HUES.length]
}
