import { Ticker, type Sprite } from 'pixi.js'

const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t)

export function tweenSwap(a: Sprite, b: Sprite, durationMs = 200): Promise<void> {
  const aStart = { x: a.x, y: a.y }
  const bStart = { x: b.x, y: b.y }
  let elapsed = 0
  return new Promise((resolve) => {
    const tick = (ticker: Ticker) => {
      elapsed += ticker.deltaMS
      const t = Math.min(elapsed / durationMs, 1)
      const e = easeOutQuad(t)
      a.x = aStart.x + (bStart.x - aStart.x) * e
      a.y = aStart.y + (bStart.y - aStart.y) * e
      b.x = bStart.x + (aStart.x - bStart.x) * e
      b.y = bStart.y + (aStart.y - bStart.y) * e
      if (t >= 1) {
        Ticker.shared.remove(tick)
        resolve()
      }
    }
    Ticker.shared.add(tick)
  })
}
