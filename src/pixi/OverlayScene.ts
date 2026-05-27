import {
  Application,
  Container,
  Graphics,
  Text,
  type Ticker,
} from 'pixi.js'
import { RGBSplitFilter } from 'pixi-filters'
import type { GemColor, TrailPurpose } from '../types'
import { getFXSettings, subscribeFXSettings } from '../fx/settings'
import {
  TRAIL_ARRIVAL_MS,
  TRAIL_PARTICLE_STAGGER_MS,
  trailBurstArrivalMs,
  trailDurationBetween,
} from '../timing'

const COLOR_HEX: Record<GemColor, number> = {
  red: 0xee5e57,
  blue: 0x4f9dff,
  green: 0x4dd581,
  yellow: 0xf5cf3a,
  purple: 0xb074ff,
  gold: 0xffc94a,
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
  scaleCurve: ((progress: number) => number) | null
  fadeMode: 'linear' | 'late'
  baseScale: number
  rotation: number
  rotationTarget: number
  rotationEase: number
  alphaScale: number
}

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

let reducedMotion = false
try {
  const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion = mql.matches
  mql.addEventListener('change', (ev) => {
    reducedMotion = ev.matches
  })
} catch {
  // matchMedia unavailable (SSR / older browsers)
}

const OVERLAY_RGB_OFFSET = 1.0

export class OverlayScene {
  private app: Application | null = null
  private layer: Container | null = null
  private textLayerChromatic: Container | null = null
  private textLayerCrisp: Container | null = null
  private effects: Effect[] = []
  private tickerCb: ((ticker: Ticker) => void) | null = null
  private resizeCb: (() => void) | null = null
  private disposed = false
  private rgbFilter: RGBSplitFilter | null = null
  private unsubscribeFX: (() => void) | null = null

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
    // dvh avoids iOS Safari URL-bar mismatch with innerHeight
    canvas.style.height = '100dvh'
    canvas.style.pointerEvents = 'none'
    canvas.style.zIndex = '5'
    document.body.appendChild(canvas)

    const layer = new Container()
    app.stage.addChild(layer)
    this.layer = layer

    const textLayerCrisp = new Container()
    layer.addChild(textLayerCrisp)
    this.textLayerCrisp = textLayerCrisp

    const textLayerChromatic = new Container()
    layer.addChild(textLayerChromatic)
    this.textLayerChromatic = textLayerChromatic

    const rgbFilter = new RGBSplitFilter({
      red: { x: -OVERLAY_RGB_OFFSET, y: 0 },
      green: { x: 0, y: 0 },
      blue: { x: OVERLAY_RGB_OFFSET, y: 0 },
    })
    rgbFilter.enabled = getFXSettings().rgbSplit
    textLayerChromatic.filters = [rgbFilter]
    this.rgbFilter = rgbFilter
    this.unsubscribeFX = subscribeFXSettings((s) => {
      if (this.rgbFilter) this.rgbFilter.enabled = s.rgbSplit
    })

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
    this.unsubscribeFX?.()
    this.unsubscribeFX = null
    if (this.app) {
      const canvas = this.app.canvas
      this.app.destroy(true, { children: true, texture: false })
      if (canvas.parentElement) canvas.parentElement.removeChild(canvas)
    }
    this.rgbFilter = null
    this.app = null
    this.layer = null
    this.textLayerChromatic = null
    this.textLayerCrisp = null
    this.effects = []
  }

  clearAll(): void {
    for (const e of this.effects) {
      e.view.destroy({ children: true })
      if (e.kind === 'bezier') e.tail.destroy({ children: true })
    }
    this.effects = []
  }

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
    const rawCount = opts.count ?? 10
    const count = reducedMotion ? Math.max(3, Math.floor(rawCount * 0.25)) : rawCount
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

  spawnTrail(
    from: ScreenPoint,
    attractor: Attractor,
    colorOrHex: GemColor | number | readonly number[],
    count = 5,
    innerHex = 0xffffff,
    opts?: { durationMs?: number; purpose?: TrailPurpose },
  ): number {
    if (reducedMotion) return TRAIL_ARRIVAL_MS
    const layer = this.layer
    if (!layer) return TRAIL_ARRIVAL_MS
    const initialEnd = attractor()
    if (!initialEnd) return TRAIL_ARRIVAL_MS
    const palette: readonly number[] = Array.isArray(colorOrHex)
      ? colorOrHex
      : [
          typeof colorOrHex === 'number'
            ? colorOrHex
            : COLOR_HEX[colorOrHex as GemColor],
        ]
    const pick = (): number => {
      const idx = Math.floor(Math.random() * palette.length)
      return palette[idx] ?? palette[0] ?? 0xffffff
    }
    const lifeBase =
      opts?.durationMs ??
      trailDurationBetween(from, initialEnd, opts?.purpose)
    const arrivalMs = trailBurstArrivalMs(lifeBase, count)
    for (let i = 0; i < count; i++) {
      const start = jitterPoint(from, 5)
      const control = randomBezierControl(start, initialEnd)
      const hex = pick()
      const tail = new Graphics()
      tail.alpha = 0
      layer.addChild(tail)
      const head = new Graphics()
      head.circle(0, 0, 4).fill({ color: hex, alpha: 0.45 })
      head.circle(0, 0, 2.4).fill({ color: innerHex, alpha: 1 })
      head.x = start.x
      head.y = start.y
      head.alpha = 0
      layer.addChild(head)
      const life = lifeBase + i * TRAIL_PARTICLE_STAGGER_MS
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
    return arrivalMs
  }

  spawnSparkle(at: ScreenPoint, count = 5): void {
    const layer = this.layer
    if (!layer) return
    if (reducedMotion) return
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

  spawnFlame(at: ScreenPoint, count = 8): void {
    const layer = this.layer
    if (!layer) return
    if (reducedMotion) return
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
        gravity: -60,
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

  spawnShieldBlock(at: ScreenPoint): void {
    const layer = this.layer
    if (!layer) return
    const hex = 0xa8c8ff

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
      scaleCurve: (p) => 1 + p * 1.3,
      fadeMode: 'linear',
      baseScale: 1,
      rotation: 0,
      rotationTarget: 0,
      rotationEase: 0,
      alphaScale: 0.9,
    })

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

  spawnShieldBreak(at: ScreenPoint): void {
    const layer = this.layer
    if (!layer) return
    const hex = 0xd6ebff

    const ring = new Graphics()
    const r = 28
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
        rotationTarget: angle + (Math.random() < 0.5 ? -1 : 1) * Math.PI * 1.8,
        rotationEase: 1.4,
        alphaScale: 1,
      })
    }
  }

  spawnFloatingText(
    at: ScreenPoint,
    text: string,
    opts: {
      color?: number
      fontSize?: number
      lifeMs?: number
      driftY?: number
      growBy?: number
      scaleCurve?: (progress: number) => number
      rotationFrom?: number
      rotationTo?: number
      rotationEase?: number
      chromatic?: boolean
    } = {},
  ): void {
    const layer = opts.chromatic
      ? this.textLayerChromatic
      : this.textLayerCrisp
    if (!layer) return
    const t = new Text({
      text,
      style: {
        fontFamily: '"Paytone One", "Helvetica Neue", Arial, sans-serif',
        fontSize: opts.fontSize ?? 26,
        fontWeight: '400',
        letterSpacing: 1,
        fill: opts.color ?? 0xffffff,
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
    // Two-pointer compaction avoids allocating a survivors array each frame
    const effects = this.effects
    let writeIdx = 0
    for (let readIdx = 0; readIdx < effects.length; readIdx++) {
      const e = effects[readIdx]
      if (!e) continue
      const nextLife = e.life - dtMs
      if (nextLife <= 0) {
        layer.removeChild(e.view)
        e.view.destroy()
        if (e.kind === 'bezier') {
          layer.removeChild(e.tail)
          e.tail.destroy()
        }
        continue
      }
      if (e.kind === 'physics') {
        e.life = nextLife
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
        const progress = Math.min(1, 1 - Math.max(0, nextLife) / e.maxLife)
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
        const fadeIn = 0.15
        const fadeOut = 0.98
        const alpha =
          progress < fadeIn
            ? progress / fadeIn
            : progress > fadeOut
              ? Math.max(0, 1 - (progress - fadeOut) / (1 - fadeOut))
              : 1
        e.view.alpha = alpha
        e.history.push({ x: curX, y: curY })
        if (e.history.length > TAIL_MAX_LENGTH) e.history.shift()
        const hist = e.history
        e.tail.clear()
        if (hist.length >= 2) {
          for (let i = 0; i < hist.length - 1; i++) {
            const localT = (i + 1) / hist.length
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
        e.life = nextLife
      }
      if (writeIdx !== readIdx) effects[writeIdx] = e
      writeIdx++
    }
    effects.length = writeIdx
  }
}

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

function randomBezierControl(
  start: ScreenPoint,
  end: ScreenPoint,
): ScreenPoint {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const sign = Math.random() < 0.5 ? -1 : 1
  const perpMag = len * (0.15 + Math.random() * 0.4) * sign
  const alongShift = (Math.random() - 0.5) * 0.4
  const midX = (start.x + end.x) / 2 + dx * alongShift
  const midY = (start.y + end.y) / 2 + dy * alongShift
  return {
    x: midX + nx * perpMag,
    y: midY + ny * perpMag,
  }
}
