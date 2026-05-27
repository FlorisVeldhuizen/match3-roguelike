import { Sprite, type Container } from 'pixi.js'
import {
  applyBoardGemColor,
  createBoardGemSprite,
  type GemBoardSprite,
  type GemBoardVisuals,
} from '../gems/visuals'
import type {
  GameEvent,
  GemColor,
  MatchShape,
  PendingSpellId,
  Pos,
  SpellEffectLeg,
  SpellEffectPalette,
  StatusKind,
} from '../types'
import { BOARD_WIDTH } from '../types'
import { useGameStore } from '../core/state/store'
import { tweenSwap } from './animations/swap'
import { tweenClear } from './animations/clear'
import { tweenDrop } from './animations/drop'
import { tweenShoveArc } from './animations/shove'
import { emitGameEvent, subscribeGameEvents } from '../core/events/emitter'
import type { ManaSpendColor } from '../core/combat/mana'
import { readSpellVisualBeat } from '../core/combat/spellVisual'
import { awaitStep, getTimeScale } from '../debug/devControls'
import { statusKindFromDamageSource } from '../core/combat/statuses'
import { shoveHueAtIndex, shoveHueFor } from '../core/combat/shoveHues'
import {
  TRAIL_ARRIVAL_MS,
  scheduleAtTrailArrival,
  type TrailPoint,
  SWAP_MS,
  DROP_PER_CELL_MS,
  DROP_MIN_FALL_MS,
} from '../timing'
import { emitTrailScheduled, scheduleAtTrailSpawn } from '../trails/sync'
import type { TrailScheduledEvent } from '../types'
import { elementCenter, type Attractor, type OverlayScene, type ScreenPoint } from './OverlayScene'

const CLEAR_MS = 280
// Deterministic per-gem delay (0–24ms) to desynchronize same-distance falls.
function dropJitterMs(x: number, y: number): number {
  return (x * 17 + y * 31) % 25
}
// Cosmetic shuffle — gameplay determinism is unaffected.
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
const HIT_STOP_MS = 80

// Events emitted together at end-of-enemy-turn so intents reveal in one frame.
const TELEGRAPH_BATCH_KINDS = new Set<GameEvent['kind']>([
  'intent-telegraphed',
  'enemy-block-gained',
  'column-smash-placed',
  'color-hex-placed',
  'color-drain-placed',
  'cluster-shove-placed',
  'petrify-placed',
  'tile-burn-placed',
])
const SHOVE_FLIGHT_MS = 420

function hitPauseMs(amount: number): number {
  if (amount >= 5) return 110
  if (amount >= 3) return 55
  return 0
}

// Per-event breath durations (ms). Per-match events kept short to avoid
// dead time during multi-hit cascades.
const BEAT = {
  damageDealt: 60,
  blockGained: 240,
  healed: 60,
  blockedHit: 280,
  enemyStaggered: 520,
  damageTaken: 440,
  enemyBlockGained: 320,
  intentTelegraphed: 80,
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

// Scaled by dev time-scale; production (scale=1) behaves like plain setTimeout.
const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms / getTimeScale()))

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

function popScaleCurve(progress: number): number {
  if (progress < 0.6) return 1.45 + (0.92 - 1.45) * (progress / 0.6)
  return 0.92 + (1.0 - 0.92) * ((progress - 0.6) / 0.4)
}

// Brighter gem-color variants for callout text against the dark board.
const CALLOUT_PALETTE: Record<GemColor, number> = {
  red: 0xff7068,
  blue: 0x7ab8ff,
  green: 0x68e599,
  yellow: 0xf5d650,
  purple: 0xc080ff,
  gold: 0xffd76a,
}

const VISUAL = {
  cascadeGold: 0xfacc15,
  damageRed: 0xee5e57,
  shieldBlue: 0x9ec5ff,
  burnEmber: 0xff8540, // distinct from damageRed for fire-source popups
  vulnerableOrange: 0xc47e3c,
  weakPale: 0xc9b896,
  regenGreen: 0x6fb86d,
  strengthGold: 0xd4a847,
} as const

const FLAME_PALETTE: readonly number[] = [0xc4423c, 0xee5e57, 0xff9034, 0xffc15c] as const
const FLAME_CORE_HEX = 0xffe39a

const HEX_PALETTE: readonly number[] = [0x6b21a8, 0x9333ea, 0xa855f7, 0xd8b4fe] as const
const HEX_CORE_HEX = 0xeed6ff
const DRAIN_PALETTE: readonly number[] = [0x7f1d1d, 0xb91c1c, 0xdc2626, 0xf87171] as const
const DRAIN_CORE_HEX = 0xffd6d6

const STONE_PALETTE: readonly number[] = [0x4a5260, 0x6b7888, 0x96a4b8] as const
const STONE_CORE_HEX = 0xd6dde7
const FROZEN_WALL_PALETTE: readonly number[] = [0x2a6a8a, 0x4a9ec4, 0x8ed4f0] as const
const FROZEN_WALL_CORE_HEX = 0xe8f8ff

const BLESSED_CORE_HEX = 0xfff5d6
// Keep in sync with OverlayScene's COLOR_HEX.
const POOL_TRAIL_HEX: Record<GemColor, number> = {
  red: 0xee5e57,
  blue: 0x4f9dff,
  green: 0x4dd581,
  yellow: 0xf5cf3a,
  purple: 0xb074ff,
  gold: 0xffc94a,
}

type StatusTrailLook = { palette: readonly number[]; core: number }
const STATUS_TRAIL: Record<StatusKind, StatusTrailLook> = {
  burn: { palette: FLAME_PALETTE, core: FLAME_CORE_HEX },
  vulnerable: { palette: [VISUAL.vulnerableOrange], core: 0xffffff },
  weak: { palette: [VISUAL.weakPale], core: 0xffffff },
  regen: { palette: [VISUAL.regenGreen], core: 0xffffff },
  strength: { palette: [VISUAL.strengthGold], core: 0xffffff },
}

// Adding a new DoT: extend this union + DamageSource + statusKindFromDamageSource.
type ProcStatusKind = 'burn'

function procPopupTint(kind: ProcStatusKind): number {
  switch (kind) {
    case 'burn':
      return VISUAL.burnEmber
  }
}

// Scales particle count with impact magnitude, capped at 8.
function particleCountForImpact(magnitude: number): number {
  return Math.max(3, Math.min(8, 3 + Math.max(1, magnitude)))
}

// Matches HUD pool backgrounds for "+N" popup consistency.
const STORED_HEX: Record<GemColor, number> = {
  red: 0xb84a44,
  blue: 0x6b9bd6,
  green: 0x5fb87a,
  yellow: 0xe6b830,
  purple: 0xa46be3,
  gold: 0xd4a020,
}

function cascadeCalloutText(displayLevel: number): string {
  return `×${displayLevel}`
}

function damagePopupFontSize(amount: number): number {
  return 26 + Math.min(6, Math.max(0, amount - 3) * 2)
}

// chromatic=true by default (in-board); DEFEATED overrides to false.
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

// Screen-space centroid of upcoming match-found cells (anchors chain callout).
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

function matchCalloutText(size: number, shape: MatchShape): string | null {
  if (shape === 'T') return 'T-BURST!'
  if (shape === 'L') return 'L-FLARE!'
  if (shape !== 'line') return null
  if (size >= 5) return 'BOOM!'
  if (size === 4) return 'POW!'
  return null
}

export class AnimationController {
  private sprites: (Sprite | null)[][]
  private readonly geometry: BoardGeometry
  private readonly parent: Container
  private visuals: GemBoardVisuals
  private readonly cellScreenCenter: (pos: Pos) => { x: number; y: number } | null
  private overlay: OverlayScene | null = null
  private playing: Promise<void> = Promise.resolve()
  private busy = false
  // Game-over after a proc DoT needs to wait for the delayed HP drain
  // to finish before the defeat overlay covers the bar.
  private pendingSpellAttackPopups = new Map<string, number>()
  private pendingProcDelay = false
  // Proc block trails schedule shield FX on trail-scheduled arrival.
  private pendingProcBlockDelay = false
  private pendingProcShieldFx: 'absorbed' | 'broken' | null = null

  private cellColor = new Map<string, GemColor>()
  private lastMatchCells = new Map<GemColor, Pos[]>()
  private lastCalloutTiltSign = 0
  // Exponential decay (1.5s half-life). Drives intensity escalation:
  // bigger font at ≥2, screenshake at ≥3, flame burst at ≥4.
  private heat = 0
  private heatLastTimestamp = 0
  private domCache = new Map<string, HTMLElement>()
  private currentCascadeLevel = 0
  // Per-match latch (not per-cascade) — blessed pool trails mix gold accents.
  private currentMatchBlessed = false
  // Shoved source cells suppress burst FX in the following gems-cleared
  // (the gem visibly flew off — a burst on top would double-read).
  private shovedSources = new Set<string>()
  private spellCastUnsub: (() => void) | null = null

  constructor(opts: {
    parent: Container
    sprites: Sprite[][]
    geometry: BoardGeometry
    visuals: GemBoardVisuals
    cellScreenCenter: (pos: Pos) => { x: number; y: number } | null
  }) {
    this.parent = opts.parent
    this.sprites = opts.sprites.map((row) => row.slice() as (GemBoardSprite | null)[])
    this.geometry = opts.geometry
    this.visuals = opts.visuals
    this.cellScreenCenter = opts.cellScreenCenter
  }

  setGemVisuals(visuals: GemBoardVisuals): void {
    this.visuals = visuals
    const cells = useGameStore.getState().board.cells
    for (let y = 0; y < this.sprites.length; y++) {
      const row = this.sprites[y]
      if (!row) continue
      for (let x = 0; x < row.length; x++) {
        const old = row[x]
        const cell = cells[y]?.[x]
        if (!old || !cell) continue
        const parent = old.parent
        if (!parent) continue
        const { x: px, y: py, alpha } = old
        parent.removeChild(old)
        old.destroy()
        const neu = createBoardGemSprite(cell.gemColor, visuals, this.geometry.gemSize)
        neu.position.set(px, py)
        neu.alpha = alpha
        parent.addChild(neu)
        row[x] = neu
      }
    }
  }

  setOverlay(overlay: OverlayScene): void {
    this.overlay = overlay
    this.spellCastUnsub?.()
    this.spellCastUnsub = subscribeGameEvents((event) => {
      if (event.kind === 'spell-cast') {
        this.spawnSpellSpendTrails(event.spellId, event.spentColors)
      } else if (event.kind === 'spell-effect-trail') {
        this.scheduleSpellEffectTrails(event)
      } else if (event.kind === 'status-applied') {
        this.scheduleSpellStatusApplyImpact(event)
      }
    })
  }

  dispose(): void {
    this.spellCastUnsub?.()
    this.spellCastUnsub = null
    this.overlay = null
  }

  get isAnimating(): boolean {
    return this.busy
  }

  peekSprite(pos: Pos): Sprite | null {
    return this.getSprite(pos)
  }

  // Per-column shuffled delay so the board doesn't read as a single sheet.
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
        const deepestFallMs = Math.max(DROP_MIN_FALL_MS, DROP_PER_CELL_MS * height)
        for (let x = 0; x < width; x++) {
          const slot = columnOrder[x] ?? 0
          const columnDelay = slot * INITIAL_FILL_COLUMN_STEP_MS
          for (let y = 0; y < height; y++) {
            const sprite = this.sprites[y]?.[x]
            if (!sprite) continue
            const target = this.geometry.cellCenter(x, y)
            sprite.y = target.y - this.geometry.cellSize * (y + 1)
            const distance = y + 1
            const fallMs = Math.max(DROP_MIN_FALL_MS, DROP_PER_CELL_MS * distance)
            const delay = columnDelay + dropJitterMs(x, y)
            const tween = () => tweenDrop(sprite, target.x, target.y, fallMs)
            promises.push(delay > 0 ? wait(delay).then(tween) : tween())
          }
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

  // Caller is responsible for checking prefers-reduced-motion.
  async sweepBoard(): Promise<void> {
    const prev = this.playing
    const next = (async () => {
      await prev
      this.busy = true
      try {
        emitGameEvent({ kind: 'board-swept' })
        const height = this.sprites.length
        const width = this.sprites[0]?.length ?? 0
        const columnOrder = shuffledColumnOrder(width)
        const promises: Promise<void>[] = []
        for (let x = 0; x < width; x++) {
          const columnDelay = (columnOrder[x] ?? 0) * INITIAL_FILL_COLUMN_STEP_MS
          for (let y = 0; y < height; y++) {
            const sprite = this.sprites[y]?.[x]
            if (!sprite) continue
            this.setSprite({ x, y }, null)
            const start = this.geometry.cellCenter(x, y)
            const distance = height - y + 1
            const targetY = start.y + this.geometry.cellSize * distance
            const fallMs = Math.max(DROP_MIN_FALL_MS, DROP_PER_CELL_MS * distance)
            const delay = columnDelay + dropJitterMs(x, y)
            const tween = () =>
              tweenDrop(sprite, start.x, targetY, fallMs).then(() => {
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
    const prev = this.playing
    const next = (async () => {
      await prev
      this.busy = true
      try {
        for (let i = 0; i < events.length; i++) {
          if (i > 0) await awaitStep()
          const event = events[i]
          if (!event) continue
          // Coalesce back-to-back fall+spawn into one waterfall animation.
          const peek = events[i + 1]
          if (event.kind === 'gems-fell' && peek?.kind === 'gems-spawned') {
            emitGameEvent(event)
            emitGameEvent(peek)
            await Promise.all([this.animateFall(event.movements), this.animateSpawn(peek.spawns)])
            i++
            continue
          }
          // Look ahead to anchor chain callout on upcoming matches, not previous link.
          if (event.kind === 'cascade-start' && event.level >= 1) {
            const anchor = cascadeAnchorFromUpcoming(events, i + 1, (p) => this.cellScreenCenter(p))
            emitGameEvent(event)
            this.cellColor.clear()
            this.lastMatchCells.clear()
            this.currentCascadeLevel = event.level
            this.spawnCascadeCallout(event.level + 1, anchor)
            continue
          }
          // Emit trailing telegraph events in one frame with a shared beat.
          if (TELEGRAPH_BATCH_KINDS.has(event.kind)) {
            let allTelegraph = true
            for (let k = i; k < events.length; k++) {
              const e = events[k]
              if (!e) continue
              if (e.kind === 'phase-changed') continue
              if (!TELEGRAPH_BATCH_KINDS.has(e.kind)) {
                allTelegraph = false
                break
              }
            }
            if (allTelegraph) {
              while (i < events.length) {
                const e = events[i]
                if (!e || !TELEGRAPH_BATCH_KINDS.has(e.kind)) break
                emitGameEvent(e)
                if (e.kind === 'enemy-block-gained') {
                  this.spawnEnemyBlockPopup(e.enemyId, e.amount)
                } else if (e.kind === 'tile-burn-placed') {
                  this.spawnVerbToCellsTrail(e.enemyId, e.cells, FLAME_PALETTE, FLAME_CORE_HEX)
                }
                i++
              }
              await wait(BEAT.intentTelegraphed)
              // Back off by one — outer for-loop increments i.
              i--
              continue
            }
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
        this.cellColor.clear()
        this.lastMatchCells.clear()
        this.currentCascadeLevel = event.level
        return
      case 'cascade-complete':
        if (event.levels >= 2) this.spawnCascadeCelebration(event.levels)
        return
      case 'match-found':
        for (const c of event.cells) this.cellColor.set(keyOf(c), event.color)
        this.lastMatchCells.set(event.color, event.cells)
        this.currentMatchBlessed = event.blessed === true
        this.spawnMatchCallout(event.size, event.shape, event.color, event.cells)
        if (event.grantsExtraTurn) this.spawnExtraTurnCallout(event.cells)
        if (event.size >= 4) await wait(HIT_STOP_MS)
        return
      case 'gems-cleared': {
        const cells = this.shovedSources.size
          ? event.cells.filter((c) => !this.shovedSources.has(keyOf(c)))
          : event.cells
        this.shovedSources.clear()
        this.spawnBurstsForCells(cells)
        await this.animateClear(cells)
        return
      }
      case 'gems-fell':
        await this.animateFall(event.movements)
        return
      case 'gems-spawned':
        await this.animateSpawn(event.spawns)
        return
      case 'gems-transmuted':
        await this.animateGemsTransmuted(event.cells)
        return
      case 'board-shuffled':
        await this.animateShuffle(event.cells)
        return
      case 'pool-gained':
        this.spawnPoolTrail(event.color, this.currentMatchBlessed, event.amount)
        return
      case 'damage-dealt': {
        const procKind = statusKindFromDamageSource(event.source)
        if (procKind && (event.amount > 0 || event.blocked > 0)) {
          if (event.amount > 0) {
            this.spawnStatusProcTrail(event.targetId, procKind, event.amount, 'hp')
            // Popup fires on trail-scheduled in spawnStatusProcTrail.
          }
          if (event.blocked > 0) {
            this.spawnStatusProcTrail(event.targetId, procKind, event.blocked, 'block')
          }
        } else if (event.source === 'player-attack' && !readSpellVisualBeat(event)) {
          this.scheduleDelayedDamagePopup(event.targetId, event.amount)
        } else if (event.source === 'player-attack') {
          this.pendingSpellAttackPopups.set(event.targetId, event.amount)
        } else {
          this.spawnDamagePopup(event.targetId, event.amount)
        }
        await wait(BEAT.damageDealt)
        return
      }
      case 'healed':
        this.scheduleDelayedHealPopup(event.amount)
        await wait(BEAT.healed)
        return
      case 'damage-taken': {
        const procKind = statusKindFromDamageSource(event.source)
        if (procKind && (event.amount > 0 || event.blocked > 0)) {
          if (event.amount > 0) {
            this.spawnStatusProcTrail('player', procKind, event.amount, 'hp')
            // Popup fires on trail-scheduled in spawnStatusProcTrail.
            this.pendingProcDelay = true
          }
          if (event.blocked > 0) {
            this.spawnStatusProcTrail('player', procKind, event.blocked, 'block')
            this.pendingProcBlockDelay = true
          }
          await wait(event.amount > 0 ? BEAT.damageTaken : BEAT.blockedHit)
          return
        }
        if (event.amount > 0) {
          const pause = hitPauseMs(event.amount)
          if (pause > 0) await wait(pause)
          this.spawnPlayerDamagePopup(event.amount)
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
        // Burst lands when HP bar hits zero (trail arrival after damage-dealt).
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
        if (event.phase === 'game-over' && this.pendingProcDelay) {
          await wait(TRAIL_ARRIVAL_MS + 220)
        }
        this.pendingProcDelay = false
        await wait(phaseBeat(event.phase))
        return
      }
      case 'status-applied': {
        // Enemy-sourced riders skip the trail — the burn impact burst already
        // carries the visual. The chip drops in via HUD at TRAIL_ARRIVAL_MS.
        if (event.source?.kind === 'enemy') return
        // Immediate spells already fly spell → target via spell-effect-trail.
        if (readSpellVisualBeat(event)) return
        this.spawnStatusTrail(event)
        return
      }
      case 'status-ticked':
        await wait(BEAT.statusTicked)
        return
      case 'status-expired':
        await wait(BEAT.statusExpired)
        return
      case 'cluster-shove-resolved':
        await this.animateClusterShove(event.enemyId, event.moves)
        return
      case 'tile-burn-placed':
        this.spawnVerbToCellsTrail(
          event.enemyId,
          event.cells,
          FLAME_PALETTE,
          FLAME_CORE_HEX,
          'tile-burn',
        )
        return
      case 'color-hex-fired': {
        // Cells read from live store (hex targets a colour, not a fixed set).
        const board = useGameStore.getState().board.cells
        const cells: Pos[] = []
        for (let y = 0; y < board.length; y++) {
          const row = board[y]
          if (!row) continue
          for (let x = 0; x < row.length; x++) {
            if (row[x]?.gemColor === event.color) cells.push({ x, y })
          }
        }
        if (cells.length > 0) {
          this.spawnVerbToCellsTrail(event.enemyId, cells, HEX_PALETTE, HEX_CORE_HEX, 'color-hex')
        }
        return
      }
      case 'color-drain-fired': {
        const board = useGameStore.getState().board.cells
        const cells: Pos[] = []
        for (let y = 0; y < board.length; y++) {
          const row = board[y]
          if (!row) continue
          for (let x = 0; x < row.length; x++) {
            if (row[x]?.gemColor === event.color) cells.push({ x, y })
          }
        }
        if (cells.length > 0) {
          this.spawnVerbToCellsTrail(
            event.enemyId,
            cells,
            DRAIN_PALETTE,
            DRAIN_CORE_HEX,
            'color-drain',
          )
        }
        return
      }
      case 'petrify-fired': {
        const cells: Pos[] = []
        for (let x = 0; x < BOARD_WIDTH; x++) {
          cells.push({ x, y: event.row })
        }
        this.spawnVerbToCellsTrail(event.enemyId, cells, STONE_PALETTE, STONE_CORE_HEX, 'petrify')
        return
      }
      case 'frozen-wall-fired': {
        const cells: Pos[] = []
        for (let x = 0; x < BOARD_WIDTH; x++) {
          cells.push({ x, y: event.row })
        }
        this.spawnVerbToCellsTrail(
          'frozen-wall',
          cells,
          FROZEN_WALL_PALETTE,
          FROZEN_WALL_CORE_HEX,
          'frozen-wall',
        )
        return
      }
      case 'column-smash-resolved':
        // Magnitude between cascade-streak (0.6) and kill (1.6).
        emitGameEvent({ kind: 'screen-shake', magnitude: 1.1 })
        return
      case 'tile-blessed-placed':
        this.spawnBlessedCallout(event.cells)
        return
      case 'blessed-match-triggered':
        this.spawnBlessedSourceBurst(event.cells)
        return
      case 'extra-turn-granted':
        this.spawnExtraTurnBannerBurst()
        await wait(BEAT.phaseToPlayer)
        return
      case 'block-absorbed':
        if (event.targetId === 'player') {
          if (this.pendingProcBlockDelay) {
            this.pendingProcBlockDelay = false
            this.pendingProcShieldFx = 'absorbed'
          } else {
            this.spawnShieldEffect(event.targetId, 'absorbed')
          }
        } else {
          const targetId = event.targetId
          scheduleAtTrailArrival(() => this.spawnShieldEffect(targetId, 'absorbed'))
        }
        return
      case 'block-broken':
        if (event.targetId === 'player') {
          if (this.pendingProcBlockDelay) {
            this.pendingProcBlockDelay = false
            this.pendingProcShieldFx = 'broken'
          } else {
            this.spawnShieldEffect(event.targetId, 'broken')
          }
        } else {
          const targetId = event.targetId
          scheduleAtTrailArrival(() => this.spawnShieldEffect(targetId, 'broken'))
        }
        return
      case 'turn-ended':
      case 'screen-shake':
        return
    }
  }

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

  private publishTrail(
    meta: Omit<TrailScheduledEvent, 'kind' | 'arrivalMs'>,
    spawn: () => number,
  ): number {
    const arrivalMs = spawn()
    emitTrailScheduled({ ...meta, arrivalMs })
    return arrivalMs
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

  private async animateFall(movements: { from: Pos; to: Pos }[]): Promise<void> {
    const moves = movements
      .map(({ from, to }) => ({ sprite: this.getSprite(from), from, to }))
      .filter((m): m is { sprite: Sprite; from: Pos; to: Pos } => m.sprite !== null)
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

  // Source cells vacated up-front so gems-cleared finds null (no double-destroy).
  private async animateClusterShove(
    enemyId: string,
    moves: { source: Pos; destination: Pos; color: GemColor }[],
  ): Promise<void> {
    if (moves.length === 0) return
    type Flight = { sprite: Sprite; destination: Pos }
    const flights: Flight[] = []
    for (const m of moves) {
      const sprite = this.getSprite(m.source)
      if (!sprite) continue
      this.setSprite(m.source, null)
      this.shovedSources.add(keyOf(m.source))
      flights.push({ sprite, destination: m.destination })
    }
    if (flights.length === 0) return
    await Promise.all(
      flights.map(({ sprite, destination }) => {
        const target = this.geometry.cellCenter(destination.x, destination.y)
        return tweenShoveArc(sprite, target.x, target.y, SHOVE_FLIGHT_MS)
      }),
    )
    // Commit after all flights so concurrent shoves don't trip over each other.
    for (const { sprite, destination } of flights) {
      const old = this.getSprite(destination)
      if (old) {
        this.parent.removeChild(old)
        old.destroy()
      }
      this.setSprite(destination, sprite)
    }
    this.spawnShoveLandingBursts(
      enemyId,
      flights.map((f) => f.destination),
    )
  }

  private hueToHex(hue: number): number {
    const s = 0.85
    const l = 0.65
    const k = (n: number) => (n + hue / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    const r = Math.round(f(0) * 255)
    const g = Math.round(f(8) * 255)
    const b = Math.round(f(4) * 255)
    return (r << 16) | (g << 8) | b
  }

  private spawnShoveLandingBursts(enemyId: string, destinations: Pos[]): void {
    const overlay = this.overlay
    if (!overlay) return
    const enemies = useGameStore.getState().fight.enemies
    const hue = shoveHueFor(enemies, enemyId) ?? shoveHueAtIndex(0)
    const hex = this.hueToHex(hue)
    for (const dst of destinations) {
      const at = this.cellScreenCenter(dst)
      if (!at) continue
      overlay.spawnBurst(at, hex, {
        count: 8,
        speedMin: 55,
        speedMax: 130,
        radiusMin: 1.6,
        radiusMax: 3.2,
        lifeMs: 360,
        gravity: 90,
        spread: 0.9,
      })
    }
  }

  private async animateGemsTransmuted(cells: { at: Pos; color: GemColor }[]): Promise<void> {
    for (const { at, color } of cells) {
      const sprite = this.getSprite(at)
      if (!sprite) continue
      applyBoardGemColor(sprite, color, this.visuals, this.geometry.gemSize)
    }
    await wait(240)
  }

  private async animateShuffle(cells: { at: Pos; color: GemColor }[]): Promise<void> {
    this.spawnNoMovesCallout()
    emitGameEvent({ kind: 'screen-shake', magnitude: 0.6 })
    await wait(360)
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
    overlay.spawnFloatingText({ x: center.x, y: center.y + 38 }, 'reshuffling…', {
      color: 0xffffff,
      fontSize: 22,
      lifeMs: 900,
      driftY: -10,
      growBy: 0.1,
      chromatic: true,
    })
  }

  private async animateSpawn(spawns: { at: Pos; color: GemColor }[]): Promise<void> {
    const promises: Promise<void>[] = []
    const created: { sprite: Sprite; pos: Pos }[] = []
    for (const { at, color } of spawns) {
      const sprite = createBoardGemSprite(color, this.visuals, this.geometry.gemSize)
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

  private spawnCascadeCallout(displayLevel: number, anchor: { x: number; y: number } | null): void {
    const overlay = this.overlay
    if (!overlay) return
    const center = anchor ?? this.cellScreenCenter({ x: 3.5, y: -1 })
    if (!center) return
    const heat = this.bumpHeat()
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
      overlay.spawnSparkle(center, 4 + Math.floor((heat - 1) * 1.5))
    }
    // Shake driven off cascade depth (not heat) so each link is guaranteed
    // more intense than the last.
    const streakMag = Math.min(1.75, 0.15 + 0.4 * (displayLevel - 1))
    emitGameEvent({ kind: 'screen-shake', magnitude: streakMag })
    if (heat >= 4) {
      overlay.spawnFlame(center, 7 + Math.floor(heat))
    }
  }

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
      if (!tier2) o.spawnSparkle(center, 8 + extra * 4)
    }, 200)
  }

  private spawnMatchCallout(size: number, shape: MatchShape, color: GemColor, cells: Pos[]): void {
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

  private spawnExtraTurnCallout(cells: Pos[]): void {
    const overlay = this.overlay
    if (!overlay) return
    const center = centroidOf(cells)
    if (!center) return
    const at = this.cellScreenCenter(center)
    if (!at) return
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
      overlay.spawnFloatingText({ x: center.x, y: center.y - 12 }, 'DEFEATED', {
        ...WORD_POP,
        chromatic: false,
        color: VISUAL.cascadeGold,
        fontSize: 34,
        lifeMs: 1050,
        driftY: -55,
        rotationFrom: this.nextTiltRadians(),
      })
    }
    emitGameEvent({ kind: 'screen-shake', magnitude: 1.6 })
  }

  // Alternating ±2-6° tilt so consecutive callouts never lean same direction.
  private nextTiltRadians(): number {
    const sign =
      this.lastCalloutTiltSign !== 0 ? -this.lastCalloutTiltSign : Math.random() < 0.5 ? -1 : 1
    this.lastCalloutTiltSign = sign
    const tiltDeg = (2 + Math.random() * 4) * sign
    return (tiltDeg * Math.PI) / 180
  }

  private spawnPoolArrivalPopup(color: GemColor, amount: number): void {
    if (amount <= 0) return
    const overlay = this.overlay
    if (!overlay) return
    const el = this.findEl(`[data-pool-target="${color}"]`)
    if (!el) return
    const center = elementCenter(el)
    if (!center) return
    const isDamage = color === 'red'
    const text = isDamage ? `-${amount}` : `+${amount}`
    const popupColor = STORED_HEX[color]
    overlay.spawnFloatingText({ x: center.x, y: center.y - 18 }, text, {
      color: popupColor,
      fontSize: damagePopupFontSize(amount),
      lifeMs: 720,
      driftY: -52,
      growBy: 0.25,
    })
  }

  private scheduleDelayedDamagePopup(
    enemyId: string,
    amount: number,
    color?: number,
    arrivalMs: number = TRAIL_ARRIVAL_MS,
  ): void {
    if (amount <= 0) return
    scheduleAtTrailArrival(() => {
      this.spawnDamagePopup(enemyId, amount, color)
    }, arrivalMs)
  }

  private scheduleDelayedHealPopup(amount: number, arrivalMs: number = TRAIL_ARRIVAL_MS): void {
    if (amount <= 0) return
    scheduleAtTrailArrival(() => {
      const overlay = this.overlay
      if (!overlay) return
      const el = this.findEl('[data-pool-target="green"]')
      if (!el) return
      const center = elementCenter(el)
      if (!center) return
      overlay.spawnFloatingText({ x: center.x, y: center.y - 18 }, `+${amount}`, {
        color: STORED_HEX.green,
        fontSize: damagePopupFontSize(amount),
        lifeMs: 720,
        driftY: -52,
        growBy: 0.25,
      })
    }, arrivalMs)
  }

  private scheduleSpellEffectTrails(event: GameEvent & { kind: 'spell-effect-trail' }): void {
    window.setTimeout(() => {
      this.spawnSpellEffectTrails(event.spellId, event.legs)
    }, event.trailStartMs)
  }

  private paletteForSpellEffect(palette: SpellEffectPalette): {
    colors: readonly number[]
    core: number
  } {
    switch (palette) {
      case 'burn':
        return { colors: STATUS_TRAIL.burn.palette, core: STATUS_TRAIL.burn.core }
      case 'vulnerable':
        return {
          colors: STATUS_TRAIL.vulnerable.palette,
          core: STATUS_TRAIL.vulnerable.core,
        }
      case 'regen':
        return { colors: STATUS_TRAIL.regen.palette, core: STATUS_TRAIL.regen.core }
      case 'weak':
        return { colors: STATUS_TRAIL.weak.palette, core: STATUS_TRAIL.weak.core }
      case 'strength':
        return {
          colors: STATUS_TRAIL.strength.palette,
          core: STATUS_TRAIL.strength.core,
        }
      case 'attack':
        return { colors: [POOL_TRAIL_HEX.red], core: 0xffffff }
      case 'heal':
        return { colors: [POOL_TRAIL_HEX.green], core: 0xffffff }
    }
  }

  private attractorForSpellLeg(leg: SpellEffectLeg): Attractor | null {
    const { dest } = leg
    if (dest.kind === 'player') {
      const hud = '[data-player-hud]'
      if (dest.slot === 'hp') {
        const el = this.findEl(`${hud} [data-pool-target="green"]`)
        return el ? () => elementCenter(el) : null
      }
      if (dest.slot === 'block') {
        const el = this.findEl(`${hud} [data-pool-target="blue"]`)
        return el ? () => elementCenter(el) : null
      }
      const chip = this.findEl(`${hud} [data-status-chip]`)
      const bar = this.findEl(`${hud} .status-bar`)
      const el = chip ?? bar
      return el ? () => elementCenter(el) : null
    }
    if (dest.kind === 'enemy') {
      const root = `[data-enemy-id="${dest.enemyId}"]`
      if (dest.slot === 'hp') {
        const el = this.findEl(`${root} .enemy-hp-bar`)
        const frame = this.findEl(root)
        const target = el ?? frame
        return target ? () => elementCenter(target) : null
      }
      const chip = this.findEl(`${root} [data-status-chip]`)
      const frame = this.findEl(root)
      const target = chip ?? frame
      return target ? () => elementCenter(target) : null
    }
    return null
  }

  /** Spell card releases particles toward HP, status, block, etc. */
  private spawnSpellEffectTrails(spellId: PendingSpellId, legs: readonly SpellEffectLeg[]): void {
    const overlay = this.overlay
    if (!overlay) return
    const spellEl = this.findEl(`[data-spell-target="${spellId}"]`)
    const from = spellEl ? elementCenter(spellEl) : null
    if (!from) return

    for (const leg of legs) {
      const run = () => {
        const attractor = this.attractorForSpellLeg(leg)
        if (!attractor || !attractor()) return
        const { colors, core } = this.paletteForSpellEffect(leg.palette)
        const target =
          leg.dest.kind === 'player'
            ? 'player'
            : leg.dest.kind === 'enemy'
              ? leg.dest.enemyId
              : undefined
        const slot = leg.dest.kind === 'board' ? undefined : leg.dest.slot
        const arrivalMs = this.publishTrail(
          { purpose: 'spell-effect', spellId, target, slot },
          () =>
            overlay.spawnTrail(from, attractor, colors, 4, core, {
              purpose: 'spell-effect',
            }),
        )
        if (leg.palette === 'attack' && leg.dest.kind === 'enemy') {
          const enemyId = leg.dest.enemyId
          const amount = this.pendingSpellAttackPopups.get(enemyId)
          if (amount != null) {
            this.pendingSpellAttackPopups.delete(enemyId)
            scheduleAtTrailSpawn(arrivalMs, () => this.spawnDamagePopup(enemyId, amount))
          }
        }
      }
      const stagger = leg.staggerMs ?? 0
      if (stagger > 0) window.setTimeout(run, stagger)
      else run()
    }
  }

  /** Mana / charge leaves HUD pools and flows into the cast spell button. */
  private spawnSpellSpendTrails(
    spellId: PendingSpellId,
    spentColors: readonly ManaSpendColor[],
  ): void {
    const overlay = this.overlay
    if (!overlay) return
    const spellAttractor: Attractor = () => {
      const el = this.findEl(`[data-spell-target="${spellId}"]`)
      return el ? elementCenter(el) : null
    }
    if (!spellAttractor()) return

    for (const color of spentColors) {
      const sourceSelector =
        color === 'purple' ? '[data-pool-target="purple"]' : `[data-mana-target="${color}"]`
      const sourceEl = this.findEl(sourceSelector)
      const from = sourceEl ? elementCenter(sourceEl) : null
      if (!from) continue
      const trailColor: GemColor = color === 'purple' ? 'purple' : color
      this.publishTrail({ purpose: 'mana-spend', spellId, color: trailColor }, () =>
        overlay.spawnTrail(from, spellAttractor, trailColor, 3, 0xffffff, {
          purpose: 'mana-spend',
        }),
      )
    }
  }

  private spawnPoolTrail(color: GemColor, blessed = false, poolAmount = 0): void {
    const overlay = this.overlay
    if (!overlay) return
    const cells = this.lastMatchCells.get(color)
    if (!cells || cells.length === 0) return
    const source = cells[Math.floor(cells.length / 2)] ?? cells[0]
    if (!source) return
    const from = this.cellScreenCenter(source)
    if (!from) return
    // Primary trail → effect target; secondary trail → mana chip.
    const effectAttractor: Attractor = () => {
      const el = this.findEl(`[data-pool-target="${color}"]:not(.dead)`)
      return el ? elementCenter(el) : null
    }
    // Yellow/gold: chip IS the effect target; purple: no mana chip.
    const hasSecondary = color !== 'purple' && color !== 'yellow' && color !== 'gold'
    const manaAttractor: Attractor | null = hasSecondary
      ? () => {
          const el = this.findEl(`[data-mana-target="${color}"]`)
          return el ? elementCenter(el) : null
        }
      : null

    const poolOpts = { purpose: 'pool-earn' as const }
    const emitPoolEarn = (earnDest: 'effect' | 'mana', arrivalMs: number): void => {
      emitTrailScheduled({
        purpose: 'pool-earn',
        color,
        amount: poolAmount,
        earnDest,
        arrivalMs,
      })
    }

    if (blessed) {
      const palette: number[] = [
        POOL_TRAIL_HEX[color],
        POOL_TRAIL_HEX[color],
        POOL_TRAIL_HEX[color],
        0xfacc15,
      ]
      const effectArrival = overlay.spawnTrail(
        from,
        effectAttractor,
        palette,
        5,
        BLESSED_CORE_HEX,
        poolOpts,
      )
      emitPoolEarn('effect', effectArrival)
      this.schedulePoolArrivalPopup(color, poolAmount, effectArrival)
      if (manaAttractor) {
        const manaArrival = overlay.spawnTrail(
          from,
          manaAttractor,
          palette,
          3,
          BLESSED_CORE_HEX,
          poolOpts,
        )
        emitPoolEarn('mana', manaArrival)
      }
    } else {
      const effectArrival = overlay.spawnTrail(from, effectAttractor, color, 5, 0xffffff, poolOpts)
      emitPoolEarn('effect', effectArrival)
      this.schedulePoolArrivalPopup(color, poolAmount, effectArrival)
      if (manaAttractor) {
        const manaArrival = overlay.spawnTrail(from, manaAttractor, color, 3, 0xffffff, poolOpts)
        emitPoolEarn('mana', manaArrival)
      }
    }
  }

  private schedulePoolArrivalPopup(color: GemColor, amount: number, arrivalMs: number): void {
    if (amount <= 0 || color === 'red' || color === 'green') return
    scheduleAtTrailSpawn(arrivalMs, () => this.spawnPoolArrivalPopup(color, amount))
  }

  private spawnBlessedSourceBurst(cells: Pos[]): void {
    const overlay = this.overlay
    if (!overlay) return
    for (const c of cells) {
      const at = this.cellScreenCenter(c)
      if (!at) continue
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

  // Status chip → target bar particle trail for DoT procs.
  private spawnStatusProcTrail(
    target: 'player' | string,
    kind: ProcStatusKind,
    amount: number,
    destination: 'hp' | 'block' = 'hp',
  ): void {
    const overlay = this.overlay
    if (!overlay) return
    const parentSel = target === 'player' ? '[data-player-hud]' : `[data-enemy-id="${target}"]`
    const chip = this.findEl(`${parentSel} [data-status-chip="${kind}"]`)
    const parentEl = this.findEl(parentSel)
    const from = chip ? elementCenter(chip) : null
    if (!from) return
    // Lock destination at spawn so a reflow doesn't redirect mid-flight.
    const destEl: HTMLElement | null =
      destination === 'block'
        ? target === 'player'
          ? this.findEl(`${parentSel} [data-pool-target="blue"]`)
          : this.findEl(`${parentSel} .enemy-block-badge`)
        : target === 'player'
          ? this.findEl(`${parentSel} [data-pool-target="green"]`)
          : this.findEl(`${parentSel} .enemy-hp-bar`)
    const lockedTarget = destEl ? elementCenter(destEl) : parentEl ? elementCenter(parentEl) : null
    if (!lockedTarget) return
    const facet = destination === 'block' ? 'block' : 'damage'
    const attractor: Attractor = () => lockedTarget
    const look = STATUS_TRAIL[kind]!
    const count = particleCountForImpact(amount)
    const arrivalMs = this.publishTrail(
      {
        purpose: 'status-proc',
        target,
        statusKind: kind,
        procFacet: facet,
      },
      () =>
        overlay.spawnTrail(from, attractor, look.palette, count, look.core, {
          purpose: 'status-proc',
        }),
    )
    if (facet === 'damage' && amount > 0) {
      scheduleAtTrailSpawn(arrivalMs, () => {
        if (target === 'player') {
          this.spawnPlayerDamagePopup(amount, procPopupTint(kind))
        } else {
          this.spawnDamagePopup(target, amount, procPopupTint(kind))
        }
      })
    }
    if (facet === 'block' && target === 'player' && this.pendingProcBlockDelay) {
      scheduleAtTrailSpawn(arrivalMs, () => {
        if (!this.pendingProcBlockDelay) return
        this.pendingProcBlockDelay = false
        const fx = this.pendingProcShieldFx
        this.pendingProcShieldFx = null
        if (fx) this.spawnShieldEffect('player', fx)
      })
    }
  }

  private spawnBurnImpactBurst(target: 'player' | string): void {
    const overlay = this.overlay
    if (!overlay) return
    const parentSel = target === 'player' ? '[data-player-hud]' : `[data-enemy-id="${target}"]`
    const el = this.findEl(parentSel)
    const center = el ? elementCenter(el) : null
    if (!center) return
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
    // Negative gravity — embers drift upward.
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

  /** Enemy board verbs use `data-enemy-id`; player spells reuse the same id field with `data-spell-target`. */
  private verbTrailOrigin(actorId: string): ScreenPoint | null {
    const enemyEl = this.findEl(`[data-enemy-id="${actorId}"]`)
    if (enemyEl) return elementCenter(enemyEl)
    const spellEl = this.findEl(`[data-spell-target="${actorId}"]`)
    return spellEl ? elementCenter(spellEl) : null
  }

  private spawnVerbToCellsTrail(
    enemyId: string,
    cells: readonly Pos[],
    palette: number | readonly number[],
    innerHex?: number,
    verb?: TrailScheduledEvent['verb'],
  ): void {
    const overlay = this.overlay
    if (!overlay) return
    const from = this.verbTrailOrigin(enemyId)
    if (!from) return
    const trails: { cell: Pos; arrivalMs: number }[] = []
    for (const cell of cells) {
      const dest = this.cellScreenCenter(cell)
      if (!dest) continue
      const attractor: Attractor = () => dest
      const arrivalMs = overlay.spawnTrail(from, attractor, palette, 5, innerHex, {
        purpose: 'verb-to-board',
      })
      if (arrivalMs > 0) trails.push({ cell, arrivalMs })
    }
    if (!verb || trails.length === 0) return
    const maxArrival = Math.max(...trails.map((t) => t.arrivalMs))
    let burstEndScheduled = false
    for (const { cell, arrivalMs } of trails) {
      const verbBurstEnd =
        !burstEndScheduled && arrivalMs === maxArrival && (burstEndScheduled = true)
      emitTrailScheduled({
        purpose: 'verb-to-board',
        arrivalMs,
        target: enemyId,
        verb,
        at: cell,
        verbBurstEnd,
      })
    }
  }

  private statusTrailEndpoints(
    event: GameEvent & { kind: 'status-applied' },
  ): { from: TrailPoint; to: TrailPoint } | null {
    const source = event.source
    if (!source) return null

    let from: ScreenPoint | null = null
    if (source.kind === 'enemy') {
      const el = this.findEl(`[data-enemy-id="${source.enemyId}"]`)
      from = el ? elementCenter(el) : null
    } else if (source.kind === 'board-cells') {
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
    const to = this.statusApplyAnchor(event.target, event.status.kind)
    if (!from || !to) return null
    return { from, to }
  }

  private statusApplyAnchor(target: 'player' | string, statusKind: StatusKind): ScreenPoint | null {
    const parentSel = target === 'player' ? '[data-player-hud]' : `[data-enemy-id="${target}"]`
    const chipEl = this.findEl(`${parentSel} [data-status-chip="${statusKind}"]`)
    const statusBarEl = this.findEl(`${parentSel} .status-bar`)
    const parentEl = this.findEl(parentSel)
    return (
      (chipEl ? elementCenter(chipEl) : null) ??
      (statusBarEl ? elementCenter(statusBarEl) : null) ??
      (parentEl ? elementCenter(parentEl) : null)
    )
  }

  /** Spell / enemy riders — immediate spells use choreographed beat timing. */
  private scheduleSpellStatusApplyImpact(event: GameEvent & { kind: 'status-applied' }): void {
    if (event.source?.kind === 'enemy') {
      this.spawnStatusApplyImpact(event.target, event.status.kind, event.status.stacks)
      return
    }
    const beat = readSpellVisualBeat(event)
    if (!beat) return
    window.setTimeout(() => {
      this.spawnStatusApplyImpact(event.target, event.status.kind, event.status.stacks)
    }, beat.arriveMs)
  }

  /** Impact pop when a status lands (spells, hex, enemy riders, etc.). */
  private spawnStatusApplyImpact(
    target: 'player' | string,
    kind: StatusKind,
    stacks: number,
  ): void {
    const overlay = this.overlay
    if (!overlay) return
    const at = this.statusApplyAnchor(target, kind)
    if (!at) return
    const look = STATUS_TRAIL[kind]
    const primary = look.palette[0] ?? look.core
    const count = Math.max(6, particleCountForImpact(stacks) * 2)
    overlay.spawnBurst(at, primary, {
      count,
      speedMin: 95,
      speedMax: 200,
      radiusMin: 2,
      radiusMax: 4.2,
      lifeMs: 440,
      gravity: 75,
      spread: 0.9,
    })
    overlay.spawnBurst(at, look.core, {
      count: Math.max(4, Math.round(count * 0.5)),
      speedMin: 45,
      speedMax: 115,
      radiusMin: 1.4,
      radiusMax: 2.8,
      lifeMs: 380,
      gravity: 35,
      spread: 0.75,
    })
    if (kind === 'burn') {
      overlay.spawnBurst(at, FLAME_CORE_HEX, {
        count: 6,
        speedMin: 30,
        speedMax: 90,
        radiusMin: 1.2,
        radiusMax: 2.4,
        lifeMs: 540,
        gravity: -85,
        spread: 1,
      })
    }
  }

  private spawnStatusTrail(event: GameEvent & { kind: 'status-applied' }): void {
    const overlay = this.overlay
    if (!overlay) return
    const endpoints = this.statusTrailEndpoints(event)
    if (!endpoints) return

    const { from, to } = endpoints
    const statusKind = event.status.kind
    const attractor: Attractor = () => to
    const look = STATUS_TRAIL[statusKind]!
    const trailCount = particleCountForImpact(event.status.stacks)
    const arrivalMs = this.publishTrail(
      {
        purpose: 'status-apply',
        target: event.target,
        statusKind,
      },
      () =>
        overlay.spawnTrail(from, attractor, look.palette, trailCount, look.core, {
          purpose: 'status-apply',
        }),
    )
    scheduleAtTrailSpawn(arrivalMs, () =>
      this.spawnStatusApplyImpact(event.target, event.status.kind, event.status.stacks),
    )
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
    overlay.spawnFloatingText({ x: center.x, y: center.y - 30 }, `-${amount}`, {
      color,
      fontSize: 30,
      lifeMs: 800,
      driftY: -75,
      growBy: 0.3,
    })
  }

  private spawnPlayerDamagePopup(amount: number, color: number = VISUAL.damageRed): void {
    const overlay = this.overlay
    if (!overlay) return
    const el = this.findEl('[data-player-hud]')
    if (!el) return
    const center = elementCenter(el)
    if (!center) return
    overlay.spawnFloatingText({ x: center.x, y: center.y - 20 }, `-${amount}`, {
      color,
      fontSize: 30,
      lifeMs: 800,
      driftY: -70,
      growBy: 0.3,
    })
  }

  private spawnPlayerBlockedPopup(blocked: number): void {
    const overlay = this.overlay
    if (!overlay) return
    const el = this.findEl('[data-player-hud]')
    if (!el) return
    const center = elementCenter(el)
    if (!center) return
    overlay.spawnFloatingText({ x: center.x, y: center.y - 20 }, `-${blocked} 🛡`, {
      color: VISUAL.shieldBlue,
      fontSize: 24,
      lifeMs: 700,
      driftY: -55,
      growBy: 0.2,
    })
  }

  private spawnShieldEffect(targetId: string, kind: 'absorbed' | 'broken'): void {
    const overlay = this.overlay
    if (!overlay) return
    const selector = targetId === 'player' ? '[data-player-hud]' : `[data-enemy-id="${targetId}"]`
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
    overlay.spawnFloatingText({ x: center.x, y: center.y - 30 }, `+${amount} 🛡`, {
      color: VISUAL.shieldBlue,
      fontSize: 22,
      lifeMs: 750,
      driftY: -45,
      growBy: 0.2,
    })
  }
}
