import { type Container } from 'pixi.js'
import { RGBSplitFilter, ShockwaveFilter } from 'pixi-filters'
import type { GameEvent, Pos } from '../types'
import { subscribeGameEvents } from '../core/events/emitter'
import { getFXSettings, subscribeFXSettings, type FXSettings } from '../fx/settings'

const BOARD_RGB_OFFSET = 0.7

const SHOCKWAVE_SPEED = 760
const SHOCKWAVE_WAVELENGTH = 140
const SHOCKWAVE_AMPLITUDE_BASE = 3
const SHOCKWAVE_BRIGHTNESS = 1.02
const SHOCKWAVE_RADIUS = 320
const SHOCKWAVE_DURATION_S = 0.45

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
  private cascadeLevel = 0
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
      this.cascadeRipplePending = event.level >= 1
      return
    }
    if (event.kind !== 'match-found') return

    let amp: number
    if (this.cascadeRipplePending) {
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
