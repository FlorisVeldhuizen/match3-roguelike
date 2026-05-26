import { Ticker, type Sprite } from 'pixi.js'

// Swarmer cluster-shove: a gem visibly arcs from its source cell to its
// destination cell. Linear x lerp, parabolic y (peak above the midpoint)
// so the motion reads as "thrown across the board" rather than as a swap
// or a fall. Subtle scale pulse mid-flight reinforces that this is one
// gem moving, not a dissolve + respawn.

const easeInOutQuad = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

// Arc peak as a fraction of horizontal distance, capped so cross-board
// shoves don't fling the sprite off-screen.
const ARC_HEIGHT_RATIO = 0.4
const ARC_HEIGHT_MAX_PX = 90
// Scale envelope: half-sine 1.0 → 1.12 → 1.0 over the flight. Small
// enough not to read as a separate effect; big enough to sell "moving."
const SCALE_PULSE = 0.12

export function tweenShoveArc(
  sprite: Sprite,
  toX: number,
  toY: number,
  durationMs: number,
): Promise<void> {
  const startX = sprite.x
  const startY = sprite.y
  const baseScaleX = sprite.scale.x
  const baseScaleY = sprite.scale.y
  const dx = toX - startX
  const arcHeight = Math.min(ARC_HEIGHT_MAX_PX, Math.abs(dx) * ARC_HEIGHT_RATIO)
  let elapsed = 0
  return new Promise((resolve) => {
    const tick = (ticker: Ticker) => {
      elapsed += ticker.deltaMS
      const t = Math.min(elapsed / durationMs, 1)
      const e = easeInOutQuad(t)
      sprite.x = startX + (toX - startX) * e
      sprite.y = startY + (toY - startY) * e - arcHeight * Math.sin(Math.PI * e)
      const pulse = 1 + SCALE_PULSE * Math.sin(Math.PI * e)
      sprite.scale.x = baseScaleX * pulse
      sprite.scale.y = baseScaleY * pulse
      if (t >= 1) {
        sprite.x = toX
        sprite.y = toY
        sprite.scale.x = baseScaleX
        sprite.scale.y = baseScaleY
        Ticker.shared.remove(tick)
        resolve()
      }
    }
    Ticker.shared.add(tick)
  })
}
