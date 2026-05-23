import {
  Application,
  Container,
  Graphics,
  Text,
  type Ticker,
} from 'pixi.js'
import type { GemColor } from '../types'

// Hex matching the CSS color palette in index.css so visuals stay coherent
// across the React DOM and the Pixi overlay.
const COLOR_HEX: Record<GemColor, number> = {
  red: 0xee5e57,
  blue: 0x4f9dff,
  green: 0x4dd581,
  yellow: 0xf5cf3a,
  purple: 0xb074ff,
}

export type ScreenPoint = { x: number; y: number }
export type Attractor = () => ScreenPoint | null


type PhysicsEffect = {
  kind: 'physics'
  view: Container
  x: number
  y: number
  vx: number
  vy: number
  gravity: number
  drag: number
  life: number
  maxLife: number
  growBy: number
  // Optional scale-over-time curve; receives progress (0 at spawn, 1 at end)
  // and returns a scale multiplier. When set, supersedes growBy. Used for
  // overshoot/settle pops on callout text.
  scaleCurve: ((progress: number) => number) | null
  fadeMode: 'linear' | 'late'
  baseScale: number
  rotation: number
  rotationTarget: number
  rotationEase: number // per-second ease factor (0 = no rotation animation)
  alphaScale: number // peak alpha (curve output is multiplied by this)
}

// Bezier-mode: particle travels a randomized quadratic curve from start to
// the (dynamically re-sampled) destination. Lands AT the destination when
// life reaches zero, then disappears. Control point is fixed at spawn so
// the curve shape stays stable; only the endpoint can drift.
//
// `view` is the bright "light source" head; `tail` is a Graphics redrawn
// each frame from the last `history` positions to produce a true streak
// fading behind the head — like a glow trail in the dark, not discrete
// stamps.
type BezierEffect = {
  kind: 'bezier'
  view: Container
  tail: Graphics
  history: ScreenPoint[]
  start: ScreenPoint
  control: ScreenPoint
  attractor: Attractor
  life: number
  maxLife: number
  colorHex: number
}

const TAIL_MAX_LENGTH = 22

type Effect = PhysicsEffect | BezierEffect

// Full-window transparent Pixi overlay used for effects that need to live
// outside the board's fixed canvas: particle bursts, gem-to-HUD trails, and
// floating text (damage numbers, cascade callouts).
export class OverlayScene {
  private app: Application | null = null
  private layer: Container | null = null
  private effects: Effect[] = []
  private tickerCb: ((ticker: Ticker) => void) | null = null
  private resizeCb: (() => void) | null = null
  private disposed = false

  async init(): Promise<void> {
    const app = new Application()
    await app.init({
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })
    if (this.disposed) {
      app.destroy(true, { children: true, texture: false })
      return
    }
    this.app = app
    const canvas = app.canvas
    canvas.style.position = 'fixed'
    canvas.style.top = '0'
    canvas.style.left = '0'
    canvas.style.width = '100vw'
    canvas.style.height = '100vh'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '5'
    document.body.appendChild(canvas)

    const layer = new Container()
    app.stage.addChild(layer)
    this.layer = layer

    this.tickerCb = (ticker) => this.tick(ticker.deltaMS)
    app.ticker.add(this.tickerCb)

    this.resizeCb = () => {
      app.renderer.resize(window.innerWidth, window.innerHeight)
    }
    window.addEventListener('resize', this.resizeCb)
  }

  destroy(): void {
    this.disposed = true
    if (this.resizeCb) window.removeEventListener('resize', this.resizeCb)
    this.resizeCb = null
    if (this.app && this.tickerCb) this.app.ticker.remove(this.tickerCb)
    this.tickerCb = null
    if (this.app) {
      const canvas = this.app.canvas
      this.app.destroy(true, { children: true, texture: false })
      if (canvas.parentElement) canvas.parentElement.removeChild(canvas)
    }
    this.app = null
    this.layer = null
    this.effects = []
  }

  // Outward radial burst at (x,y). Color accepts either a GemColor name (uses
  // the shared palette) or an explicit hex value (for one-offs like the
  // cascade pop). Opts let callers tune size/speed/life without forking the
  // method; sensible defaults match match-clear bursts.
  spawnBurst(
    at: ScreenPoint,
    colorOrHex: GemColor | number,
    opts: {
      count?: number
      speedMin?: number
      speedMax?: number
      radiusMin?: number
      radiusMax?: number
      lifeMs?: number
      gravity?: number
      spread?: number
    } = {},
  ): void {
    const layer = this.layer
    if (!layer) return
    const hex =
      typeof colorOrHex === 'number' ? colorOrHex : COLOR_HEX[colorOrHex]
    const count = opts.count ?? 10
    const speedMin = opts.speedMin ?? 90
    const speedMax = opts.speedMax ?? 180
    const radiusMin = opts.radiusMin ?? 2.5
    const radiusMax = opts.radiusMax ?? 4.5
    const baseLife = opts.lifeMs ?? 500
    const gravity = opts.gravity ?? 240
    const spread = opts.spread ?? 0.6
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * spread
      const speed = speedMin + Math.random() * (speedMax - speedMin)
      const radius = radiusMin + Math.random() * (radiusMax - radiusMin)
      const g = new Graphics().circle(0, 0, radius).fill(hex)
      g.x = at.x
      g.y = at.y
      layer.addChild(g)
      this.effects.push({
        kind: 'physics',
        view: g,
        x: at.x,
        y: at.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity,
        drag: 1.2,
        life: baseLife + Math.random() * 150,
        maxLife: baseLife + 100,
        growBy: 0,
        scaleCurve: null,
        fadeMode: 'linear',
        baseScale: 1,
        rotation: 0,
        rotationTarget: 0,
        rotationEase: 0,
        alphaScale: 1,
      })
    }
  }

  // Particle trail from (x,y) that arcs along a randomized quadratic Bezier
  // to a DOM target (the HUD pool indicator). Lands exactly on the pool when
  // life expires, then disappears. The destination is re-sampled per-frame
  // so DOM reflows (scroll, resize) don't strand particles, but the curve
  // shape is locked at spawn for stable motion.
  spawnTrail(
    from: ScreenPoint,
    attractor: Attractor,
    color: GemColor,
    count = 5,
  ): void {
    const layer = this.layer
    if (!layer) return
    // Snapshot the destination once to compute a sensible curve shape.
    // If the DOM target isn't there yet, skip the whole batch.
    const initialEnd = attractor()
    if (!initialEnd) return
    const hex = COLOR_HEX[color]
    for (let i = 0; i < count; i++) {
      const start = jitterPoint(from, 5)
      const control = randomBezierControl(start, initialEnd)
      // Head = bright light-source dot. Tail = empty Graphics, redrawn
      // every frame from position history to streak behind the head.
      // Tail is added FIRST so the head renders on top.
      const tail = new Graphics()
      tail.alpha = 0
      layer.addChild(tail)
      const head = new Graphics()
      head.circle(0, 0, 4).fill({ color: hex, alpha: 0.45 })
      head.circle(0, 0, 2.4).fill({ color: 0xffffff, alpha: 1 })
      head.x = start.x
      head.y = start.y
      head.alpha = 0
      layer.addChild(head)
      // Staggered life so the particles arrive in a tight cluster, not all
      // at the same frame.
      const life = 620 + i * 55
      this.effects.push({
        kind: 'bezier',
        view: head,
        tail,
        history: [{ x: start.x, y: start.y }],
        start,
        control,
        attractor,
        life,
        maxLife: life,
        colorHex: hex,
      })
    }
  }

  // White sparkles drifting upward — small, brief, no color. Used at
  // mid-heat levels to put a fleck of motion in the air around callout
  // text without taking over the screen.
  spawnSparkle(at: ScreenPoint, count = 5): void {
    const layer = this.layer
    if (!layer) return
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.65
      const speed = 60 + Math.random() * 90
      const radius = 1.3 + Math.random() * 1.4
      const g = new Graphics()
        .circle(0, 0, radius)
        .fill({ color: 0xffffff, alpha: 1 })
      g.x = at.x + (Math.random() - 0.5) * 40
      g.y = at.y + (Math.random() - 0.5) * 10
      layer.addChild(g)
      this.effects.push({
        kind: 'physics',
        view: g,
        x: g.x,
        y: g.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: -20,
        drag: 1.6,
        life: 380 + Math.random() * 220,
        maxLife: 500,
        growBy: -0.65,
        scaleCurve: null,
        fadeMode: 'linear',
        baseScale: 1,
        rotation: 0,
        rotationTarget: 0,
        rotationEase: 0,
        alphaScale: 0.85,
      })
    }
  }

  // Rising embers: orange/yellow particles directed mostly upward with
  // slight horizontal jitter, negative gravity (upward acceleration), and
  // a quick shrink-fade. Used as an "intensity" signal behind chained
  // cascade callouts — subtle, not a full flame loop.
  spawnFlame(at: ScreenPoint, count = 8): void {
    const layer = this.layer
    if (!layer) return
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 0.7
      const speed = 80 + Math.random() * 110
      const radius = 2 + Math.random() * 2
      const hex = Math.random() < 0.5 ? 0xff8a3c : 0xffd14a
      const g = new Graphics().circle(0, 0, radius).fill(hex)
      g.x = at.x + (Math.random() - 0.5) * 28
      g.y = at.y + (Math.random() - 0.5) * 6
      layer.addChild(g)
      this.effects.push({
        kind: 'physics',
        view: g,
        x: g.x,
        y: g.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: -60, // upward acceleration → embers keep rising
        drag: 1.4,
        life: 480 + Math.random() * 220,
        maxLife: 600,
        growBy: -0.5,
        scaleCurve: null,
        fadeMode: 'linear',
        baseScale: 1,
        rotation: 0,
        rotationTarget: 0,
        rotationEase: 0,
        alphaScale: 0.75,
      })
    }
  }

  // Shield-absorbed flash: an expanding hex ring + a few light-blue sparks
  // flying outward. Reads as "the shield held" — quick, contained, not
  // showy. Color is the same light-blue used by the block popup so the
  // visual language stays consistent across the HUD.
  spawnShieldBlock(at: ScreenPoint): void {
    const layer = this.layer
    if (!layer) return
    const hex = 0xa8c8ff

    // Expanding hex ring: outline only, grows ~1.0 → 2.2 while fading.
    const ring = new Graphics()
    const r = 24
    for (let i = 0; i <= 6; i++) {
      const a = (Math.PI * 2 * i) / 6 - Math.PI / 2
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r
      if (i === 0) ring.moveTo(x, y)
      else ring.lineTo(x, y)
    }
    ring.stroke({ color: hex, width: 2.5, alpha: 1, join: 'round' })
    ring.x = at.x
    ring.y = at.y
    layer.addChild(ring)
    this.effects.push({
      kind: 'physics',
      view: ring,
      x: at.x,
      y: at.y,
      vx: 0,
      vy: 0,
      gravity: 0,
      drag: 0,
      life: 320,
      maxLife: 320,
      growBy: 0,
      // Quick outward expansion, then settles. Progress is 0→1 over life.
      scaleCurve: (p) => 1 + p * 1.3,
      fadeMode: 'linear',
      baseScale: 1,
      rotation: 0,
      rotationTarget: 0,
      rotationEase: 0,
      alphaScale: 0.9,
    })

    // 5 small radial sparks — short life, no gravity, fade fast.
    const sparkCount = 5
    for (let i = 0; i < sparkCount; i++) {
      const angle =
        (Math.PI * 2 * i) / sparkCount + (Math.random() - 0.5) * 0.4
      const speed = 110 + Math.random() * 60
      const g = new Graphics()
        .circle(0, 0, 1.6 + Math.random() * 1.2)
        .fill({ color: 0xeaf4ff, alpha: 1 })
      g.x = at.x
      g.y = at.y
      layer.addChild(g)
      this.effects.push({
        kind: 'physics',
        view: g,
        x: at.x,
        y: at.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 0,
        drag: 2.2,
        life: 260 + Math.random() * 80,
        maxLife: 320,
        growBy: -0.6,
        scaleCurve: null,
        fadeMode: 'linear',
        baseScale: 1,
        rotation: 0,
        rotationTarget: 0,
        rotationEase: 0,
        alphaScale: 1,
      })
    }
  }

  // Shield-broken shatter: a dimmer, larger ring flash plus 10 angular
  // shards flying outward with gravity and rotation. Reads as "the shield
  // gave way" — more chaotic and longer-lived than the block effect, with
  // shards falling away.
  spawnShieldBreak(at: ScreenPoint): void {
    const layer = this.layer
    if (!layer) return
    const hex = 0xd6ebff

    // Broken hex ring: half-arcs offset slightly so the ring looks fractured.
    const ring = new Graphics()
    const r = 28
    // Two arcs with a gap — gives the "split" look without per-segment work.
    const arcs: [number, number][] = [
      [-Math.PI * 0.85, Math.PI * 0.1],
      [Math.PI * 0.25, Math.PI * 0.95],
    ]
    for (const [start, end] of arcs) {
      ring.moveTo(Math.cos(start) * r, Math.sin(start) * r)
      const segments = 10
      for (let i = 1; i <= segments; i++) {
        const a = start + ((end - start) * i) / segments
        ring.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      }
    }
    ring.stroke({ color: hex, width: 2.5, alpha: 1, join: 'round' })
    ring.x = at.x
    ring.y = at.y
    layer.addChild(ring)
    this.effects.push({
      kind: 'physics',
      view: ring,
      x: at.x,
      y: at.y,
      vx: 0,
      vy: 0,
      gravity: 0,
      drag: 0,
      life: 360,
      maxLife: 360,
      growBy: 0,
      scaleCurve: (p) => 1 + p * 1.5,
      fadeMode: 'linear',
      baseScale: 1,
      rotation: 0,
      rotationTarget: 0,
      rotationEase: 0,
      alphaScale: 0.75,
    })

    // 10 shards: small elongated rectangles that fly out and tumble.
    const shardCount = 10
    for (let i = 0; i < shardCount; i++) {
      const angle =
        (Math.PI * 2 * i) / shardCount + (Math.random() - 0.5) * 0.5
      const speed = 140 + Math.random() * 110
      const len = 5 + Math.random() * 4
      const width = 1.6 + Math.random() * 0.8
      const g = new Graphics()
        .rect(-len / 2, -width / 2, len, width)
        .fill({ color: 0xeaf4ff, alpha: 1 })
      g.x = at.x
      g.y = at.y
      g.rotation = angle
      layer.addChild(g)
      this.effects.push({
        kind: 'physics',
        view: g,
        x: at.x,
        y: at.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        gravity: 380,
        drag: 0.9,
        life: 520 + Math.random() * 180,
        maxLife: 700,
        growBy: 0,
        scaleCurve: null,
        fadeMode: 'linear',
        baseScale: 1,
        rotation: angle,
        // Tumble target — pick something past the spawn angle so easing
        // produces visible rotation throughout the life.
        rotationTarget: angle + (Math.random() < 0.5 ? -1 : 1) * Math.PI * 1.8,
        rotationEase: 1.4,
        alphaScale: 1,
      })
    }
  }

  // Floating text (damage popup, cascade callout, etc).
  // rotationFrom/rotationTo (radians) animate the text rotation over its life.
  // rotationEase controls how fast it settles (per-second factor); 0 disables
  // animation and the text holds at rotationFrom.
  spawnFloatingText(
    at: ScreenPoint,
    text: string,
    opts: {
      color?: number
      fontSize?: number
      lifeMs?: number
      driftY?: number
      growBy?: number
      // When provided, supersedes growBy. Lets callers script a custom
      // scale curve over the life — e.g. overshoot-and-settle pop for
      // cascade callouts.
      scaleCurve?: (progress: number) => number
      rotationFrom?: number
      rotationTo?: number
      rotationEase?: number
    } = {},
  ): void {
    const layer = this.layer
    if (!layer) return
    const t = new Text({
      text,
      style: {
        // Paytone One — heavy rounded display, won an A/B against ~34
        // other display fonts (Russo One, Bowlby One, Sansita Black,
        // Anton, Mochiy Pop One, etc). Best short-text legibility for
        // the floating ×N / POW! / BOOM! / damage-number popups.
        fontFamily: '"Paytone One", "Helvetica Neue", Arial, sans-serif',
        fontSize: opts.fontSize ?? 26,
        fontWeight: '400',
        letterSpacing: 1,
        fill: opts.color ?? 0xffffff,
        // Thin dark edge for definition against bright gems + a soft
        // diffuse halo (distance 0, no offset) for legibility. Avoids the
        // tacky "drop shadow under the text" stamp effect — the Anton
        // typeface itself is heavy enough to carry the impact.
        stroke: {
          color: 0x000000,
          width: 2,
          alpha: 0.85,
          join: 'round',
        },
        dropShadow: {
          color: 0x000000,
          alpha: 0.6,
          blur: 8,
          distance: 0,
          angle: 0,
        },
      },
    })
    t.anchor.set(0.5)
    t.x = at.x
    t.y = at.y
    const rotation = opts.rotationFrom ?? 0
    t.rotation = rotation
    layer.addChild(t)
    const life = opts.lifeMs ?? 750
    this.effects.push({
      kind: 'physics',
      view: t,
      x: at.x,
      y: at.y,
      vx: 0,
      vy: opts.driftY ?? -65,
      gravity: 0,
      drag: 1,
      life,
      maxLife: life,
      growBy: opts.growBy ?? 0,
      scaleCurve: opts.scaleCurve ?? null,
      fadeMode: 'late',
      baseScale: 1,
      rotation,
      rotationTarget: opts.rotationTo ?? 0,
      rotationEase: opts.rotationEase ?? 0,
      alphaScale: 1,
    })
  }

  private tick(dtMs: number): void {
    const dt = dtMs / 1000
    const layer = this.layer
    if (!layer) return
    const survivors: Effect[] = []
    for (const e of this.effects) {
      e.life -= dtMs
      if (e.life <= 0) {
        layer.removeChild(e.view)
        e.view.destroy()
        if (e.kind === 'bezier') {
          layer.removeChild(e.tail)
          e.tail.destroy()
        }
        continue
      }
      if (e.kind === 'physics') {
        e.vy += e.gravity * dt
        const dragFactor = Math.max(0, 1 - e.drag * dt)
        e.vx *= dragFactor
        e.vy *= dragFactor
        e.x += e.vx * dt
        e.y += e.vy * dt
        e.view.x = e.x
        e.view.y = e.y
        const t = e.life / e.maxLife
        const curveAlpha =
          e.fadeMode === 'late' ? Math.min(1, t * 3) : Math.max(0, t)
        e.view.alpha = curveAlpha * e.alphaScale
        if (e.scaleCurve) {
          e.view.scale.set(e.baseScale * e.scaleCurve(1 - t))
        } else if (e.growBy !== 0) {
          const scale = e.baseScale + (1 - t) * e.growBy
          e.view.scale.set(scale)
        }
        if (e.rotationEase > 0) {
          const k = Math.min(1, e.rotationEase * dt)
          e.rotation += (e.rotationTarget - e.rotation) * k
          e.view.rotation = e.rotation
        }
      } else {
        const end = e.attractor()
        const progress = 1 - e.life / e.maxLife // 0 → 1
        let curX = e.view.x
        let curY = e.view.y
        if (end) {
          const u = 1 - progress
          curX =
            u * u * e.start.x +
            2 * u * progress * e.control.x +
            progress * progress * end.x
          curY =
            u * u * e.start.y +
            2 * u * progress * e.control.y +
            progress * progress * end.y
          e.view.x = curX
          e.view.y = curY
        }
        // Fade in over first 15%, hold, brief fade-out over last 10% so the
        // disappearance lands cleanly on the pool indicator.
        const fadeIn = 0.15
        const fadeOut = 0.9
        const alpha =
          progress < fadeIn
            ? progress / fadeIn
            : progress > fadeOut
              ? Math.max(0, 1 - (progress - fadeOut) / (1 - fadeOut))
              : 1
        e.view.alpha = alpha
        // Record current position into history and redraw the tail as a
        // fading polyline from oldest to newest. Width and per-segment
        // alpha both ramp up toward the head so it reads as a streak of
        // light, not equal-weight dashes.
        e.history.push({ x: curX, y: curY })
        if (e.history.length > TAIL_MAX_LENGTH) e.history.shift()
        const hist = e.history
        e.tail.clear()
        if (hist.length >= 2) {
          for (let i = 0; i < hist.length - 1; i++) {
            const localT = (i + 1) / hist.length // 0 (oldest) → 1 (newest)
            const segAlpha = localT * localT * 0.85 * alpha
            const width = 1 + localT * 4.5
            const p0 = hist[i]
            const p1 = hist[i + 1]
            if (!p0 || !p1) continue
            e.tail
              .moveTo(p0.x, p0.y)
              .lineTo(p1.x, p1.y)
              .stroke({
                color: e.colorHex,
                alpha: segAlpha,
                width,
                cap: 'round',
                join: 'round',
              })
          }
          e.tail.alpha = 1
        }
      }
      survivors.push(e)
    }
    this.effects = survivors
  }
}

// Coord helpers — both return screen-space (viewport) coordinates, matching
// the overlay canvas's coordinate system.
export function elementCenter(el: HTMLElement): ScreenPoint | null {
  const rect = el.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

function jitterPoint(p: ScreenPoint, magnitude: number): ScreenPoint {
  const angle = Math.random() * Math.PI * 2
  return {
    x: p.x + Math.cos(angle) * magnitude,
    y: p.y + Math.sin(angle) * magnitude,
  }
}

// Pick a Bezier control point perpendicular to the start→end axis, with a
// randomized side and magnitude so curves bow left or right and apex earlier
// or later along the path. Magnitude scales with travel distance so short
// trails curve subtly and long trails arc more.
function randomBezierControl(
  start: ScreenPoint,
  end: ScreenPoint,
): ScreenPoint {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  // Perpendicular offset: random sign, 15-55% of travel distance.
  const sign = Math.random() < 0.5 ? -1 : 1
  const perpMag = len * (0.15 + Math.random() * 0.4) * sign
  // Along-axis offset: shift apex away from midpoint so curves don't all
  // peak at the same arc-length.
  const alongShift = (Math.random() - 0.5) * 0.4
  const midX = (start.x + end.x) / 2 + dx * alongShift
  const midY = (start.y + end.y) / 2 + dy * alongShift
  return {
    x: midX + nx * perpMag,
    y: midY + ny * perpMag,
  }
}
