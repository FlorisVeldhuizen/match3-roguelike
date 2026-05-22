import { Ticker, type Sprite } from 'pixi.js'

// Flash white then fade + shrink. ~280ms. Resolves once the sprite is gone.
export function tweenClear(sprite: Sprite, durationMs = 280): Promise<void> {
  const startScale = sprite.scale.x
  const startAlpha = sprite.alpha
  const startTint = sprite.tint
  let elapsed = 0
  return new Promise((resolve) => {
    const tick = (ticker: Ticker) => {
      elapsed += ticker.deltaMS
      const t = Math.min(elapsed / durationMs, 1)
      // First 30%: flash bright (lerp tint toward white).
      const flashT = Math.min(t / 0.3, 1)
      if (flashT < 1) {
        // 0xffffff is white; we lerp from startTint to white then back is unnecessary —
        // hold white through fade. Pixi tint multiplies so 0xffffff = no change.
        sprite.tint = 0xffffff
      } else {
        sprite.tint = startTint
      }
      // Whole duration: shrink to 30% and fade to 0.
      const e = t * t
      sprite.scale.set(startScale * (1 - 0.7 * e))
      sprite.alpha = startAlpha * (1 - e)
      if (t >= 1) {
        Ticker.shared.remove(tick)
        resolve()
      }
    }
    Ticker.shared.add(tick)
  })
}
