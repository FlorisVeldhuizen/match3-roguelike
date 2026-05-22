import { Sprite, type Container, type Texture } from 'pixi.js'
import type { GameEvent, GemColor, MatchShape, Pos } from '../types'
import { tweenSwap } from './animations/swap'
import { tweenClear } from './animations/clear'
import { tweenDrop } from './animations/drop'
import { emitGameEvent } from '../core/events/emitter'
import {
  elementCenter,
  type Attractor,
  type OverlayScene,
} from './OverlayScene'

// Per-cell visual timings.
const SWAP_MS = 200
const CLEAR_MS = 280
const DROP_PER_CELL_MS = 80
const DROP_MIN_MS = 150
const HIT_STOP_MS = 80 // pause-frames on 4+ matches before clear plays

// Combat beat pacing — each event gets its own breath so the player can read
// what's happening. Tuned to feel snappy but distinct; Spacebar fast-forward
// (Phase L) will collapse these to 0.
const BEAT = {
  damageDealt: 380,
  blockGained: 240,
  healed: 260,
  enemyKilled: 480,
  damageTaken: 440,
  enemyBlockGained: 320,
  intentTelegraphed: 180,
  phaseToEnemy: 600,
  phaseToPlayer: 380,
  phaseToVictory: 500,
  phaseToGameOver: 500,
} as const

export type BoardGeometry = {
  cellSize: number
  gemSize: number
  cellCenter: (x: number, y: number) => { x: number; y: number }
}

const keyOf = (p: Pos) => `${p.x},${p.y}`

const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms))

function phaseBeat(phase: import('../types').CombatPhase): number {
  switch (phase) {
    case 'enemy-acting':
      return BEAT.phaseToEnemy
    case 'player-acting':
      return BEAT.phaseToPlayer
    case 'victory':
      return BEAT.phaseToVictory
    case 'game-over':
      return BEAT.phaseToGameOver
    default:
      return 0
  }
}

// Overshoot-and-settle scale curve for callout text. Mirrors the puco-puco
// combo-pop keyframes: 0% → 1.45, 60% → 0.92, 100% → 1.0.
function popScaleCurve(progress: number): number {
  if (progress < 0.6) return 1.45 + (0.92 - 1.45) * (progress / 0.6)
  return 0.92 + (1.0 - 0.92) * ((progress - 0.6) / 0.4)
}

// Brighter gem-color variants for callout text so it pops against the dark
// board without flattening the palette identity.
const CALLOUT_PALETTE: Record<GemColor, number> = {
  red: 0xff7068,
  blue: 0x7ab8ff,
  green: 0x68e599,
  yellow: 0xf5d650,
  purple: 0xc080ff,
}

const CASCADE_HEX = 0xfacc15

function cascadeCalloutText(displayLevel: number): string {
  if (displayLevel <= 2) return 'CHAIN!'
  if (displayLevel === 3) return 'FRENZY!'
  if (displayLevel === 4) return 'RAMPAGE!'
  return 'UNREAL!'
}

// Per-match dopamine callout. Only line matches of size 4+ get a word —
// shape-based (T/L) clears already telegraph themselves through the bigger
// area clear and burst particles, so an extra word felt like noise.
function matchCalloutText(size: number, shape: MatchShape): string | null {
  if (shape !== 'line') return null
  if (size >= 5) return 'BOOM!'
  if (size === 4) return 'POW!'
  return null
}

// Owns the (Sprite | null)[][] grid that mirrors the logical board, and
// drives sprites in response to GameEvent[] streams.
export class AnimationController {
  private sprites: (Sprite | null)[][]
  private readonly geometry: BoardGeometry
  private readonly parent: Container
  private readonly textures: Record<GemColor, Texture>
  private readonly cellScreenCenter: (pos: Pos) => { x: number; y: number } | null
  private overlay: OverlayScene | null = null
  private playing: Promise<void> = Promise.resolve()
  private busy = false

  // Per-cascade-step tracking, used to colorise particle bursts and pick
  // trail source cells. Cleared on each cascade-start.
  private cellColor = new Map<string, GemColor>()
  private lastMatchCells = new Map<GemColor, Pos[]>()
  // Shared across cascade + match callouts so consecutive pops (including
  // chained tiers) swing opposite directions.
  private lastCalloutTiltSign = 0
  // "Heat" accumulates with each callout and decays exponentially with a
  // 1.5s half-life. Drives intensity escalation: bigger font at heat ≥ 2,
  // screenshake at heat ≥ 3, flame burst at heat ≥ 4.
  private heat = 0
  private heatLastTimestamp = 0

  constructor(opts: {
    parent: Container
    sprites: Sprite[][]
    geometry: BoardGeometry
    textures: Record<GemColor, Texture>
    cellScreenCenter: (pos: Pos) => { x: number; y: number } | null
  }) {
    this.parent = opts.parent
    this.sprites = opts.sprites.map((row) => row.slice() as (Sprite | null)[])
    this.geometry = opts.geometry
    this.textures = opts.textures
    this.cellScreenCenter = opts.cellScreenCenter
  }

  setOverlay(overlay: OverlayScene): void {
    this.overlay = overlay
  }

  get isAnimating(): boolean {
    return this.busy
  }

  // Read-only peek into the current sprite grid. Used by BoardScene for
  // hover/shimmer effects that target whichever sprite happens to be at a
  // given cell right now.
  peekSprite(pos: Pos): Sprite | null {
    return this.getSprite(pos)
  }

  async play(events: GameEvent[]): Promise<void> {
    // Chain onto any in-flight playback so concurrent calls serialize cleanly.
    const prev = this.playing
    const next = (async () => {
      await prev
      this.busy = true
      try {
        for (const event of events) {
          await this.playEvent(event)
        }
      } finally {
        this.busy = false
      }
    })()
    this.playing = next
    return next
  }

  private async playEvent(event: GameEvent): Promise<void> {
    emitGameEvent(event)
    switch (event.kind) {
      case 'swap':
        await this.animateSwap(event.from, event.to)
        return
      case 'swap-reverted':
        await this.animateSwap(event.from, event.to)
        return
      case 'cascade-start':
        this.cellColor.clear()
        this.lastMatchCells.clear()
        if (event.level >= 1) this.spawnCascadeCallout(event.level + 1)
        return
      case 'match-found':
        for (const c of event.cells) this.cellColor.set(keyOf(c), event.color)
        this.lastMatchCells.set(event.color, event.cells)
        this.spawnMatchCallout(event.size, event.shape, event.color, event.cells)
        if (event.size >= 4) await wait(HIT_STOP_MS)
        return
      case 'gems-cleared':
        this.spawnBurstsForCells(event.cells)
        await this.animateClear(event.cells)
        return
      case 'gems-fell':
        await this.animateFall(event.movements)
        return
      case 'gems-spawned':
        await this.animateSpawn(event.spawns)
        return
      case 'pool-gained':
        this.spawnPoolTrail(event.color)
        return
      case 'damage-dealt':
        this.spawnDamagePopup(event.targetId, event.amount)
        await wait(BEAT.damageDealt)
        return
      case 'healed':
        this.spawnHealPopup(event.amount)
        await wait(BEAT.healed)
        return
      case 'damage-taken':
        if (event.amount > 0) {
          this.spawnPlayerDamagePopup(event.amount)
          await wait(BEAT.damageTaken)
        }
        return
      case 'enemy-block-gained':
        this.spawnEnemyBlockPopup(event.enemyId, event.amount)
        await wait(BEAT.enemyBlockGained)
        return
      case 'block-gained':
        await wait(BEAT.blockGained)
        return
      case 'enemy-killed':
        await wait(BEAT.enemyKilled)
        return
      case 'intent-telegraphed':
        await wait(BEAT.intentTelegraphed)
        return
      case 'phase-changed':
        await wait(phaseBeat(event.phase))
        return
      case 'extra-turn-granted':
        await wait(BEAT.phaseToPlayer)
        return
      case 'turn-ended':
      case 'screen-shake':
        // HUD reads these straight off state or via the event bus subscriber.
        return
    }
  }

  // Exponential-decay heat counter. Each callout calls bumpHeat() which
  // first decays based on time since last bump, then adds 1 (capped at 6).
  // Returns the post-bump value so callers can branch on intensity.
  private bumpHeat(): number {
    const now = performance.now()
    if (this.heatLastTimestamp > 0) {
      const dt = (now - this.heatLastTimestamp) / 1000
      const decayed = this.heat * Math.pow(0.5, dt / 1.5)
      this.heat = decayed < 0.05 ? 0 : decayed
    }
    this.heatLastTimestamp = now
    this.heat = Math.min(6, this.heat + 1)
    return this.heat
  }

  private getSprite(p: Pos): Sprite | null {
    return this.sprites[p.y]?.[p.x] ?? null
  }

  private setSprite(p: Pos, sprite: Sprite | null): void {
    const row = this.sprites[p.y]
    if (!row) return
    row[p.x] = sprite
  }

  private async animateSwap(from: Pos, to: Pos): Promise<void> {
    const a = this.getSprite(from)
    const b = this.getSprite(to)
    if (!a || !b) return
    await tweenSwap(a, b, SWAP_MS)
    this.setSprite(from, b)
    this.setSprite(to, a)
  }

  private async animateClear(cells: Pos[]): Promise<void> {
    const promises: Promise<void>[] = []
    const cleared: { sprite: Sprite; pos: Pos }[] = []
    for (const c of cells) {
      const s = this.getSprite(c)
      if (!s) continue
      cleared.push({ sprite: s, pos: c })
      promises.push(tweenClear(s, CLEAR_MS))
    }
    await Promise.all(promises)
    for (const { sprite, pos } of cleared) {
      this.parent.removeChild(sprite)
      sprite.destroy()
      this.setSprite(pos, null)
    }
  }

  private async animateFall(
    movements: { from: Pos; to: Pos }[],
  ): Promise<void> {
    const moves = movements
      .map(({ from, to }) => ({ sprite: this.getSprite(from), from, to }))
      .filter(
        (m): m is { sprite: Sprite; from: Pos; to: Pos } => m.sprite !== null,
      )
    for (const { from } of moves) this.setSprite(from, null)
    const promises = moves.map(({ sprite, from, to }) => {
      const target = this.geometry.cellCenter(to.x, to.y)
      const distance = Math.abs(to.y - from.y)
      const duration = Math.max(DROP_MIN_MS, DROP_PER_CELL_MS * distance)
      return tweenDrop(sprite, target.x, target.y, duration)
    })
    await Promise.all(promises)
    for (const { sprite, to } of moves) this.setSprite(to, sprite)
  }

  private async animateSpawn(
    spawns: { at: Pos; color: GemColor }[],
  ): Promise<void> {
    const promises: Promise<void>[] = []
    const created: { sprite: Sprite; pos: Pos }[] = []
    for (const { at, color } of spawns) {
      const sprite = new Sprite(this.textures[color])
      sprite.anchor.set(0.5)
      sprite.width = this.geometry.gemSize
      sprite.height = this.geometry.gemSize
      const target = this.geometry.cellCenter(at.x, at.y)
      sprite.x = target.x
      sprite.y = target.y - this.geometry.cellSize * (at.y + 1)
      this.parent.addChild(sprite)
      created.push({ sprite, pos: at })
      const distance = at.y + 1
      const duration = Math.max(DROP_MIN_MS, DROP_PER_CELL_MS * distance)
      promises.push(tweenDrop(sprite, target.x, target.y, duration))
    }
    await Promise.all(promises)
    for (const { sprite, pos } of created) this.setSprite(pos, sprite)
  }

  // ---- Overlay effects (no-op when overlay not yet attached) ----

  private spawnBurstsForCells(cells: Pos[]): void {
    const overlay = this.overlay
    if (!overlay) return
    for (const cell of cells) {
      const color = this.cellColor.get(keyOf(cell)) ?? 'yellow'
      const at = this.cellScreenCenter(cell)
      if (!at) continue
      overlay.spawnBurst(at, color, { count: 9 })
    }
  }

  private spawnCascadeCallout(displayLevel: number): void {
    const overlay = this.overlay
    if (!overlay) return
    const center = this.cellScreenCenter({ x: 3.5, y: -1 })
    if (!center) return
    const heat = this.bumpHeat()
    // Each link in the chain pops a touch larger. Heat adds a TINY extra
    // bump (max +2px) — the user wants the word growth to stay subtle, so
    // we lean on particles/shake for the "louder" intensity beats.
    const steps = Math.min(displayLevel - 2, 4)
    const fontHeatBoost = Math.min(2, Math.floor((heat - 1) / 2))
    const burstHeatBoost = Math.max(0, Math.floor(heat - 1))
    const fontSize = 36 + steps * 4 + fontHeatBoost
    overlay.spawnBurst(center, CASCADE_HEX, {
      count: 14 + steps * 2 + burstHeatBoost,
      speedMin: 110,
      speedMax: 220 + steps * 18,
      radiusMin: 3,
      radiusMax: 5.5 + steps * 0.4,
      lifeMs: 700,
      gravity: 120,
      spread: 0.9,
    })
    overlay.spawnFloatingText(center, cascadeCalloutText(displayLevel), {
      color: CASCADE_HEX,
      fontSize,
      lifeMs: 750,
      driftY: -28,
      scaleCurve: popScaleCurve,
      rotationFrom: this.nextTiltRadians(),
      rotationEase: 0,
    })
    if (heat >= 2) {
      // White sparkles drifting upward around the text. Count grows with
      // heat so the air around bigger callouts gets visibly busier.
      overlay.spawnSparkle(center, 4 + Math.floor((heat - 1) * 1.5))
    }
    if (heat >= 3) {
      // Screenshake on chained callouts — the body class handles the
      // animation. HUD listens for this event and toggles its shake state.
      emitGameEvent({ kind: 'screen-shake', magnitude: Math.min(1, heat / 5) })
    }
    if (heat >= 4) {
      // Embers rising behind the text. Subtle — small particle count, short
      // life — but it adds the "things are getting hot" beat.
      overlay.spawnFlame(center, 7 + Math.floor(heat))
    }
  }

  private spawnMatchCallout(
    size: number,
    shape: MatchShape,
    color: GemColor,
    cells: Pos[],
  ): void {
    const overlay = this.overlay
    if (!overlay || cells.length === 0) return
    const text = matchCalloutText(size, shape)
    if (!text) return
    let sumX = 0
    let sumY = 0
    for (const c of cells) {
      sumX += c.x
      sumY += c.y
    }
    const at = this.cellScreenCenter({
      x: sumX / cells.length,
      y: sumY / cells.length,
    })
    if (!at) return
    const heat = this.bumpHeat()
    const heatBoost = Math.floor(Math.max(0, heat - 1))
    overlay.spawnFloatingText(at, text, {
      color: CALLOUT_PALETTE[color],
      fontSize: 28 + heatBoost,
      lifeMs: 650,
      driftY: -55,
      scaleCurve: popScaleCurve,
      rotationFrom: this.nextTiltRadians(),
      rotationEase: 0,
    })
  }

  // Subtle (±2-6°) tilt with alternating sign across all callouts so
  // consecutive pops never lean the same direction. Shared sign tracker
  // means cascade/match/prismatic also alternate against each other.
  private nextTiltRadians(): number {
    const sign =
      this.lastCalloutTiltSign !== 0
        ? -this.lastCalloutTiltSign
        : Math.random() < 0.5
          ? -1
          : 1
    this.lastCalloutTiltSign = sign
    const tiltDeg = (2 + Math.random() * 4) * sign
    return (tiltDeg * Math.PI) / 180
  }

  private spawnPoolTrail(color: GemColor): void {
    const overlay = this.overlay
    if (!overlay) return
    const cells = this.lastMatchCells.get(color)
    if (!cells || cells.length === 0) return
    const source = cells[Math.floor(cells.length / 2)] ?? cells[0]
    if (!source) return
    const from = this.cellScreenCenter(source)
    if (!from) return
    const attractor: Attractor = () => {
      const el = document.querySelector<HTMLElement>(
        `[data-pool-target="${color}"]`,
      )
      return el ? elementCenter(el) : null
    }
    overlay.spawnTrail(from, attractor, color, 5)
  }

  private spawnDamagePopup(enemyId: string, amount: number): void {
    const overlay = this.overlay
    if (!overlay) return
    const el = document.querySelector<HTMLElement>(
      `[data-enemy-id="${enemyId}"]`,
    )
    if (!el) return
    const center = elementCenter(el)
    if (!center) return
    overlay.spawnFloatingText(
      { x: center.x, y: center.y - 30 },
      `-${amount}`,
      {
        color: 0xee5e57,
        fontSize: 30,
        lifeMs: 800,
        driftY: -75,
        growBy: 0.3,
      },
    )
  }

  private spawnHealPopup(amount: number): void {
    const overlay = this.overlay
    if (!overlay) return
    const el = document.querySelector<HTMLElement>('[data-player-hud]')
    if (!el) return
    const center = elementCenter(el)
    if (!center) return
    overlay.spawnFloatingText(
      { x: center.x, y: center.y - 20 },
      `+${amount}`,
      {
        color: 0x4dd581,
        fontSize: 28,
        lifeMs: 750,
        driftY: -60,
        growBy: 0.25,
      },
    )
  }

  private spawnPlayerDamagePopup(amount: number): void {
    const overlay = this.overlay
    if (!overlay) return
    const el = document.querySelector<HTMLElement>('[data-player-hud]')
    if (!el) return
    const center = elementCenter(el)
    if (!center) return
    overlay.spawnFloatingText(
      { x: center.x, y: center.y - 20 },
      `-${amount}`,
      {
        color: 0xee5e57,
        fontSize: 30,
        lifeMs: 800,
        driftY: -70,
        growBy: 0.3,
      },
    )
  }

  private spawnEnemyBlockPopup(enemyId: string, amount: number): void {
    const overlay = this.overlay
    if (!overlay) return
    const el = document.querySelector<HTMLElement>(
      `[data-enemy-id="${enemyId}"]`,
    )
    if (!el) return
    const center = elementCenter(el)
    if (!center) return
    overlay.spawnFloatingText(
      { x: center.x, y: center.y - 30 },
      `+${amount} 🛡`,
      {
        color: 0x9ec5ff,
        fontSize: 22,
        lifeMs: 750,
        driftY: -45,
        growBy: 0.2,
      },
    )
  }
}
