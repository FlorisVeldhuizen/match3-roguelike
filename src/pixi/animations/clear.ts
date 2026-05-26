import { Ticker, type Sprite } from 'pixi.js'

export function tweenClear(sprite: Sprite, durationMs = 280): Promise<void> {
  const startScale = sprite.scale.x
  const startAlpha = sprite.alpha
  const startTint = sprite.tint
  const POP_END = 0.18
  const POP_PEAK = 1.25
  let elapsed = 0
  return new Promise((resolve) => {
    const tick = (ticker: Ticker) => {
      elapsed += ticker.deltaMS
      const t = Math.min(elapsed / durationMs, 1)
      if (t < POP_END) {
        const u = t / POP_END
        const scale = startScale * (1 + (POP_PEAK - 1) * u)
        sprite.scale.set(scale)
        sprite.tint = 0xffffff
        sprite.alpha = startAlpha
      } else {
        const u = (t - POP_END) / (1 - POP_END)
        const eased = u * u
        const scale = startScale * POP_PEAK * (1 - eased)
        sprite.scale.set(scale)
        sprite.alpha = startAlpha * (1 - eased)
        // Hold white through fade; tint multiply on alpha 0 is invisible anyway.
        sprite.tint = 0xffffff
      }
      if (t >= 1) {
        sprite.tint = startTint
        Ticker.shared.remove(tick)
        resolve()
      }
    }
    Ticker.shared.add(tick)
  })
}
