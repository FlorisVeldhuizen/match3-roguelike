import { type Container } from 'pixi.js'
import { RGBSplitFilter, ShockwaveFilter } from 'pixi-filters'
import type { GameEvent, Pos } from '../types'
import { subscribeGameEvents } from '../core/events/emitter'
import { getFXSettings, subscribeFXSettings, type FXSettings } from '../fx/settings'

// Board-stage post-processing:
//   - persistent sub-pixel RGB split for chromatic refraction on every
//     gem edge (this used to be a screen-wide SVG filter, but the SVG
//     approach broke pointer hit-testing; pixi keeps it GPU-local and
//     cursor-safe)
//   - transient shockwave anchored at the match centroid that triggered
//     it.
// Other effects we explored (bloom, fisheye, full-stage CRT) are gone:
// bloom rejected for being sci-fi, fisheye couldn't be done cleanly
// without breaking hit-testing. RGB split also runs on the popup text
// layer in OverlayScene at a slightly higher offset.

// Baseline RGB split on the board stage — barely-there sub-pixel
// refraction on gem silhouettes. Stays static; the popup text layer
// in OverlayScene runs a slightly higher offset for accent on the
// floating callouts.
const BOARD_RGB_OFFSET = 0.7

// Single shockwave at a time — board is small; multiple ripples just
// overlap into mush. New triggers re-arm the same filter.
// Tuned to read as a heat-shimmer pass, not a blast wave: long wavelength,
// fast travel, low amplitude.
const SHOCKWAVE_SPEED = 760
const SHOCKWAVE_WAVELENGTH = 140
const SHOCKWAVE_AMPLITUDE_BASE = 3
const SHOCKWAVE_BRIGHTNESS = 1.02
const SHOCKWAVE_RADIUS = 320
const SHOCKWAVE_DURATION_S = 0.45

// Translates logical board cell into stage-local pixel coords. The filter
// center is read in the stage's coordinate space (filter target = stage),
// so we need the same `BOARD_PADDING + cellCenter(x,y)` math BoardScene
// uses for sprite placement.
export type CellToStage = (pos: Pos) => { x: number; y: number } | null

export class BoardEffects {
  private readonly stage: Container
  private readonly cellToStage: CellToStage
  private readonly rgbSplit: RGBSplitFilter
  private readonly shockwave: ShockwaveFilter
  private unsubscribe: (() => void) | null = null
  private unsubscribeFX: (() => void) | null = null

  private shockwaveTime = -1
  private shockwaveAllowed = true
  // Current cascade depth; level 0 = the player's initial swap result,
  // level 1+ = chain links. Updated by cascade-start events.
  private cascadeLevel = 0
  // Set true on a cascade-start at level ≥ 1, consumed by the next
  // match-found so the ripple anchors at the actual match site rather
  // than board centre. Cleared as soon as a single match in that link
  // fires the ripple.
  private cascadeRipplePending = false
  private readonly reducedMotion: boolean

  constructor(stage: Container, cellToStage: CellToStage) {
    this.stage = stage
    this.cellToStage = cellToStage
    this.reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches

    this.rgbSplit = new RGBSplitFilter({
      red: { x: -BOARD_RGB_OFFSET, y: 0 },
      green: { x: 0, y: 0 },
      blue: { x: BOARD_RGB_OFFSET, y: 0 },
    })

    this.shockwave = new ShockwaveFilter({
      center: { x: 0, y: 0 },
      speed: SHOCKWAVE_SPEED,
      amplitude: SHOCKWAVE_AMPLITUDE_BASE,
      wavelength: SHOCKWAVE_WAVELENGTH,
      brightness: SHOCKWAVE_BRIGHTNESS,
      radius: SHOCKWAVE_RADIUS,
      time: 0,
    })
    this.shockwave.enabled = false

    // RGB split first (chromatic refraction on the raw frame), then
    // shockwave warps the composited image.
    stage.filters = [this.rgbSplit, this.shockwave]

    this.applyFXSettings(getFXSettings())
    this.unsubscribeFX = subscribeFXSettings((s) => this.applyFXSettings(s))
    this.unsubscribe = subscribeGameEvents((event) => this.onGameEvent(event))
  }

  destroy(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.unsubscribeFX?.()
    this.unsubscribeFX = null
    this.stage.filters = []
    this.rgbSplit.destroy()
    this.shockwave.destroy()
  }

  private applyFXSettings(s: FXSettings): void {
    this.rgbSplit.enabled = s.rgbSplit
    if (!s.shockwave) this.shockwave.enabled = false
    this.shockwaveAllowed = s.shockwave
  }

  // Driven from the same effects ticker BoardScene already runs.
  tick(dtMs: number): void {
    if (!this.shockwave.enabled) return
    const dt = Math.min(dtMs / 1000, 1 / 30)
    this.shockwaveTime += dt
    this.shockwave.time = this.shockwaveTime
    if (this.shockwaveTime > SHOCKWAVE_DURATION_S) {
      this.shockwave.enabled = false
      this.shockwaveTime = -1
    }
  }

  // Triggers a single shockwave centered at a stage-local point. Re-arms
  // the filter if one is already in flight (rare — most cascades pace
  // themselves slower than SHOCKWAVE_DURATION_S).
  fireShockwave(center: { x: number; y: number }, amplitude: number): void {
    if (this.reducedMotion) return
    if (!this.shockwaveAllowed) return
    this.shockwave.center = { x: center.x, y: center.y }
    this.shockwave.amplitude = amplitude
    this.shockwaveTime = 0
    this.shockwave.time = 0
    this.shockwave.enabled = true
  }

  private onGameEvent(event: GameEvent): void {
    if (event.kind === 'cascade-start') {
      this.cascadeLevel = event.level
      // Arm a single ripple per chain link (level ≥ 1); level 0 is the
      // initial swap and doesn't ripple on its own.
      this.cascadeRipplePending = event.level >= 1
      return
    }
    if (event.kind !== 'match-found') return

    // Two ripple triggers:
    //   1. Cascade link's first match — fires once per chain link, with
    //      amplitude growing with depth. This is the "chain reaction"
    //      celebration the user wanted preserved.
    //   2. 5+ matches outside a chain — rare enough to stay special.
    // Plain 4-matches don't ripple anymore: they happen often enough that
    // a ripple per match felt constant.
    let amp: number
    if (this.cascadeRipplePending) {
      // Starts as a whisper on the first chain link (~1.5) and ramps up
      // dramatically with depth so a deep cascade visibly accelerates.
      // Capped at level 7 to avoid blown-out ripples on pathological
      // chains.
      amp = 1.5 + Math.min(6, this.cascadeLevel - 1) * 1.6
      this.cascadeRipplePending = false
    } else if (event.size >= 5) {
      amp = 4
    } else {
      return
    }

    let sx = 0
    let sy = 0
    let n = 0
    for (const c of event.cells) {
      const p = this.cellToStage(c)
      if (!p) continue
      sx += p.x
      sy += p.y
      n++
    }
    if (n === 0) return
    this.fireShockwave({ x: sx / n, y: sy / n }, amp)
  }
}
