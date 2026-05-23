import { Ticker, type Sprite } from 'pixi.js'

// Fall curve: accelerating fall (gravity feel), then a damped positional
// bounce + squash-and-stretch on impact for the Puzzle-Quest landing
// "thump." Hover suppresses scale during animations, so the squash here
// doesn't fight any other system.
//
// The fall portion duration is set by the caller (proportional to drop
// distance, so far-falling gems take longer and a column of gems lands in
// cascade). BOUNCE_MS is the fixed wall-clock window appended after the
// fall — every gem gets the full impact-and-rebound beat regardless of
// how far it fell.
const BOUNCE_MS = 220
// Positional response on landing has two phases, in order:
//   1. Impact: a brief sub-target dip (gem compresses past the floor) —
//      the old "overshoot," kept because it sells the moment of contact.
//   2. Rebound: damped |sin| arcs above target — the actual bouncing.
// Amplitudes are in absolute pixels (not a fraction of fall distance) so a
// top-row 512px drop doesn't dip 25px while a 1-cell drop dips 3px — the
// impact is the same regardless of how far the gem fell.
const IMPACT_FRACTION = 0.16 // share of bounce window taken by the dip
const IMPACT_PX = 7 // peak penetration below target
const BOUNCE_AMP_PX = 18 // peak rebound height above target (~9.6px after damping)
const BOUNCE_CYCLES = 2.0 // integer → bounce envelope is 0 at s=1 (clean settle)
const BOUNCE_DAMPING = 2.5 // exp decay rate; second bounce ≈ 28% of first
// Per-axis squash strength as a fraction of the resting scale. Vertical is
// larger because the gem is falling — flattening on impact reads more than
// horizontal widening. Numbers stay sub-perceptual on the non-squashed
// axis while giving a clear "weight" beat on the squashed one.
const SQUASH_Y = 0.09
const SQUASH_X = 0.06
// Squash decay is faster than positional bounce so the gem reaches roughly
// neutral scale by the first bounce apex (s≈0.25) — a still-squashed gem
// at peak height looks physically wrong.
const SQUASH_DAMPING = 4

function fallProgress(t: number, landingT: number): number {
  // Quadratic ease-in over [0, landingT]. Reaches exactly 1 at t=landingT.
  const s = Math.min(t, landingT) / landingT
  return s * s
}

// Returns a y-offset in pixels (positive = below target, negative = above
// in Pixi y-down space) over the bounce window s∈[0,1]. Two phases in
// series:
//   s=0           →  0       (touching down)
//   s=IF/2        → +7 px    (impact dip — gem compressed below floor)
//   s=IF          →  0       (rises back through target)
//   s=IF+0.21     → -9.6 px  (first rebound apex)
//   s=IF+0.42     →  0       (second touchdown)
//   s=IF+0.62     → -2.7 px  (second rebound apex, ~28% of first)
//   s=1           →  0       (settled)
// where IF = IMPACT_FRACTION. Continuity: both pieces are 0 at the seam.
function bounceOffsetPx(s: number): number {
  if (s < IMPACT_FRACTION) {
    // Half-sine 0 → +peak → 0 over the impact window.
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

// Damped cosine — full cycle over the bounce window:
//   s=0      → +1     (impact: full squash)
//   s≈0.33   →  0     (neutral — coincides with first bounce apex)
//   s≈0.67   →  small (stretch lobe, decayed)
//   s=1      →  0     (settled)
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
  // Resting scale is set via sprite.width/height (which Pixi converts to
  // scale.x/y based on the texture's native size), so we can't assume 1.0.
  const baseScaleX = sprite.scale.x
  const baseScaleY = sprite.scale.y
  // Bounce is appended after the fall, so total = fall + bounce. Landing
  // (transition fall → bounce) sits exactly at fallMs.
  const durationMs = fallMs + BOUNCE_MS
  const landingT = fallMs / durationMs
  let elapsed = 0
  return new Promise((resolve) => {
    const tick = (ticker: Ticker) => {
      elapsed += ticker.deltaMS
      const t = Math.min(elapsed / durationMs, 1)
      if (t < landingT) {
        // Fall phase — straight interpolation along the gravity curve, no
        // squash. Gem reads as a rigid falling object.
        const e = fallProgress(t, landingT)
        sprite.x = startX + (toX - startX) * e
        sprite.y = startY + (toY - startY) * e
        sprite.scale.x = baseScaleX
        sprite.scale.y = baseScaleY
      } else {
        // Landed. Sprite sits at the target, with an additional damped
        // y-offset (the bounce) and a squash multiplier on scale. The
        // bounce is y-only because tweenDrop is exclusively vertical;
        // tweenSwap handles horizontal motion.
        const s = (t - landingT) / (1 - landingT)
        sprite.x = toX
        sprite.y = toY + bounceOffsetPx(s)
        const env = squashEnvelope(s)
        sprite.scale.x = baseScaleX * (1 + SQUASH_X * env)
        sprite.scale.y = baseScaleY * (1 - SQUASH_Y * env)
      }
      if (t >= 1) {
        // Pin to exact target + base scale on completion so floating-point
        // drift from the bounce curve doesn't leave the sprite sub-pixel
        // offset (the breath tickFloat re-anchor relies on this).
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
