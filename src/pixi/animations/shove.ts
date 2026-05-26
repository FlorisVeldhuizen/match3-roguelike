import { Ticker, type Sprite } from 'pixi.js'

const easeInOutQuad = (t: number) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

const ARC_HEIGHT_RATIO = 0.4
const ARC_HEIGHT_MAX_PX = 90
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
