import { Ticker, type Sprite } from 'pixi.js'

// Fall curve: accelerating fall through ~85% of the travel (gravity feel),
// then a small overshoot past the target and settle. The settle reads as
// the gem "thumping" into place — adds weight without scale-squash (which
// would fight the hover scale system).
//
// Returns 0 → 1 with a brief excursion to ~1.04 around the landing moment.
const LANDING_T = 0.82
const OVERSHOOT = 0.045
function fallCurve(t: number): number {
  if (t < LANDING_T) {
    const s = t / LANDING_T
    return s * s
  }
  // Bounce arc: starts at 1.0 (already at target), peaks at 1+overshoot
  // around s=0.4, returns to 1.0 at s=1. Damped so the apex is early.
  const s = (t - LANDING_T) / (1 - LANDING_T)
  return 1 + Math.sin(Math.PI * s) * OVERSHOOT * (1 - s * 0.45)
}

export function tweenDrop(
  sprite: Sprite,
  toX: number,
  toY: number,
  durationMs: number,
): Promise<void> {
  const startX = sprite.x
  const startY = sprite.y
  let elapsed = 0
  return new Promise((resolve) => {
    const tick = (ticker: Ticker) => {
      elapsed += ticker.deltaMS
      const t = Math.min(elapsed / durationMs, 1)
      const e = fallCurve(t)
      sprite.x = startX + (toX - startX) * e
      sprite.y = startY + (toY - startY) * e
      if (t >= 1) {
        // Pin to exact target on completion so floating-point drift from the
        // bounce curve doesn't leave the sprite sub-pixel offset.
        sprite.x = toX
        sprite.y = toY
        Ticker.shared.remove(tick)
        resolve()
      }
    }
    Ticker.shared.add(tick)
  })
}
