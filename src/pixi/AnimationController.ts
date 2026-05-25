import { Sprite, type Container, type Texture } from 'pixi.js'
import type { GameEvent, GemColor, MatchShape, Pos } from '../types'
import { tweenSwap } from './animations/swap'
import { tweenClear } from './animations/clear'
import { tweenDrop } from './animations/drop'
import { emitGameEvent } from '../core/events/emitter'
import { awaitStep, getTimeScale } from '../debug/devControls'
import { statusKindFromDamageSource } from '../core/combat/statuses'
import {
  TRAIL_ARRIVAL_MS,
  scheduleAtTrailArrival,
  SWAP_MS,
  DROP_PER_CELL_MS,
  DROP_MIN_FALL_MS,
} from '../timing'
import {
  elementCenter,
  type Attractor,
  type OverlayScene,
} from './OverlayScene'

// Per-cell visual timings. SWAP_MS, DROP_PER_CELL_MS, and DROP_MIN_FALL_MS
// live in ../timing so HTML cell-anchored overlays can mirror the same
// motion windows as the gem sprites.
const CLEAR_MS = 280
// Position-derived per-gem start delay (0–24ms). Same-distance falls
// would otherwise land in synchronized batches; this small offset
// desynchronizes them so each gem reads as its own landing instead of
// a chord. Deterministic from (x, y) — no RNG, animations stay
// reproducible — but spread enough to break the perceived chord.
function dropJitterMs(x: number, y: number): number {
  return (x * 17 + y * 31) % 25
}
// Per-column start delay for the level-start intro. A fresh Fisher-Yates
// shuffle per call so each level-start reads differently (intro is purely
// cosmetic — gameplay determinism is unaffected). Step is tuned so the last
// column starts just before the first column's bottom-row visually lands
// (~245ms total spread for width 8).
const INITIAL_FILL_COLUMN_STEP_MS = 35
function shuffledColumnOrder(width: number): number[] {
  const order = Array.from({ length: width }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = order[i]
    const b = order[j]
    if (a === undefined || b === undefined) continue
    order[i] = b
    order[j] = a
  }
  return order
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
  // Spacing between status-chip state changes (tick/expire). The chip
  // number update itself is delayed by TRAIL_ARRIVAL_MS in HUD.tsx /
  // EnemyFrame.tsx so it lands with the tick's particle; this beat just
  // serializes the AC queue so back-to-back chip changes (multi-burn
  // enemies, chained Smolder ticks) don't fire on the same frame.
  statusTicked: 180,
  statusExpired: 180,
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

// All event-pacing waits run through this helper. Multiplied by the
// inverse of the dev time scale so 0.5× makes waits twice as long; the
// matching Pixi ticker slowdown lives in BoardScene. Production callers
// see scale === 1 → behaves exactly like a plain setTimeout.
const wait = (ms: number) =>
  new Promise<void>((resolve) =>
    window.setTimeout(resolve, ms / getTimeScale()),
  )

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
  // Hot orange — distinct from damageRed so a fire-damage popup reads as
  // "this hit was fire" instead of "this hit was generic damage". Used
  // for the `-N` popup on enemy attacks that carry a burn rider.
  burnEmber: 0xff8540,
  vulnerableOrange: 0xc47e3c,
  weakPale: 0xc9b896,
} as const

// Multi-hue palette for flame trails — deep red base, ember bright,
// orange mid, hot yellow tip. spawnTrail picks one per particle, so a
// flock of 8 reads as a flickering fire rather than uniform red dots.
const FLAME_PALETTE: readonly number[] = [
  0xc4423c, // ember-1: deep red
  0xee5e57, // ember-2: bright ember
  0xff9034, // hot orange
  0xffc15c, // amber
] as const
// Bright molten core (replaces the default pearl white) so the bright
// center of each spark reads as fire, not a sparkle.
const FLAME_CORE_HEX = 0xffe39a

// Bright gold-white core for blessed trails — replaces the default
// pearl-white so each pool-trail particle reads as "lit by something
// magical" rather than a generic glow dot. The palette stays mostly
// gem-color (see spawnPoolTrail) so the flock keeps its pool identity;
// the core is what carries the blessed lighting.
const BLESSED_CORE_HEX = 0xfff5d6
// Mirror of OverlayScene's COLOR_HEX (the hex spawnTrail picks when
// passed a GemColor string). Duplicated here so we can build a custom
// palette array that mixes gem-color with a gold accent without
// importing the OverlayScene internal. Keep in sync if those colors
// shift.
const POOL_TRAIL_HEX: Record<GemColor, number> = {
  red: 0xee5e57,
  blue: 0x4f9dff,
  green: 0x4dd581,
  yellow: 0xf5cf3a,
  purple: 0xb074ff,
}

// Per-status palette + core for the "status proc" particle trail
// (chip → target when a status effect deals damage). Burn uses the
// flame palette; Vulnerable/Weak are placeholders for when they get
// their own tick procs. Adding a new status DoT just means adding a
// row here + the DamageSource → StatusKind mapping in
// core/combat/statuses.ts.
type StatusTrailLook = { palette: readonly number[]; core: number }
const STATUS_TRAIL: Record<'burn' | 'vulnerable' | 'weak', StatusTrailLook> = {
  burn: { palette: FLAME_PALETTE, core: FLAME_CORE_HEX },
  vulnerable: { palette: [VISUAL.vulnerableOrange], core: 0xffffff },
  weak: { palette: [VISUAL.weakPale], core: 0xffffff },
}

// Per-status popup tint for "-N" damage callouts when the source is a
// status proc (Burn tick etc.). Keeps the popup family aligned with the
// trail palette so the visual story stays coherent — orange fire damage
// stays orange from the chip trail all the way through to the popup.
function procPopupTint(kind: 'burn' | 'vulnerable' | 'weak'): number {
  switch (kind) {
    case 'burn':
      return VISUAL.burnEmber
    case 'vulnerable':
      return VISUAL.vulnerableOrange
    case 'weak':
      return VISUAL.weakPale
  }
}

// Particle count scaled to perceived impact (stacks applied, damage
// dealt, etc.). Mirrors the gem-pool trail's "feel proportional" beat:
// 1-unit hits look like a flicker, big hits look heavy. Capped at 8 so
// huge bursts don't blow past the readability budget.
//
//   magnitude 1 → 4 particles
//   magnitude 2 → 5
//   magnitude 3 → 6
//   magnitude 4 → 7
//   magnitude 5+ → 8 (cap)
function particleCountForImpact(magnitude: number): number {
  return Math.max(3, Math.min(8, 3 + Math.max(1, magnitude)))
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
  // Set when a status-proc damage event plays (Burn tick etc.).
  // The HP drain it triggers is delayed by TRAIL_ARRIVAL_MS, so a
  // following phase-changed → game-over needs to wait for the drain
  // to complete; otherwise the defeat overlay covers a still-full
  // HP bar. Cleared on the next phase-changed regardless of outcome.
  private pendingProcDelay = false
  // Set when a status-proc damage event also involves block (any
  // blocked > 0). The block-absorbed/broken visual on PLAYER target
  // is immediate by default — for proc damage the particles take
  // TRAIL_ARRIVAL_MS to fly to the block badge, so the shield effect
  // should land WITH them, not at t=0 while particles are still in
  // flight. Consumed by the next block-absorbed/broken event handler.
  private pendingProcBlockDelay = false

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
  // Set on each match-found from event.blessed; read by the immediately-
  // following pool-gained events for that same match so the pool trail
  // can mix gold accents in alongside the gem-color particles. Per-match
  // (resets on every match-found), not per-cascade — a single match-found
  // with blessed=true triggers blessed-style trails for its own pool
  // credits regardless of the rest of the cascade.
  private currentMatchBlessed = false

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

  // Level-start intro: every sprite already lives at its final cell center
  // (BoardScene.buildSprites snaps them on construction). Offset each upward
  // and tween back down with the same per-cell jitter + distance-scaled fall
  // time the cascade refill uses. Per-column delay is a deterministic shuffle
  // (not a left-to-right wave) so the board doesn't read as a single sheet
  // sliding down — each column starts its own waterfall.
  async playInitialFill(): Promise<void> {
    const prev = this.playing
    const next = (async () => {
      await prev
      this.busy = true
      try {
        const promises: Promise<void>[] = []
        const height = this.sprites.length
        const width = this.sprites[0]?.length ?? 0
        const columnOrder = shuffledColumnOrder(width)
        // Deepest gem's fall time — used to schedule the per-column drop SFX
        // event so the thunk lands with that column's bottom-row touchdown.
        const deepestFallMs = Math.max(
          DROP_MIN_FALL_MS,
          DROP_PER_CELL_MS * height,
        )
        for (let x = 0; x < width; x++) {
          const slot = columnOrder[x] ?? 0
          const columnDelay = slot * INITIAL_FILL_COLUMN_STEP_MS
          for (let y = 0; y < height; y++) {
            const sprite = this.sprites[y]?.[x]
            if (!sprite) continue
            const target = this.geometry.cellCenter(x, y)
            sprite.y = target.y - this.geometry.cellSize * (y + 1)
            const distance = y + 1
            const fallMs = Math.max(
              DROP_MIN_FALL_MS,
              DROP_PER_CELL_MS * distance,
            )
            const delay = columnDelay + dropJitterMs(x, y)
            const tween = () => tweenDrop(sprite, target.x, target.y, fallMs)
            promises.push(delay > 0 ? wait(delay).then(tween) : tween())
          }
          // One drop thunk per column at touchdown. Captured in a local so
          // the closure doesn't reference the loop variable.
          const col = x
          void wait(columnDelay + deepestFallMs).then(() =>
            emitGameEvent({ kind: 'board-intro-landed', column: col }),
          )
        }
        await Promise.all(promises)
      } finally {
        this.busy = false
      }
    })()
    this.playing = next
    return next
  }

  // End-of-fight flourish: every remaining sprite falls off the bottom
  // of the board. Used as a clean transition into the victory/game-over
  // modal — the board "clears" in service of the result beat instead of
  // just freezing in place. Per-column shuffled delay gives it a
  // waterfall feel; runs through the same chained `playing` promise so
  // back-to-back calls serialize and don't tangle with a play() in
  // flight. Caller is responsible for checking prefers-reduced-motion;
  // this method always runs the tweens.
  async sweepBoard(): Promise<void> {
    const prev = this.playing
    const next = (async () => {
      await prev
      this.busy = true
      try {
        // Cell-anchored overlays (burning flames) listen for this and
        // clear their decorations so they don't hang in mid-air after
        // the gems drop away.
        emitGameEvent({ kind: 'board-swept' })
        const height = this.sprites.length
        const width = this.sprites[0]?.length ?? 0
        const columnOrder = shuffledColumnOrder(width)
        // Fall distance: each sprite drops past the bottom of the
        // board. Distance = (height - y) cells + 1 buffer so it
        // visibly exits before the tween ends.
        const promises: Promise<void>[] = []
        for (let x = 0; x < width; x++) {
          const columnDelay =
            (columnOrder[x] ?? 0) * INITIAL_FILL_COLUMN_STEP_MS
          for (let y = 0; y < height; y++) {
            const sprite = this.sprites[y]?.[x]
            if (!sprite) continue
            // Clear the slot so a follow-up fight rebuild starts clean
            // (BoardScene's fightCounter watcher will repopulate).
            this.setSprite({ x, y }, null)
            const start = this.geometry.cellCenter(x, y)
            const distance = height - y + 1
            const targetY = start.y + this.geometry.cellSize * distance
            const fallMs = Math.max(
              DROP_MIN_FALL_MS,
              DROP_PER_CELL_MS * distance,
            )
            const delay = columnDelay + dropJitterMs(x, y)
            const tween = () =>
              tweenDrop(sprite, start.x, targetY, fallMs).then(() => {
                // Once off-screen, free the sprite — no further use.
                sprite.destroy()
              })
            promises.push(delay > 0 ? wait(delay).then(tween) : tween())
          }
        }
        await Promise.all(promises)
      } finally {
        this.busy = false
      }
    })()
    this.playing = next
    return next
  }

  async play(events: GameEvent[]): Promise<void> {
    // Chain onto any in-flight playback so concurrent calls serialize cleanly.
    const prev = this.playing
    const next = (async () => {
      await prev
      this.busy = true
      try {
        for (let i = 0; i < events.length; i++) {
          // Dev step-mode gate. No-op in prod (awaitStep returns a
          // resolved Promise when step mode is off). Placed BEFORE the
          // event so the user always sees the next event clearly
          // labelled in their head before pressing Step.
          if (i > 0) await awaitStep()
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
        // Latch the blessed flag for the pool-gained events that follow.
        // The store emits match-found → its pool-gained colors → next
        // match-found, so a per-match latch is enough to associate trails
        // with their originating match.
        this.currentMatchBlessed = event.blessed === true
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
        this.spawnPoolTrail(event.color, this.currentMatchBlessed)
        if (event.color !== 'red' && event.color !== 'green') {
          this.spawnPoolArrivalPopup(event.color, event.amount)
        }
        return
      case 'damage-dealt': {
        // Status-effect tick proc (e.g. Burn on an enemy): treat the
        // status chip as the attacker — particles fly chip → enemy
        // frame, damage popup arrives with them. The popup is tinted
        // by status so a Burn tick reads as fire damage, not a generic
        // red `-N` floating off the enemy.
        const procKind = statusKindFromDamageSource(event.source)
        if (procKind && (event.amount > 0 || event.blocked > 0)) {
          // Proc damage on this enemy. Fire one trail per subsystem
          // that took a hit (HP and/or block) so the chip visibly
          // splits its impact across whichever bars ate it.
          if (event.amount > 0) {
            this.spawnStatusProcTrail(
              event.targetId,
              procKind,
              event.amount,
              'hp',
            )
            this.scheduleDelayedDamagePopup(
              event.targetId,
              event.amount,
              procPopupTint(procKind),
            )
          }
          if (event.blocked > 0) {
            this.spawnStatusProcTrail(
              event.targetId,
              procKind,
              event.blocked,
              'block',
            )
          }
        } else if (event.source === 'player-attack') {
          // Per-match commit. Delay the popup so it lands at the same
          // moment the red gem trail arrives at the enemy.
          this.scheduleDelayedDamagePopup(event.targetId, event.amount)
        } else {
          this.spawnDamagePopup(event.targetId, event.amount)
        }
        await wait(BEAT.damageDealt)
        return
      }
      case 'healed':
        // Per-match commit. Delay the popup to sync with the green
        // trail's arrival at the HP bar.
        this.scheduleDelayedHealPopup(event.amount)
        await wait(BEAT.healed)
        return
      case 'damage-taken': {
        // Status-effect tick proc on the player (Burn etc.): chip →
        // HP particle trail + delayed popup. Whoosh SFX fires on the
        // event play; HP drain is delayed by the trail's arrival in
        // HUD.tsx. See statusKindFromDamageSource for the routing.
        // Popup tint matches the status so a Burn tick reads orange,
        // not the generic red used for normal hits.
        const procKind = statusKindFromDamageSource(event.source)
        if (procKind && (event.amount > 0 || event.blocked > 0)) {
          // Proc damage with HP and/or block components. Fire one
          // particle trail per subsystem that actually took a hit, so
          // the chip visibly distributes its damage to whichever bars
          // ate it. Partial-block ticks (some HP, some armor) get TWO
          // trails firing simultaneously from the chip; full-block
          // ticks get one chip → block trail; HP-only get one chip →
          // HP trail.
          if (event.amount > 0) {
            this.spawnStatusProcTrail('player', procKind, event.amount, 'hp')
            this.scheduleDelayedPlayerDamagePopup(
              event.amount,
              procPopupTint(procKind),
            )
            // Game-over after a proc DoT needs the HP drain to finish
            // landing before the defeat overlay covers the bar.
            this.pendingProcDelay = true
          }
          if (event.blocked > 0) {
            this.spawnStatusProcTrail('player', procKind, event.blocked, 'block')
            // Defer the shield visual + SFX for the upcoming
            // block-absorbed/broken event so it lands at trail
            // arrival, not at t=0 while particles are still in
            // flight. See block-absorbed/broken handlers below.
            this.pendingProcBlockDelay = true
          }
          await wait(event.amount > 0 ? BEAT.damageTaken : BEAT.blockedHit)
          return
        }
        if (event.amount > 0) {
          const pause = hitPauseMs(event.amount)
          if (pause > 0) await wait(pause)
          // Attack damage popup stays red even when an onHit rider is
          // present — the hit itself is regular damage, and the rider's
          // burn ticks (next player phase) get their own orange `-N` via
          // the proc path above. Tinting the attack popup orange merged
          // the two events visually; keeping them distinct lets the
          // player see the attack land, then later see the burn bite.
          this.spawnPlayerDamagePopup(event.amount)
          // Carrier-signal for attacks that apply a status: in-place
          // ember burst on the player frame instead of pool-style
          // particles flying from the enemy. The chip drops in shortly
          // after; the burst is what tells the eye "this hit was
          // fiery" without competing visually with the impact itself.
          if (event.onHitRider === 'burn') {
            this.spawnBurnImpactBurst('player')
          }
          await wait(BEAT.damageTaken)
        } else if (event.blocked > 0) {
          this.spawnPlayerBlockedPopup(event.blocked)
          await wait(BEAT.blockedHit)
        }
        return
      }
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
      case 'phase-changed': {
        // Game-over after a status-proc DoT (Burn tick to 0 HP) must
        // wait for the delayed HP drain to play out — the overlay
        // covers everything once it appears, so the bar drop is the
        // last beat the player sees of the fight.
        if (event.phase === 'game-over' && this.pendingProcDelay) {
          await wait(TRAIL_ARRIVAL_MS + 220)
        }
        this.pendingProcDelay = false
        await wait(phaseBeat(event.phase))
        return
      }
      case 'status-applied': {
        // Enemy-sourced riders (Smolder's onHit Burn): no traveling
        // trail. The impact itself carries the "fire" story via the
        // ember burst + orange halo on the player frame (see the
        // damage-taken handler), so adding pool-style particles flying
        // enemy → chip felt like a competing visual event. The chip
        // just drops in at TRAIL_ARRIVAL_MS (via HUD). Pool-style
        // particles ARE used for the later proc (chip → HP bar when
        // burn ticks), which is where they read clearly.
        if (event.source?.kind === 'enemy') return
        this.spawnStatusTrail(event)
        return
      }
      case 'status-ticked':
        await wait(BEAT.statusTicked)
        return
      case 'status-expired':
        await wait(BEAT.statusExpired)
        return
      case 'tile-burn-placed':
        // Generic "enemy verb → board cells" trail. Fires one trail per
        // affected cell from the casting enemy's frame to that cell's
        // screen center. Future verbs (Caster hex, Defender petrify,
        // Swarmer shove) plug into this same pattern with their own
        // palette + core hex.
        this.spawnVerbToCellsTrail(
          event.enemyId,
          event.cells,
          FLAME_PALETTE,
          FLAME_CORE_HEX,
        )
        return
      case 'tile-blessed-placed':
        // Match-5 reward beat. Fires after gems-spawned in the cascade
        // stream, so the cells have settled and the gold rim overlay is
        // about to appear — the callout reads as the "you earned this"
        // banner over the freshly blessed line.
        this.spawnBlessedCallout(event.cells)
        return
      case 'blessed-match-triggered':
        // A blessed gem just cleared. Fire a gold radial starburst at the
        // source cells so the moment of payoff is legible AT the gem
        // (the pool trails arrive at the HUD; the player's eye is on the
        // board). Fires concurrently with the standard gem-cleared
        // animation — adds intensity, doesn't replace it.
        this.spawnBlessedSourceBurst(event.cells)
        return
      case 'extra-turn-granted':
        this.spawnExtraTurnBannerBurst()
        await wait(BEAT.phaseToPlayer)
        return
      case 'block-absorbed':
        // Player target (enemy attack) usually fires synchronously with
        // damage-taken. But when a proc trail just spawned (burn tick
        // hitting block), the particles take TRAIL_ARRIVAL_MS to reach
        // the block badge, so the shield effect should land WITH them,
        // not at t=0. `pendingProcBlockDelay` is set in damage-taken's
        // proc branch above for exactly this case.
        // Enemy target (player attack) always needs the gem-trail
        // delay — its visual mirrors the red gem trail's arrival.
        if (event.targetId === 'player') {
          if (this.pendingProcBlockDelay) {
            this.pendingProcBlockDelay = false
            scheduleAtTrailArrival(() =>
              this.spawnShieldEffect('player', 'absorbed'),
            )
          } else {
            this.spawnShieldEffect(event.targetId, 'absorbed')
          }
        } else {
          const targetId = event.targetId
          scheduleAtTrailArrival(() =>
            this.spawnShieldEffect(targetId, 'absorbed'),
          )
        }
        return
      case 'block-broken':
        if (event.targetId === 'player') {
          if (this.pendingProcBlockDelay) {
            this.pendingProcBlockDelay = false
            scheduleAtTrailArrival(() =>
              this.spawnShieldEffect('player', 'broken'),
            )
          } else {
            this.spawnShieldEffect(event.targetId, 'broken')
          }
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

  // Match-5 reward beat. "BLESSED!" anchored at the line centroid, sitting
  // a hair above the cells so it doesn't overlap with the gold rim that
  // BlessedOverlay paints onto the same positions a frame later. Gold
  // (cascadeGold) ties the text visually to the rim. Bigger + longer-life
  // than the standard match callout — match-5 is rare, lean into it.
  private spawnBlessedCallout(cells: Pos[]): void {
    const overlay = this.overlay
    if (!overlay) return
    const center = centroidOf(cells)
    if (!center) return
    const at = this.cellScreenCenter(center)
    if (!at) return
    const textAt = { x: at.x, y: at.y - 20 }
    overlay.spawnFloatingText(textAt, 'BLESSED!', {
      ...WORD_POP,
      color: VISUAL.cascadeGold,
      fontSize: 42,
      lifeMs: 950,
      driftY: -48,
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
  private scheduleDelayedDamagePopup(
    enemyId: string,
    amount: number,
    color?: number,
  ): void {
    if (amount <= 0) return
    scheduleAtTrailArrival(() => {
      this.spawnDamagePopup(enemyId, amount, color)
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

  private spawnPoolTrail(color: GemColor, blessed = false): void {
    const overlay = this.overlay
    if (!overlay) return
    const cells = this.lastMatchCells.get(color)
    if (!cells || cells.length === 0) return
    const source = cells[Math.floor(cells.length / 2)] ?? cells[0]
    if (!source) return
    const from = this.cellScreenCenter(source)
    if (!from) return

    // H3: each pool-gained match fires TWO trails from the source cell —
    // a primary flock to the immediate-effect target (enemy / block /
    // HP / charge) and a smaller secondary flock to the colour mana
    // chip. The split lets the player see both "this is happening now"
    // (effect) and "this is being saved" (mana) without losing either
    // visual story. Yellow and purple skip the secondary — yellow's
    // effect target IS the mana chip, and purple has no mana chip.
    const effectAttractor: Attractor = () => {
      // `:not(.dead)` is a belt-and-braces guard on top of EnemyFrame's
      // hp-based gate: if for any reason the attribute lingers on a
      // dying frame, the flock just falls through to "no attractor"
      // (particles freeze) instead of homing onto a corpse.
      const el = this.findEl(`[data-pool-target="${color}"]:not(.dead)`)
      return el ? elementCenter(el) : null
    }
    const hasSecondary = color !== 'purple' && color !== 'yellow'
    const manaAttractor: Attractor | null = hasSecondary
      ? () => {
          const el = this.findEl(`[data-mana-target="${color}"]`)
          return el ? elementCenter(el) : null
        }
      : null

    if (blessed) {
      // Blessed trail = the same flock as a normal pool trail (5
      // particles, gem-color dominant) with a light gold accent: one
      // cascade-gold entry mixed into a 4-entry palette so ~1 in 4
      // particles flickers gold, and a bright gold-white core replaces
      // pearl. Reads as "the same particles, lit by something" rather
      // than swapping out the flock — the pool identity stays intact.
      const palette: number[] = [
        POOL_TRAIL_HEX[color],
        POOL_TRAIL_HEX[color],
        POOL_TRAIL_HEX[color],
        0xfacc15,
      ]
      overlay.spawnTrail(from, effectAttractor, palette, 5, BLESSED_CORE_HEX)
      if (manaAttractor) {
        overlay.spawnTrail(from, manaAttractor, palette, 3, BLESSED_CORE_HEX)
      }
    } else {
      overlay.spawnTrail(from, effectAttractor, color, 5)
      if (manaAttractor) {
        overlay.spawnTrail(from, manaAttractor, color, 3)
      }
    }
  }

  // Gold radial starburst fired at the source cells when a blessed gem
  // clears. Reads as the "ka-blam" of the blessed payoff — the trail
  // alone is too subtle because the player's eye is following the gem
  // clear animation, not tracking trails across the screen. Each call
  // fires two overlapping bursts in different gold tones for a richer
  // multi-hue starburst than a single-color burst can produce.
  private spawnBlessedSourceBurst(cells: Pos[]): void {
    const overlay = this.overlay
    if (!overlay) return
    for (const c of cells) {
      const at = this.cellScreenCenter(c)
      if (!at) continue
      // Outer ring — bright cascade gold, wider speed range.
      overlay.spawnBurst(at, 0xfacc15, {
        count: 14,
        speedMin: 120,
        speedMax: 240,
        radiusMin: 2.5,
        radiusMax: 4.5,
        lifeMs: 600,
        gravity: 60,
        spread: 0.7,
      })
      // Inner pale-gold puff — slower, smaller, longer life so the
      // afterglow lingers a beat after the outer ring fades.
      overlay.spawnBurst(at, 0xffe9a3, {
        count: 8,
        speedMin: 50,
        speedMax: 110,
        radiusMin: 1.5,
        radiusMax: 3,
        lifeMs: 780,
        gravity: 30,
        spread: 0.6,
      })
    }
  }

  // Particle trail from an enemy → each affected board cell. Used by
  // Smolder's tile-burn and by future board-verb casts. The cells are
  // snapshot once at fire time — if a cell shifts via gravity, the
  // trail still lands at its original screen position, which matches
  // where the flame/flag appears on the board.
  // Status-effect "proc" trail: the status chip behaves like an attacker
  // and throws particles at its host. Used for any DoT damage source
  // (Burn now; future Poison / Bleed slot in via STATUS_TRAIL + the
  // statusKindFromDamageSource mapping). `target` is 'player' or an
  // enemy id; the chip is found via `data-status-chip` + the target's
  // parent frame ([data-player-hud] / [data-enemy-id]).
  private spawnStatusProcTrail(
    target: 'player' | string,
    kind: 'burn' | 'vulnerable' | 'weak',
    amount: number,
    destination: 'hp' | 'block' = 'hp',
  ): void {
    const overlay = this.overlay
    if (!overlay) return
    const parentSel =
      target === 'player'
        ? '[data-player-hud]'
        : `[data-enemy-id="${target}"]`
    const chip = this.findEl(`${parentSel} [data-status-chip="${kind}"]`)
    const parentEl = this.findEl(parentSel)
    const from = chip ? elementCenter(chip) : null
    if (!from) return
    // Route the particles to whichever subsystem actually took the
    // hit — HP bar for damage that broke through, block badge when
    // armor ate it all. Without this, a fully-blocked proc fired no
    // trail at all (the chip ticked silently), losing the "where did
    // the damage go" feedback. Lock the destination at spawn so a
    // bar/badge reflow doesn't redirect particles mid-flight.
    const destEl: HTMLElement | null =
      destination === 'block'
        ? target === 'player'
          ? this.findEl(`${parentSel} [data-pool-target="blue"]`)
          : this.findEl(`${parentSel} .enemy-block-badge`)
        : target === 'player'
          ? this.findEl(`${parentSel} [data-pool-target="green"]`)
          : this.findEl(`${parentSel} .enemy-hp-bar`)
    const lockedTarget = destEl
      ? elementCenter(destEl)
      : parentEl
        ? elementCenter(parentEl)
        : null
    if (!lockedTarget) return
    const attractor: Attractor = () => lockedTarget
    const look = STATUS_TRAIL[kind]
    const count = particleCountForImpact(amount)
    overlay.spawnTrail(from, attractor, look.palette, count, look.core)
  }

  // Delayed player damage popup — fires at trail-arrival time so the
  // popup lands with the chip-to-HP particles, mirroring the per-match
  // damage-dealt path for enemy targets.
  private scheduleDelayedPlayerDamagePopup(
    amount: number,
    color?: number,
  ): void {
    if (amount <= 0) return
    scheduleAtTrailArrival(() => this.spawnPlayerDamagePopup(amount, color))
  }

  // In-place fire impact on the target frame. The "carrier signal" for
  // attacks that apply a burn status — no pool-style trail, just a
  // localized fire flash on the impact point. Composition:
  //
  //   1. Wide amber radial — the flame jumping outward (gravity-down).
  //   2. Tight molten core — the heat lingering on the target.
  //   3. Rising embers — negative-gravity sparks that drift up afterward
  //      ("the fire smolders on you"). Longer-lived than the radial.
  //   4. Delayed lingering-flame burst — fires +120ms after the main
  //      burst as a smaller follow-up so the impact reads as ongoing
  //      flame rather than a single instant.
  //
  // The CSS halo on the HUD frame (.hud.burn-impact) wraps the whole
  // composition with a brief orange glow.
  private spawnBurnImpactBurst(target: 'player' | string): void {
    const overlay = this.overlay
    if (!overlay) return
    const parentSel =
      target === 'player'
        ? '[data-player-hud]'
        : `[data-enemy-id="${target}"]`
    const el = this.findEl(parentSel)
    const center = el ? elementCenter(el) : null
    if (!center) return
    // 1. Wide amber radial — main flash
    overlay.spawnBurst(center, 0xff8540, {
      count: 14,
      speedMin: 130,
      speedMax: 260,
      radiusMin: 2.5,
      radiusMax: 5,
      lifeMs: 520,
      gravity: 90,
      spread: 0.5,
    })
    // 2. Molten core — bright heart
    overlay.spawnBurst(center, FLAME_CORE_HEX, {
      count: 8,
      speedMin: 50,
      speedMax: 130,
      radiusMin: 2,
      radiusMax: 4,
      lifeMs: 420,
      gravity: 40,
      spread: 0.7,
    })
    // 3. Rising embers — negative gravity so sparks drift upward like
    //    real embers off a fresh flame. Longer life so they linger
    //    after the main burst dies.
    overlay.spawnBurst(center, 0xff9034, {
      count: 7,
      speedMin: 30,
      speedMax: 90,
      radiusMin: 1.5,
      radiusMax: 2.5,
      lifeMs: 780,
      gravity: -110,
      spread: 0.9,
    })
    // 4. Delayed lingering-flame burst — +120ms, smaller, more amber.
    //    Sells "the fire is still on you" beyond the initial flash.
    window.setTimeout(() => {
      const ov2 = this.overlay
      if (!ov2) return
      const el2 = this.findEl(parentSel)
      const c2 = (el2 ? elementCenter(el2) : null) ?? center
      ov2.spawnBurst(c2, 0xffc15c, {
        count: 6,
        speedMin: 40,
        speedMax: 110,
        radiusMin: 2,
        radiusMax: 3.5,
        lifeMs: 460,
        gravity: -40,
        spread: 0.8,
      })
    }, 120)
  }

  private spawnVerbToCellsTrail(
    enemyId: string,
    cells: readonly Pos[],
    palette: number | readonly number[],
    innerHex?: number,
  ): void {
    const overlay = this.overlay
    if (!overlay) return
    const el = this.findEl(`[data-enemy-id="${enemyId}"]`)
    const from = el ? elementCenter(el) : null
    if (!from) return
    for (const cell of cells) {
      const dest = this.cellScreenCenter(cell)
      if (!dest) continue
      // Snapshotted destination — verb-cell trails don't track DOM
      // reflow because the cells aren't DOM nodes; they're Pixi-space.
      const attractor: Attractor = () => dest
      // 5 particles per cell — flock reads as fire without overwhelming
      // a multi-tile cast (4 cells × 5 = 20 still feels substantial
      // without dominating the per-match cues that follow).
      overlay.spawnTrail(from, attractor, palette, 5, innerHex)
    }
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
    const statusKind = event.status.kind
    const parentSel =
      target === 'player'
        ? '[data-player-hud]'
        : `[data-enemy-id="${target}"]`
    // Resolve the destination ONCE at spawn time and lock it. Aim at
    // the chip if it's already mounted; otherwise the status-bar row
    // (where the chip will mount once HUD inserts it at
    // TRAIL_ARRIVAL_MS). Falling back to the parent frame would aim at
    // the HP bar, which misreads as "fire damages your HP" — the
    // status apply doesn't deal HP damage, it deposits a chip.
    const chipEl = this.findEl(
      `${parentSel} [data-status-chip="${statusKind}"]`,
    )
    const statusBarEl = this.findEl(`${parentSel} .status-bar`)
    const parentEl = this.findEl(parentSel)
    const lockedTarget =
      (chipEl ? elementCenter(chipEl) : null) ??
      (statusBarEl ? elementCenter(statusBarEl) : null) ??
      (parentEl ? elementCenter(parentEl) : null)
    if (!lockedTarget) return
    const attractor: Attractor = () => lockedTarget

    // Per-status palette + molten core, matching the proc trail's look.
    // Particle count scales with magnitude (apply uses `stacks` —
    // 1-stack hits look light, 3-stack matches feel heavier).
    const look = STATUS_TRAIL[statusKind]
    const count = particleCountForImpact(event.status.stacks)
    overlay.spawnTrail(from, attractor, look.palette, count, look.core)
  }

  private spawnDamagePopup(
    enemyId: string,
    amount: number,
    color: number = VISUAL.damageRed,
  ): void {
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
        color,
        fontSize: 30,
        lifeMs: 800,
        driftY: -75,
        growBy: 0.3,
      },
    )
  }

  private spawnPlayerDamagePopup(
    amount: number,
    color: number = VISUAL.damageRed,
  ): void {
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
        color,
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
