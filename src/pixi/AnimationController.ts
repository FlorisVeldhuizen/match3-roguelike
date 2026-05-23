import { Sprite, type Container, type Texture } from 'pixi.js'
import type { GameEvent, GemColor, MatchShape, Pos } from '../types'
import { tweenSwap } from './animations/swap'
import { tweenClear } from './animations/clear'
import { tweenDrop } from './animations/drop'
import { emitGameEvent } from '../core/events/emitter'
import { TRAIL_ARRIVAL_MS, scheduleAtTrailArrival } from '../timing'
import {
  elementCenter,
  type Attractor,
  type OverlayScene,
} from './OverlayScene'

// Per-cell visual timings.
const SWAP_MS = 200
const CLEAR_MS = 280
const DROP_PER_CELL_MS = 45
// Minimum fall portion (gem in flight) before the bounce window. We let
// fall time scale with distance so a column of gems lands in cascade —
// short drops finish and start bouncing before longer drops touch down.
// This floor only prevents pathologically fast 1-frame falls.
const DROP_MIN_FALL_MS = 65
// Position-derived per-gem start delay (0–24ms). Same-distance falls
// would otherwise land in synchronized batches; this small offset
// desynchronizes them so each gem reads as its own landing instead of
// a chord. Deterministic from (x, y) — no RNG, animations stay
// reproducible — but spread enough to break the perceived chord.
function dropJitterMs(x: number, y: number): number {
  return (x * 17 + y * 31) % 25
}
const HIT_STOP_MS = 80 // pause-frames on 4+ matches before clear plays

// Brief freeze before damage popup + shake. Heavy hits (5+) get a
// dedicated "ouch" beat; lighter hits get a barely-perceptible nudge.
function hitPauseMs(amount: number): number {
  if (amount >= 5) return 110
  if (amount >= 3) return 55
  return 0
}

// Combat beat pacing — each event gets its own breath so the player can read
// what's happening. `damageDealt` and `healed` fire per-match during the
// cascade, so they're kept short — otherwise a 3-hit cascade burns >1s of
// dead time on damage beats alone.
const BEAT = {
  damageDealt: 60,
  blockGained: 240,
  healed: 60,
  // Shorter than damageTaken — fully-blocked hits have no shake/vignette,
  // just a popup to confirm "shield ate it".
  blockedHit: 280,
  enemyStaggered: 520,
  damageTaken: 440,
  enemyBlockGained: 320,
  // Stagger between back-to-back intent badges (multi-enemy). Pop-in CSS
  // anim runs autonomously, so this just serializes the queue.
  intentTelegraphed: 80,
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

// Shared visual hex — mirrors the CSS palette in index.css.
const VISUAL = {
  cascadeGold: 0xfacc15,
  damageRed: 0xee5e57,
  shieldBlue: 0x9ec5ff,
  burnEmber: 0xee5e57,
  vulnerableOrange: 0xc47e3c,
  weakPale: 0xc9b896,
} as const

const STATUS_HEX: Record<'burn' | 'vulnerable' | 'weak', number> = {
  burn: VISUAL.burnEmber,
  vulnerable: VISUAL.vulnerableOrange,
  weak: VISUAL.weakPale,
}

// Darker "stored pool" palette — matches the HUD pool backgrounds so a
// `+N` popup reads as the same currency the indicator is holding.
const STORED_HEX: Record<GemColor, number> = {
  red: 0xb84a44,
  blue: 0x6b9bd6,
  green: 0x5fb87a,
  yellow: 0xe6b830,
  purple: 0xa46be3,
}

// Pazudora-style numeric multiplier. The rising chime + intensifying
// particles carry the dopamine; aggressive verbs ("RAMPAGE!") clashed with
// the bright/upbeat audio. POW!/BOOM! still fire on big line matches —
// those are impact moments, not chain escalation.
function cascadeCalloutText(displayLevel: number): string {
  return `×${displayLevel}`
}

// 26px base, +2px per gem above 3, capped at +6.
function damagePopupFontSize(amount: number): number {
  return 26 + Math.min(6, Math.max(0, amount - 3) * 2)
}

// Shared shape for tilt-and-pop word callouts. Callers add color, fontSize,
// lifeMs, driftY, and rotationFrom (from nextTiltRadians).
//
// `chromatic: true` routes these to the overlay's RGB-split text layer.
// Every WORD_POP callout *except* DEFEATED is in-board (POW/BOOM/×N/+1
// TURN/NO MOVES) so chromatic is the right default — DEFEATED overrides
// to false at its callsite since it floats over the enemy frame.
const WORD_POP = {
  scaleCurve: popScaleCurve,
  rotationEase: 0,
  chromatic: true,
} as const

function centroidOf(cells: Pos[]): Pos | null {
  if (cells.length === 0) return null
  let sumX = 0
  let sumY = 0
  for (const c of cells) {
    sumX += c.x
    sumY += c.y
  }
  return { x: sumX / cells.length, y: sumY / cells.length }
}

// Scan the event queue starting at `start` for the contiguous run of
// match-found events emitted between this cascade-start and the next
// gems-cleared. Returns the screen-space centroid of all matched cells in
// that run, or null if no matches are queued. Used to anchor the chain-link
// callout to the gems that triggered the cascade rather than the previous
// link's cells.
function cascadeAnchorFromUpcoming(
  events: GameEvent[],
  start: number,
  toScreen: (p: Pos) => { x: number; y: number } | null,
): { x: number; y: number } | null {
  let sumX = 0
  let sumY = 0
  let n = 0
  for (let j = start; j < events.length; j++) {
    const e = events[j]
    if (!e || e.kind !== 'match-found') break
    for (const c of e.cells) {
      sumX += c.x
      sumY += c.y
      n++
    }
  }
  if (n === 0) return null
  return toScreen({ x: sumX / n, y: sumY / n })
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
  // Memoised selector → element lookups. Revalidated via isConnected so a
  // React re-render that swapped the element falls back to a fresh query.
  private domCache = new Map<string, HTMLElement>()
  // Current cascade level (0 = initial match, 1+ = chain link). Drives the
  // particle-count escalation in spawnBurstsForCells so chained matches
  // visibly read as bigger explosions.
  private currentCascadeLevel = 0

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
        for (let i = 0; i < events.length; i++) {
          const event = events[i]
          if (!event) continue
          // Run gems-fell + gems-spawned together when they appear back-to-back
          // (the normal case during a cascade step). They animate disjoint
          // sprites — existing gems sliding down, new gems entering from above
          // — so playing them as one waterfall reads more naturally and trims
          // dead time before the next cascade's clear starts.
          const peek = events[i + 1]
          if (event.kind === 'gems-fell' && peek?.kind === 'gems-spawned') {
            emitGameEvent(event)
            emitGameEvent(peek)
            await Promise.all([
              this.animateFall(event.movements),
              this.animateSpawn(peek.spawns),
            ])
            i++
            continue
          }
          // Chain-link callout (×N) anchors to the *new* matches that form
          // this link — the gems the player is reading as "the cascade trigger"
          // — not the previous link's centroid. Cascade-start fires before the
          // match-found events for its own level, so we look ahead through the
          // contiguous match-found run to compute that centroid up front.
          if (event.kind === 'cascade-start' && event.level >= 1) {
            const anchor = cascadeAnchorFromUpcoming(events, i + 1, (p) =>
              this.cellScreenCenter(p),
            )
            emitGameEvent(event)
            this.cellColor.clear()
            this.lastMatchCells.clear()
            this.currentCascadeLevel = event.level
            this.spawnCascadeCallout(event.level + 1, anchor)
            continue
          }
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
        // Level-0 cascade-start: just reset per-step trackers. Chain links
        // (level >= 1) are handled in play() with a lookahead anchor so the
        // callout can target the upcoming matches' centroid, not the previous
        // link's cells.
        this.cellColor.clear()
        this.lastMatchCells.clear()
        this.currentCascadeLevel = event.level
        return
      case 'cascade-complete':
        // Celebration flourish. 2-chain gets a scaled-down visual-only
        // version (no audio — the per-link chime + clack already mark the
        // chain). 3+ gets the full visual + audio flourish.
        if (event.levels >= 2) this.spawnCascadeCelebration(event.levels)
        return
      case 'match-found':
        for (const c of event.cells) this.cellColor.set(keyOf(c), event.color)
        this.lastMatchCells.set(event.color, event.cells)
        this.spawnMatchCallout(event.size, event.shape, event.color, event.cells)
        if (event.grantsExtraTurn) this.spawnExtraTurnCallout(event.cells)
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
      case 'board-shuffled':
        await this.animateShuffle(event.cells)
        return
      case 'pool-gained':
        // Trail always flies; arrival popup only for pools still pooled at
        // EOP. Red/green resolve per-match — their popup is the damage-dealt
        // / healed event, avoiding a double-pop.
        this.spawnPoolTrail(event.color)
        if (event.color !== 'red' && event.color !== 'green') {
          this.spawnPoolArrivalPopup(event.color, event.amount)
        }
        return
      case 'damage-dealt':
        if (event.source === 'player-attack') {
          // Per-match commit. Delay the popup so it lands at the same
          // moment the red gem trail arrives at the enemy.
          this.scheduleDelayedDamagePopup(event.targetId, event.amount)
        } else {
          this.spawnDamagePopup(event.targetId, event.amount)
        }
        await wait(BEAT.damageDealt)
        return
      case 'healed':
        // Per-match commit. Delay the popup to sync with the green
        // trail's arrival at the HP bar.
        this.scheduleDelayedHealPopup(event.amount)
        await wait(BEAT.healed)
        return
      case 'damage-taken':
        if (event.amount > 0) {
          const pause = hitPauseMs(event.amount)
          if (pause > 0) await wait(pause)
          this.spawnPlayerDamagePopup(event.amount)
          await wait(BEAT.damageTaken)
        } else if (event.blocked > 0) {
          this.spawnPlayerBlockedPopup(event.blocked)
          await wait(BEAT.blockedHit)
        }
        return
      case 'enemy-block-gained':
        this.spawnEnemyBlockPopup(event.enemyId, event.amount)
        await wait(BEAT.enemyBlockGained)
        return
      case 'block-gained':
        await wait(BEAT.blockGained)
        return
      case 'enemy-killed': {
        // Schedule the burst to land when the HP bar reads zero (which is
        // TRAIL_ARRIVAL_MS after the killing damage-dealt, and damage-dealt
        // already waited BEAT.damageDealt). Then breathe for 320ms so the
        // kill registers before the next event.
        const visualDelay = Math.max(0, TRAIL_ARRIVAL_MS - BEAT.damageDealt)
        const enemyId = event.enemyId
        window.setTimeout(() => this.playEnemyDeathBurst(enemyId), visualDelay)
        await wait(visualDelay + 320)
        return
      }
      case 'enemy-staggered':
        await wait(BEAT.enemyStaggered)
        return
      case 'intent-telegraphed':
        await wait(BEAT.intentTelegraphed)
        return
      case 'phase-changed':
        await wait(phaseBeat(event.phase))
        return
      case 'status-applied':
        this.spawnStatusTrail(event)
        return
      case 'extra-turn-granted':
        this.spawnExtraTurnBannerBurst()
        await wait(BEAT.phaseToPlayer)
        return
      case 'block-absorbed':
        // Player target (enemy attack) fires synchronously with damage-taken.
        // Enemy target (player attack) needs to land with the red gem trail,
        // matching the delayed damage popup — otherwise the shield reacts
        // before the blow actually arrives.
        if (event.targetId === 'player') {
          this.spawnShieldEffect(event.targetId, 'absorbed')
        } else {
          const targetId = event.targetId
          scheduleAtTrailArrival(() =>
            this.spawnShieldEffect(targetId, 'absorbed'),
          )
        }
        return
      case 'block-broken':
        if (event.targetId === 'player') {
          this.spawnShieldEffect(event.targetId, 'broken')
        } else {
          const targetId = event.targetId
          scheduleAtTrailArrival(() =>
            this.spawnShieldEffect(targetId, 'broken'),
          )
        }
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

  private findEl(selector: string): HTMLElement | null {
    const cached = this.domCache.get(selector)
    if (cached && cached.isConnected) return cached
    const found = document.querySelector<HTMLElement>(selector)
    if (found) this.domCache.set(selector, found)
    else this.domCache.delete(selector)
    return found
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
      const fallMs = Math.max(DROP_MIN_FALL_MS, DROP_PER_CELL_MS * distance)
      const delay = dropJitterMs(to.x, to.y)
      const tween = () => tweenDrop(sprite, target.x, target.y, fallMs)
      return delay > 0 ? wait(delay).then(tween) : tween()
    })
    await Promise.all(promises)
    for (const { sprite, to } of moves) this.setSprite(to, sprite)
  }

  // No-legal-swaps reshuffle. Plays a "NO MOVES" banner + screenshake, then
  // dissolves every existing gem and drops a fresh playable board in from
  // the top. The cell layout is determined by the store (deterministic from
  // rng.board); we just render it.
  private async animateShuffle(
    cells: { at: Pos; color: GemColor }[],
  ): Promise<void> {
    this.spawnNoMovesCallout()
    emitGameEvent({ kind: 'screen-shake', magnitude: 0.6 })
    // Brief read-time on the banner before the board tears down.
    await wait(360)
    // Dissolve every existing sprite in parallel.
    const dissolvePromises: Promise<void>[] = []
    const toRemove: { sprite: Sprite; pos: Pos }[] = []
    for (let y = 0; y < this.sprites.length; y++) {
      const row = this.sprites[y]
      if (!row) continue
      for (let x = 0; x < row.length; x++) {
        const s = row[x]
        if (!s) continue
        toRemove.push({ sprite: s, pos: { x, y } })
        dissolvePromises.push(tweenClear(s, CLEAR_MS))
      }
    }
    await Promise.all(dissolvePromises)
    for (const { sprite, pos } of toRemove) {
      this.parent.removeChild(sprite)
      sprite.destroy()
      this.setSprite(pos, null)
    }
    // Fresh fall-in. Reuse animateSpawn — staggered drop distances make
    // the new board look like it cascades into place rather than blinking on.
    await this.animateSpawn(cells)
  }

  private spawnNoMovesCallout(): void {
    const overlay = this.overlay
    if (!overlay) return
    const center = this.cellScreenCenter({ x: 3.5, y: 3.5 })
    if (!center) return
    overlay.spawnFloatingText(center, 'NO MOVES', {
      ...WORD_POP,
      color: VISUAL.cascadeGold,
      fontSize: 44,
      lifeMs: 900,
      driftY: -10,
      rotationFrom: this.nextTiltRadians(),
    })
    overlay.spawnFloatingText(
      { x: center.x, y: center.y + 38 },
      'reshuffling…',
      {
        color: 0xffffff,
        fontSize: 22,
        lifeMs: 900,
        driftY: -10,
        growBy: 0.1,
        chromatic: true,
      },
    )
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
      const fallMs = Math.max(DROP_MIN_FALL_MS, DROP_PER_CELL_MS * distance)
      const delay = dropJitterMs(at.x, at.y)
      const tween = () => tweenDrop(sprite, target.x, target.y, fallMs)
      promises.push(delay > 0 ? wait(delay).then(tween) : tween())
    }
    await Promise.all(promises)
    for (const { sprite, pos } of created) this.setSprite(pos, sprite)
  }

  // ---- Overlay effects (no-op when overlay not yet attached) ----

  private spawnBurstsForCells(cells: Pos[]): void {
    const overlay = this.overlay
    if (!overlay) return
    // Chain links throw bigger explosions: +4 particles per cascade step,
    // capped so a deep cascade doesn't drown the frame in confetti.
    const step = Math.min(this.currentCascadeLevel, 4)
    const count = 9 + step * 4
    const speedMax = 180 + step * 25
    const radiusMax = 4.5 + step * 0.4
    for (const cell of cells) {
      const color = this.cellColor.get(keyOf(cell)) ?? 'yellow'
      const at = this.cellScreenCenter(cell)
      if (!at) continue
      overlay.spawnBurst(at, color, { count, speedMax, radiusMax })
    }
  }

  private spawnCascadeCallout(
    displayLevel: number,
    anchor: { x: number; y: number } | null,
  ): void {
    const overlay = this.overlay
    if (!overlay) return
    const center = anchor ?? this.cellScreenCenter({ x: 3.5, y: -1 })
    if (!center) return
    const heat = this.bumpHeat()
    // Each link in the chain pops a touch larger. Heat adds a TINY extra
    // bump (max +2px) — the user wants the word growth to stay subtle, so
    // we lean on particles/shake for the "louder" intensity beats.
    const steps = Math.min(displayLevel - 2, 4)
    const fontHeatBoost = Math.min(2, Math.floor((heat - 1) / 2))
    const burstHeatBoost = Math.max(0, Math.floor(heat - 1))
    const fontSize = 36 + steps * 4 + fontHeatBoost
    overlay.spawnBurst(center, VISUAL.cascadeGold, {
      count: 20 + steps * 3 + burstHeatBoost,
      speedMin: 110,
      speedMax: 220 + steps * 18,
      radiusMin: 3,
      radiusMax: 5.5 + steps * 0.4,
      lifeMs: 700,
      gravity: 120,
      spread: 0.9,
    })
    // Text origin sits slightly above the match centroid so it stacks above
    // POW/BOOM (at centroid, drifting up to ~y-55) and +1 TURN (at y-36,
    // drifting to y-78) on size-4+ chain triggers. The gold burst stays at
    // the centroid for visual punch on the merging gems themselves.
    const textOrigin = { x: center.x, y: center.y - 70 }
    overlay.spawnFloatingText(textOrigin, cascadeCalloutText(displayLevel), {
      ...WORD_POP,
      color: VISUAL.cascadeGold,
      fontSize,
      lifeMs: 750,
      driftY: -28,
      rotationFrom: this.nextTiltRadians(),
    })
    if (heat >= 2) {
      // White sparkles drifting upward around the text. Count grows with
      // heat so the air around bigger callouts gets visibly busier.
      overlay.spawnSparkle(center, 4 + Math.floor((heat - 1) * 1.5))
    }
    // Streak shake is driven off displayLevel (cascade depth), NOT heat.
    // Heat decays in real-time (1.5s half-life) but each cascade link takes
    // ~1s of clear+fall+spawn animation, so heat never reliably clears the
    // earlier `>= 3` threshold on typical streaks. Tying shake to depth
    // makes each chain link guaranteed-more-shaky than the last.
    // displayLevel = event.level + 1:
    //   2 (first cascade)            → 0.55
    //   3                            → 1.05
    //   4                            → 1.45
    //   5+                           → 1.75 (cap)
    const streakMag = Math.min(1.75, 0.15 + 0.4 * (displayLevel - 1))
    emitGameEvent({ kind: 'screen-shake', magnitude: streakMag })
    if (heat >= 4) {
      // Embers rising behind the text. Subtle — small particle count, short
      // life — but it adds the "things are getting hot" beat.
      overlay.spawnFlame(center, 7 + Math.floor(heat))
    }
  }

  // 2-chain gets a minimal visual-only flourish; 3+ chains get the full
  // burst + sparkle, paired with the audio celebration in sfx.ts. Deferred
  // so it doesn't block the damage/heal events that follow the cascade.
  private spawnCascadeCelebration(levels: number): void {
    const overlay = this.overlay
    if (!overlay) return
    const center = this.cellScreenCenter({ x: 3.5, y: 3.5 })
    if (!center) return
    const tier2 = levels === 2
    const extra = Math.max(0, levels - 3)
    window.setTimeout(() => {
      const o = this.overlay
      if (!o) return
      o.spawnBurst(center, VISUAL.cascadeGold, {
        count: tier2 ? 12 : 28 + extra * 10,
        speedMin: tier2 ? 100 : 140,
        speedMax: tier2 ? 200 : 260 + extra * 40,
        radiusMin: tier2 ? 2 : 3,
        radiusMax: tier2 ? 4 : 6,
        lifeMs: tier2 ? 600 : 850,
        gravity: tier2 ? 100 : 140,
        spread: tier2 ? 0.8 : 1.2,
      })
      // Sparkle reserved for 3+ — separates "you chained twice" from
      // "you chained a real combo".
      if (!tier2) o.spawnSparkle(center, 8 + extra * 4)
    }, 200)
  }

  private spawnMatchCallout(
    size: number,
    shape: MatchShape,
    color: GemColor,
    cells: Pos[],
  ): void {
    const overlay = this.overlay
    if (!overlay) return
    const text = matchCalloutText(size, shape)
    if (!text) return
    const center = centroidOf(cells)
    if (!center) return
    const at = this.cellScreenCenter(center)
    if (!at) return
    const heat = this.bumpHeat()
    const heatBoost = Math.floor(Math.max(0, heat - 1))
    overlay.spawnFloatingText(at, text, {
      ...WORD_POP,
      color: CALLOUT_PALETTE[color],
      fontSize: 28 + heatBoost,
      lifeMs: 650,
      driftY: -55,
      rotationFrom: this.nextTiltRadians(),
    })
  }

  // The "+1 TURN" text fired at the moment a 4+ match locks in — the
  // per-match cause cue. The matching banner-anchored burst (sparkle +
  // particles + shake) fires later on `extra-turn-granted`, so the visual
  // reward lands with the "Bonus Turn" banner.
  private spawnExtraTurnCallout(cells: Pos[]): void {
    const overlay = this.overlay
    if (!overlay) return
    const center = centroidOf(cells)
    if (!center) return
    const at = this.cellScreenCenter(center)
    if (!at) return
    // Anchor above the match so it doesn't collide with the POW/BOOM word.
    const textAt = { x: at.x, y: at.y - 36 }
    overlay.spawnFloatingText(textAt, '+1 TURN', {
      ...WORD_POP,
      color: VISUAL.cascadeGold,
      fontSize: 38,
      lifeMs: 900,
      driftY: -42,
      rotationFrom: this.nextTiltRadians(),
    })
  }

  // Burst + sparkle + shake that lands with the "Bonus Turn" PhaseBanner.
  // The banner is anchored to the board center (see PhaseBanner.tsx), so
  // we query the same element here to keep the visual moment unified.
  // Falls back to viewport center if the board element isn't mounted yet.
  private spawnExtraTurnBannerBurst(): void {
    const overlay = this.overlay
    if (!overlay) return
    const el = document.getElementById('board-mount')
    const at = (el && elementCenter(el)) ?? {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    }
    overlay.spawnBurst(at, VISUAL.cascadeGold, {
      count: 28,
      speedMin: 130,
      speedMax: 260,
      radiusMin: 3,
      radiusMax: 6,
      lifeMs: 780,
      gravity: 100,
      spread: 1,
    })
    overlay.spawnSparkle(at, 8)
    emitGameEvent({ kind: 'screen-shake', magnitude: 1.2 })
  }

  // Gold outer + red fragments + upward sparkle + DEFEATED callout + hard
  // shake, anchored on the enemy frame. Timed externally to land at the
  // HP-zero moment (see the 'enemy-killed' case in playEvent).
  private playEnemyDeathBurst(enemyId: string): void {
    const overlay = this.overlay
    const el = this.findEl(`[data-enemy-id="${enemyId}"]`)
    const center = overlay && el ? elementCenter(el) : null
    if (overlay && center) {
      overlay.spawnBurst(center, VISUAL.cascadeGold, {
        count: 26,
        speedMin: 180,
        speedMax: 340,
        radiusMin: 3,
        radiusMax: 6,
        lifeMs: 780,
        gravity: 240,
        spread: 1.5,
      })
      overlay.spawnBurst(center, 'red', {
        count: 20,
        speedMin: 140,
        speedMax: 280,
        radiusMin: 2.5,
        radiusMax: 5,
        lifeMs: 720,
        gravity: 320,
        spread: 1.4,
      })
      overlay.spawnSparkle(center, 12)
      overlay.spawnFloatingText(
        { x: center.x, y: center.y - 12 },
        'DEFEATED',
        {
          ...WORD_POP,
          // Override WORD_POP's chromatic default — DEFEATED floats over
          // the enemy frame (outside the board) where chromatic split on
          // numbers / labels hurts readability.
          chromatic: false,
          color: VISUAL.cascadeGold,
          fontSize: 34,
          lifeMs: 1050,
          driftY: -55,
          rotationFrom: this.nextTiltRadians(),
        },
      )
    }
    // Above the cascade streak cap (1.75) and extra-turn (1.2) so the kill
    // reads as its own tier.
    emitGameEvent({ kind: 'screen-shake', magnitude: 1.6 })
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

  // Popup at the pool-target element synced with the trail's arrival
  // so the number lands *before* the indicator settles.
  private spawnPoolArrivalPopup(color: GemColor, amount: number): void {
    if (amount <= 0) return
    scheduleAtTrailArrival(() => {
      const overlay = this.overlay
      if (!overlay) return
      const el = this.findEl(`[data-pool-target="${color}"]`)
      if (!el) return
      const center = elementCenter(el)
      if (!center) return
      const isDamage = color === 'red'
      const text = isDamage ? `-${amount}` : `+${amount}`
      const popupColor = STORED_HEX[color]
      overlay.spawnFloatingText(
        { x: center.x, y: center.y - 18 },
        text,
        {
          color: popupColor,
          fontSize: damagePopupFontSize(amount),
          lifeMs: 720,
          driftY: -52,
          growBy: 0.25,
        },
      )
    })
  }

  // Damage/heal popups land *with* the gem trail rather than at the
  // upstream event, matching the timing the player already associates
  // with pool-arrival feedback.
  private scheduleDelayedDamagePopup(enemyId: string, amount: number): void {
    if (amount <= 0) return
    scheduleAtTrailArrival(() => {
      this.spawnDamagePopup(enemyId, amount)
    })
  }

  private scheduleDelayedHealPopup(amount: number): void {
    if (amount <= 0) return
    scheduleAtTrailArrival(() => {
      const overlay = this.overlay
      if (!overlay) return
      const el = this.findEl('[data-pool-target="green"]')
      if (!el) return
      const center = elementCenter(el)
      if (!center) return
      overlay.spawnFloatingText(
        { x: center.x, y: center.y - 18 },
        `+${amount}`,
        {
          color: STORED_HEX.green,
          fontSize: damagePopupFontSize(amount),
          lifeMs: 720,
          driftY: -52,
          growBy: 0.25,
        },
      )
    })
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
      const el = this.findEl(`[data-pool-target="${color}"]`)
      return el ? elementCenter(el) : null
    }
    overlay.spawnTrail(from, attractor, color, 5)
  }

  // Particle trail from caster → target for status applications. Source
  // is taken from the event's `source` hint (set by combat layer); target
  // is the receiving entity's frame. Tinted by status kind so Burn looks
  // ember-y, Vulnerable orange, Weak pale.
  private spawnStatusTrail(event: GameEvent & { kind: 'status-applied' }): void {
    const overlay = this.overlay
    if (!overlay) return
    const source = event.source
    if (!source) return

    let from: { x: number; y: number } | null = null
    if (source.kind === 'enemy') {
      const el = this.findEl(`[data-enemy-id="${source.enemyId}"]`)
      from = el ? elementCenter(el) : null
    } else if (source.kind === 'board-cells') {
      // Centroid of the cells in screen space so a 2-cell trigger
      // visually originates between the two flames, not from just one.
      let sx = 0
      let sy = 0
      let n = 0
      for (const cell of source.cells) {
        const c = this.cellScreenCenter(cell)
        if (!c) continue
        sx += c.x
        sy += c.y
        n++
      }
      if (n > 0) from = { x: sx / n, y: sy / n }
    } else if (source.kind === 'player') {
      const el = this.findEl('[data-player-hud]')
      from = el ? elementCenter(el) : null
    }
    if (!from) return

    const target = event.target
    const attractor: Attractor = () => {
      if (target === 'player') {
        const el = this.findEl('[data-player-hud]')
        return el ? elementCenter(el) : null
      }
      const el = this.findEl(`[data-enemy-id="${target}"]`)
      return el ? elementCenter(el) : null
    }

    const hex = STATUS_HEX[event.status.kind]
    // 6 particles — slightly heavier than the pool-trail's 5 so the
    // status hand-off reads as a distinct beat from a regular match.
    overlay.spawnTrail(from, attractor, hex, 6)
  }

  private spawnDamagePopup(enemyId: string, amount: number): void {
    const overlay = this.overlay
    if (!overlay) return
    const el = this.findEl(`[data-enemy-id="${enemyId}"]`)
    if (!el) return
    const center = elementCenter(el)
    if (!center) return
    overlay.spawnFloatingText(
      { x: center.x, y: center.y - 30 },
      `-${amount}`,
      {
        color: VISUAL.damageRed,
        fontSize: 30,
        lifeMs: 800,
        driftY: -75,
        growBy: 0.3,
      },
    )
  }

  private spawnPlayerDamagePopup(amount: number): void {
    const overlay = this.overlay
    if (!overlay) return
    const el = this.findEl('[data-player-hud]')
    if (!el) return
    const center = elementCenter(el)
    if (!center) return
    overlay.spawnFloatingText(
      { x: center.x, y: center.y - 20 },
      `-${amount}`,
      {
        color: VISUAL.damageRed,
        fontSize: 30,
        lifeMs: 800,
        driftY: -70,
        growBy: 0.3,
      },
    )
  }

  private spawnPlayerBlockedPopup(blocked: number): void {
    const overlay = this.overlay
    if (!overlay) return
    const el = this.findEl('[data-player-hud]')
    if (!el) return
    const center = elementCenter(el)
    if (!center) return
    overlay.spawnFloatingText(
      { x: center.x, y: center.y - 20 },
      `-${blocked} 🛡`,
      {
        color: VISUAL.shieldBlue,
        fontSize: 24,
        lifeMs: 700,
        driftY: -55,
        growBy: 0.2,
      },
    )
  }

  // Looks up the on-screen anchor for a shield event and dispatches to the
  // overlay. `targetId` is 'player' for the player HUD, otherwise an enemy id.
  // Coordinates match the damage popups so the visual lines up with where
  // the player's eye already is for that hit.
  private spawnShieldEffect(
    targetId: string,
    kind: 'absorbed' | 'broken',
  ): void {
    const overlay = this.overlay
    if (!overlay) return
    const selector =
      targetId === 'player'
        ? '[data-player-hud]'
        : `[data-enemy-id="${targetId}"]`
    const el = this.findEl(selector)
    if (!el) return
    const center = elementCenter(el)
    if (!center) return
    if (kind === 'absorbed') overlay.spawnShieldBlock(center)
    else overlay.spawnShieldBreak(center)
  }

  private spawnEnemyBlockPopup(enemyId: string, amount: number): void {
    const overlay = this.overlay
    if (!overlay) return
    const el = this.findEl(`[data-enemy-id="${enemyId}"]`)
    if (!el) return
    const center = elementCenter(el)
    if (!center) return
    overlay.spawnFloatingText(
      { x: center.x, y: center.y - 30 },
      `+${amount} 🛡`,
      {
        color: VISUAL.shieldBlue,
        fontSize: 22,
        lifeMs: 750,
        driftY: -45,
        growBy: 0.2,
      },
    )
  }
}
