import { Ticker, type Sprite } from 'pixi.js'

const BOUNCE_MS = 220
const IMPACT_FRACTION = 0.16
const IMPACT_PX = 7
const BOUNCE_AMP_PX = 18
const BOUNCE_CYCLES = 2.0 // integer so bounce envelope lands exactly 0 at s=1
const BOUNCE_DAMPING = 2.5
const SQUASH_Y = 0.09
const SQUASH_X = 0.06
const SQUASH_DAMPING = 4

function fallProgress(t: number, landingT: number): number {
  const s = Math.min(t, landingT) / landingT
  return s * s
}

function bounceOffsetPx(s: number): number {
  if (s < IMPACT_FRACTION) {
    const u = s / IMPACT_FRACTION
    return Math.sin(Math.PI * u) * IMPACT_PX
  }
  const u = (s - IMPACT_FRACTION) / (1 - IMPACT_FRACTION)
  return (
    -Math.abs(Math.sin(BOUNCE_CYCLES * Math.PI * u)) *
    Math.exp(-BOUNCE_DAMPING * u) *
    BOUNCE_AMP_PX
  )
}

function squashEnvelope(s: number): number {
  return Math.cos(1.5 * Math.PI * s) * Math.exp(-SQUASH_DAMPING * s)
}

export function tweenDrop(
  sprite: Sprite,
  toX: number,
  toY: number,
  fallMs: number,
): Promise<void> {
  const startX = sprite.x
  const startY = sprite.y
  // Pixi may set scale != 1.0 based on texture size vs sprite dimensions
  const baseScaleX = sprite.scale.x
  const baseScaleY = sprite.scale.y
  const durationMs = fallMs + BOUNCE_MS
  const landingT = fallMs / durationMs
  let elapsed = 0
  return new Promise((resolve) => {
    const tick = (ticker: Ticker) => {
      elapsed += ticker.deltaMS
      const t = Math.min(elapsed / durationMs, 1)
      if (t < landingT) {
        const e = fallProgress(t, landingT)
        sprite.x = startX + (toX - startX) * e
        sprite.y = startY + (toY - startY) * e
        sprite.scale.x = baseScaleX
        sprite.scale.y = baseScaleY
      } else {
        const s = (t - landingT) / (1 - landingT)
        sprite.x = toX
        sprite.y = toY + bounceOffsetPx(s)
        const env = squashEnvelope(s)
        sprite.scale.x = baseScaleX * (1 + SQUASH_X * env)
        sprite.scale.y = baseScaleY * (1 - SQUASH_Y * env)
      }
      if (t >= 1) {
        // Float drift from bounce curve breaks breath animation anchor
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
