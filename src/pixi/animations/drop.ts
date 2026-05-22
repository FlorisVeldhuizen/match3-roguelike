import { Ticker, type Sprite } from 'pixi.js'

// Ease-in (gravity): starts slow, accelerates. ~250ms per cell-distance unit,
// capped so longer drops feel snappy.
const easeInQuad = (t: number) => t * t

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
      const e = easeInQuad(t)
      sprite.x = startX + (toX - startX) * e
      sprite.y = startY + (toY - startY) * e
      if (t >= 1) {
        Ticker.shared.remove(tick)
        resolve()
      }
    }
    Ticker.shared.add(tick)
  })
}
