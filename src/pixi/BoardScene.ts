import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Ticker,
  type Texture,
} from 'pixi.js'
import { useGameStore } from '../core/state/store'
import { type GemColor, GEM_COLORS, type Pos } from '../types'
import { createBoardInteraction } from './input'
import { AnimationController } from './AnimationController'
import { BoardEffects } from './BoardEffects'
import { emitGameEvent } from '../core/events/emitter'
import { isStarted, subscribeStarted } from '../splashState'
import {
  getTimeScale,
  onDebugSwap,
  subscribeTimeScale,
} from '../debug/devControls'
import { findAllValidSwaps } from '../core/board/generation'

// Idle-hint nudge: after this long without player activity, pulse a random
// pair of gems that swap into a match. New pair every NUDGE_CYCLE_MS.
const NUDGE_TRIGGER_MS = 7000
const NUDGE_PULSE_PERIOD_MS = 1000
// Multiple of NUDGE_PULSE_PERIOD_MS so cycle-expiry always lands on a sine
// zero — the release that follows runs for exactly one full period.
const NUDGE_CYCLE_MS = 3000
const NUDGE_SCALE_AMPLITUDE = 0.09
// Attack ramp: amplitude grows 0→1 over this many ms, cubic-eased, so the
// first bounces are subtle. Release length is dynamic — see startNudgeRelease.
const NUDGE_ATTACK_MS = 500
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

const CELL_SIZE = 64
const GEM_SIZE = 54
const BOARD_PADDING = 8
const BOARD_DIM = 8
const LOGICAL_SIZE = BOARD_PADDING * 2 + CELL_SIZE * BOARD_DIM

// Precomputed cell centers. tickFloat samples all 64 every frame and
// applyHoverState walks ~25 per pointermove; the inline `{x, y}` allocation
// added up.
const CELL_CENTERS: { x: number; y: number }[][] = Array.from(
  { length: BOARD_DIM },
  (_, y) =>
    Array.from({ length: BOARD_DIM }, (_, x) => ({
      x: x * CELL_SIZE + CELL_SIZE / 2,
      y: y * CELL_SIZE + CELL_SIZE / 2,
    })),
)
// Falls back to live computation for off-grid sample points (e.g. the
// {3.5, -1} anchor for callouts above the board).
const cellCenter = (x: number, y: number) =>
  CELL_CENTERS[y]?.[x] ?? {
    x: x * CELL_SIZE + CELL_SIZE / 2,
    y: y * CELL_SIZE + CELL_SIZE / 2,
  }

const inBounds = (p: Pos): boolean =>
  p.x >= 0 && p.x < BOARD_DIM && p.y >= 0 && p.y < BOARD_DIM

const samePos = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y

const pairKey = (a: Pos, b: Pos): string =>
  a.y * 1000 + a.x < b.y * 1000 + b.x
    ? `${a.x},${a.y}|${b.x},${b.y}`
    : `${b.x},${b.y}|${a.x},${a.y}`

type PointerState = {
  pointerId: number
  startCell: Pos
  startClientX: number
  startClientY: number
  lastClientX: number
  lastClientY: number
  everEscaped: boolean
}

const HOVER_EASE_RATE = 14 // halo alpha ease — exponential, no bounce on a glow
// Hover scale tracks its target via an under-damped spring so settling
// overshoots before resting — gives the return-to-rest a clear rubber-band
// feel. ω sets the natural period (slower = more time for the bounce to
// register); ζ < 1 picks the overshoot amount. With peak scale 1.12, the
// ramp-up overshoot caps at ~1.165 → 62.9px on a 54px gem in a 64px cell
// (still inside).
const HOVER_SPRING_OMEGA = 18
const HOVER_SPRING_ZETA = 0.42
const HOVER_HALO_PEAK_ALPHA = 0.4
// Pressed state dims the halo to half-strength — small but legible "click
// registered" feedback without overpowering the hover glow.
const HOVER_HALO_PRESSED_ALPHA = 0.22
// Subtle scale lift on hover/press — multipliers applied on top of each
// sprite's resting scale. Hover lifts slightly; pressing settles a touch
// like a button being pushed. The peak applies to the gem directly under
// the cursor; nearby gems get a smaller share via a smoothstep falloff so
// the whole neighborhood breathes toward the mouse.
const HOVER_SCALE_PEAK = 1.12
const HOVER_SCALE_PRESSED = 1.07
// Radius over which proximity-scale falls off from peak to 1.0. 1.5 cells
// reaches the four orthogonal neighbors (center-to-center distance = 1
// cell) clearly and tapers diagonals to a whisper. Sized so GEM_SIZE *
// HOVER_SCALE_PEAK stays well inside CELL_SIZE — gems never spill out.
const HOVER_PROXIMITY_RADIUS_PX = CELL_SIZE * 1.5

// Shimmer: a brief diagonal streak of light grazes a single random gem
// every so often. Frequency is board-wide, not per-gem. The streak is
// masked to the gem's silhouette and is sized to span the entire gem in
// any rotation so the whole face gets illuminated. Always sweeps the
// same direction (top-left → bottom-right) at the same angle for a
// consistent "polished gem" feel.
const SHIMMER_MIN_INTERVAL_MS = 1100
const SHIMMER_MAX_INTERVAL_MS = 2400
const SHIMMER_DURATION_MS = 900
const SHIMMER_PEAK_ALPHA = 0.6
// Streak is rotated so it sits at "\" relative to the cell (top-left to
// bottom-right). It sweeps perpendicular to itself — motion vector goes
// from the bottom-left corner of the cell up to the top-right corner.
// Together these produce the classic 45° polished-gem shine sweep.
const SHIMMER_STREAK_ROTATION = Math.PI / 4
const SHIMMER_MOTION_ANGLE = -Math.PI / 4
const SHIMMER_LEN_RATIO = 1.7 // comfortably ≥ gem diagonal so the streak
//                                covers the full gem length at any sweep position
const SHIMMER_WIDTH_PX = 6
const SHIMMER_SWEEP_RATIO = 1.5 // travel distance relative to cell size
//                                  (≈ cell diagonal so motion runs corner-to-corner)

// Idle "breathing" drift: each gem drifts on a sum of two sin components
// per axis with different periods, so the combined motion is quasi-periodic
// (never visibly repeats). Per-sprite phases are randomised on first sight
// so the board reads as a crowd of independent gems, not a synced pattern.
// Amplitude is intentionally sub-pixel-felt — meant to register as life, not
// as movement.
const FLOAT_AMPLITUDE_X_PX = 0.7
const FLOAT_AMPLITUDE_Y_PX = 0.85
const FLOAT_PERIOD_X1_MS = 6500
const FLOAT_PERIOD_X2_MS = 9800
const FLOAT_PERIOD_Y1_MS = 8500
const FLOAT_PERIOD_Y2_MS = 13100

type FloatPhases = {
  px1: number
  px2: number
  py1: number
  py2: number
  // Breath offset sampled at the sprite's first idle frame. We subtract
  // it from every later sample so the sprite starts at exactly cellCenter
  // and the breath eases in — without this, newly-spawned sprites jump to
  // a random sub-pixel offset on their first tick (visible as jitter at
  // the start of the player turn after a cascade fills new gems).
  initDx: number
  initDy: number
}

type HoverAnim = {
  sprite: Sprite
  // Resting scale captured at anim creation. Sprite scale is set via
  // width/height in buildSprites, so the underlying scale.x value depends
  // on the SVG texture's native size — we multiply this by targetScaleMul
  // each frame instead of assuming a base of 1.
  baseScale: number
  targetScaleMul: number
  currentScaleMul: number
  // Spring velocity — required to give settling an overshoot bounce.
  velScaleMul: number
}

type ShimmerInstance = {
  view: Graphics
  // CLONE of the gem sprite, used purely as a mask. Pixi removes whatever
  // object is assigned as a mask from normal rendering, so we can't reuse
  // the live gem sprite — we share its texture but render the original
  // intact. Cloned mask is owned by the shimmer and destroyed with it.
  maskClone: Sprite
  elapsed: number
  startX: number
  startY: number
  endX: number
  endY: number
}

function randomShimmerInterval(): number {
  return (
    SHIMMER_MIN_INTERVAL_MS +
    Math.random() * (SHIMMER_MAX_INTERVAL_MS - SHIMMER_MIN_INTERVAL_MS)
  )
}

export class BoardScene {
  private readonly mountEl: HTMLElement
  private app: Application | null = null
  private animator: AnimationController | null = null
  private selectionRing: Graphics | null = null
  private ghostRing: Graphics | null = null
  // Keyboard cursor: persists across uses so arrow keys resume from the
  // last position instead of resetting to center. `cursorVisible` controls
  // whether the ghost ring is rendered (hidden until first key press, and
  // can be dismissed with Escape without forgetting the position).
  private keyboardCursor: Pos | null = null
  private cursorVisible = false
  private disposed = false
  private unsubscribeSelection: (() => void) | null = null
  private unsubscribeRestart: (() => void) | null = null
  private detachPointer: (() => void) | null = null
  private detachKeyboard: (() => void) | null = null
  private detachRectInvalidation: (() => void) | null = null
  private detachVisibility: (() => void) | null = null
  private detachTimeScale: (() => void) | null = null
  private detachDebugSwap: (() => void) | null = null
  private unsubscribeStarted: (() => void) | null = null
  // Sprites built by the initial buildSprites pass. Stashed so the splash-
  // gated intro can flip their alpha back to 1 right before playInitialFill.
  private pendingIntroSprites: Sprite[][] | null = null
  private activePointer: PointerState | null = null
  // Canvas rect cached across calls; getBoundingClientRect is a sync layout
  // boundary that pointermove would otherwise hit at 100Hz.
  private cachedCanvasRect: DOMRect | null = null
  private overlay: import('./OverlayScene').OverlayScene | null = null
  private hoverHalo: Graphics | null = null
  private hoveredCell: Pos | null = null
  // Per-sprite scale-lift state. Holds entries for every sprite currently
  // inside the proximity radius (plus any stragglers still easing back to
  // rest).
  private hoverAnims = new Map<Sprite, HoverAnim>()
  private hoverHaloTargetAlpha = 0
  private hoverIsPressed = false
  // Cached pointer position in client coords so press state changes (which
  // happen without a pointermove) can re-run the proximity-scale pass with
  // the current cursor.
  private lastHoverClientX = 0
  private lastHoverClientY = 0
  private hasHoverPosition = false
  private boardLayer: Container | null = null
  private boardEffects: BoardEffects | null = null
  private activeShimmers: ShimmerInstance[] = []
  private shimmerCooldownMs = randomShimmerInterval()
  private floatElapsedMs = 0
  // Throttle idle breath to ~30Hz; sub-pixel amplitude makes 33ms cadence
  // invisible, and skips 64 cells × 4 sin() on alternate frames.
  private floatAccumMs = 0
  // Per-sprite random phases. WeakMap so destroyed sprites don't hold memory.
  private floatPhases = new WeakMap<Sprite, FloatPhases>()
  private effectsTickerCb: ((ticker: Ticker) => void) | null = null
  // Tracks last-set canvas cursor so the per-frame cursor update doesn't
  // write to style on every tick when nothing has changed.
  private lastCursor = ''
  // Idle-hint nudge state. idleMs counts up only when the player can act and
  // nothing is animating. Once it crosses the threshold, a random valid swap
  // is picked; cycleMs counts down to the next pick. lastPairKey avoids
  // re-picking the same pair back-to-back. pulseElapsedMs drives the sine
  // pulse on the two target sprites.
  private nudgeIdleMs = 0
  private nudgePair: { from: Pos; to: Pos } | null = null
  private nudgeCycleMs = 0
  private nudgeLastPairKey: string | null = null
  private nudgePulseElapsedMs = 0
  private nudgePulsingSprites: Array<{ sprite: Sprite; baseScale: number }> = []
  // Attack/release state. Attack: env eases 0→1 over NUDGE_ATTACK_MS.
  // Release: env eases 1→0 across a window that ENDS at the next sine
  // cycle boundary (pulseElapsed % PERIOD === 0, where sin === 0), so the
  // pulse always finishes on a clean wave completion. Both env and sin hit
  // zero at the same instant, so release at the boundary is invisible.
  private nudgeAttackElapsedMs = 0
  private nudgeIsReleasing = false
  private nudgeReleaseStartElapsedMs = 0
  private nudgeReleaseEndElapsedMs = 0
  // Swap list cached by cells reference. board.cells changes (new array) on
  // every store update, so identity check is both correct and free. Lets
  // mid-idle cycle picks skip the 128-detectMatches scan.
  private nudgeSwapCache: Array<{ from: Pos; to: Pos }> | null = null
  private nudgeSwapCacheCells: unknown = null

  constructor(mountEl: HTMLElement) {
    this.mountEl = mountEl
  }

  setOverlay(overlay: import('./OverlayScene').OverlayScene): void {
    this.overlay = overlay
    if (this.animator) this.animator.setOverlay(overlay)
  }

  // Stage-local center of a cell — same coordinate space the sprites live
  // in (BOARD_PADDING + cellCenter). Used by BoardEffects to anchor the
  // shockwave filter on the same point as the gem cluster that triggered it.
  // Supports fractional Pos for "board centre" lookups (e.g. {3.5, 3.5}).
  private cellToStage(pos: Pos): { x: number; y: number } | null {
    if (!this.boardLayer) return null
    const center = cellCenter(pos.x, pos.y)
    return {
      x: BOARD_PADDING + center.x,
      y: BOARD_PADDING + center.y,
    }
  }

  // Screen-space center of cell (x,y), accounting for board padding and the
  // canvas's CSS scaling. Returns null if the canvas isn't measurable yet.
  cellScreenCenter(pos: Pos): { x: number; y: number } | null {
    const rect = this.getCanvasRect()
    if (!rect) return null
    const center = cellCenter(pos.x, pos.y)
    const lx = BOARD_PADDING + center.x
    const ly = BOARD_PADDING + center.y
    return {
      x: rect.left + (lx / LOGICAL_SIZE) * rect.width,
      y: rect.top + (ly / LOGICAL_SIZE) * rect.height,
    }
  }

  private getCanvasRect(): DOMRect | null {
    if (this.cachedCanvasRect) return this.cachedCanvasRect
    const canvas = this.app?.canvas
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    this.cachedCanvasRect = rect
    return rect
  }

  // Capture-phase scroll catches inner scrollers (events don't bubble from
  // them); passive keeps us off the scroll critical path. ResizeObserver
  // chain catches layout shifts that DON'T fire window resize/scroll —
  // most commonly the relic tray wrapping to a second row between fights,
  // which makes a flex-column ancestor grow and translates the canvas
  // downward without resizing the canvas itself.
  //
  // We have to observe each ANCESTOR of the mount up to <body>, because:
  // - The mount's own size is pinned by the canvas inside (LOGICAL_SIZE),
  //   so it never reports a resize when the page reshuffles around it.
  // - On a tall-enough viewport, <body> stays at min-height: 100vh and
  //   never resizes either.
  // - But the flex-column ancestor (`.game`) DOES grow when its header
  //   child wraps, so observing the chain catches the layout shift.
  private attachRectInvalidation(): void {
    const invalidate = () => {
      this.cachedCanvasRect = null
    }
    window.addEventListener('resize', invalidate)
    window.addEventListener('scroll', invalidate, { capture: true, passive: true })
    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(invalidate)
      let node: HTMLElement | null = this.mountEl
      while (node) {
        resizeObserver.observe(node)
        if (node === document.body) break
        node = node.parentElement
      }
    }
    this.detachRectInvalidation = () => {
      window.removeEventListener('resize', invalidate)
      window.removeEventListener('scroll', invalidate, { capture: true })
      resizeObserver?.disconnect()
    }
  }

  // Stop Pixi tickers while the tab is hidden. Without this, RAF naturally
  // pauses but the AnimationController's setTimeout-based `wait()` between
  // events keeps firing (throttled to ~1s by the browser). The queue partly
  // advances while hidden and the visual catch-up on return reads as the
  // game playing itself — pawfessor saw this on the Discord demo. Pausing
  // both shared and app tickers blocks tween Promises, which the AC awaits,
  // which in turn halts the queue at the first tweened event.
  private attachVisibilityPause(app: Application): void {
    const onVisibility = () => {
      const ticker = app.ticker
      if (document.hidden) {
        Ticker.shared.stop()
        ticker.stop()
      } else {
        Ticker.shared.start()
        ticker.start()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    this.detachVisibility = () =>
      document.removeEventListener('visibilitychange', onVisibility)
  }

  // Dev tooling: time-scale + debug-swap subscriptions. Defaults to a
  // 1× scale (no-op in prod). Pixi's Ticker.speed scales deltaMS, so
  // setting it < 1 slows down all sprite tweens; the AC's setTimeout
  // wait() reads getTimeScale() directly. Both layers stay in sync.
  private attachDevControls(app: Application): void {
    const applyScale = (value: number) => {
      Ticker.shared.speed = value
      app.ticker.speed = value
    }
    applyScale(getTimeScale())
    this.detachTimeScale = subscribeTimeScale(applyScale)
    // DevTools triggers swaps via this bus instead of going through the
    // pointer/keyboard input path, so the request lands directly at
    // performSwap. Same animation pipeline as a real user swap.
    this.detachDebugSwap = onDebugSwap(({ from, to }) => {
      void this.performSwap(from, to)
    })
  }

  async init(): Promise<void> {
    const app = new Application()
    await app.init({
      width: LOGICAL_SIZE,
      height: LOGICAL_SIZE,
      background: '#161622',
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    })
    if (this.disposed) {
      app.destroy(true, { children: true, texture: false })
      return
    }
    this.app = app
    app.canvas.style.touchAction = 'none'
    this.mountEl.appendChild(app.canvas)

    const textures = await this.loadGemTextures()
    if (this.disposed) return

    const board = new Container()
    board.x = BOARD_PADDING
    board.y = BOARD_PADDING
    app.stage.addChild(board)

    this.drawBoardBackground(board)
    const sprites = this.buildSprites(board, textures)
    this.buildSelectionRing(board)
    this.buildHoverHalo(board)
    this.boardLayer = board
    this.animator = new AnimationController({
      parent: board,
      sprites,
      geometry: { cellSize: CELL_SIZE, gemSize: GEM_SIZE, cellCenter },
      textures,
      cellScreenCenter: (pos) => this.cellScreenCenter(pos),
    })
    if (this.overlay) this.animator.setOverlay(this.overlay)
    // Hide gems until the splash dismisses — they sit at their cell centers
    // post-buildSprites, but we don't want them visible while the splash
    // overlay is up. playPendingIntro flips alpha back to 1 right before
    // running the waterfall.
    for (const row of sprites) for (const s of row) s.alpha = 0
    this.pendingIntroSprites = sprites
    if (isStarted()) {
      this.playPendingIntro()
    } else {
      this.unsubscribeStarted = subscribeStarted(() => this.playPendingIntro())
    }
    this.subscribeSelection()
    this.attachPointerEvents(app.canvas)
    this.attachKeyboardEvents()
    this.attachRectInvalidation()
    this.attachVisibilityPause(app)
    this.attachDevControls(app)
    // Post-FX (bloom / RGB split / shockwave / CRT noise) — applied to the
    // stage so the board background, gems, shimmers, and halos all get the
    // same treatment. Constructed last so the filter chain wraps the fully
    // built display tree.
    this.boardEffects = new BoardEffects(app.stage, (pos) =>
      this.cellToStage(pos),
    )
    this.startEffectsTicker()
  }

  // Splash-gated intro: restore gem visibility and trigger the waterfall.
  // Called either immediately (if started already) or via subscribeStarted
  // when the user dismisses the splash. Guarded so a late splashState flip
  // after destroy() doesn't crash.
  private playPendingIntro(): void {
    if (this.disposed) return
    const sprites = this.pendingIntroSprites
    if (!sprites || !this.animator) return
    for (const row of sprites) for (const s of row) s.alpha = 1
    this.pendingIntroSprites = null
    this.unsubscribeStarted?.()
    this.unsubscribeStarted = null
    void this.animator.playInitialFill()
  }

  destroy(): void {
    this.disposed = true
    this.unsubscribeSelection?.()
    this.unsubscribeSelection = null
    this.unsubscribeStarted?.()
    this.unsubscribeStarted = null
    this.unsubscribeRestart?.()
    this.unsubscribeRestart = null
    this.detachPointer?.()
    this.detachPointer = null
    this.detachKeyboard?.()
    this.detachKeyboard = null
    this.detachRectInvalidation?.()
    this.detachRectInvalidation = null
    this.detachVisibility?.()
    this.detachVisibility = null
    this.detachTimeScale?.()
    this.detachTimeScale = null
    this.detachDebugSwap?.()
    this.detachDebugSwap = null
    this.cachedCanvasRect = null
    if (this.effectsTickerCb) Ticker.shared.remove(this.effectsTickerCb)
    this.effectsTickerCb = null
    this.boardEffects?.destroy()
    this.boardEffects = null
    if (this.app) {
      this.app.destroy(true, { children: true, texture: false })
      this.app = null
    }
    this.animator = null
    this.selectionRing = null
    this.ghostRing = null
    this.hoverHalo = null
    this.hoveredCell = null
    this.hoverIsPressed = false
    this.hasHoverPosition = false
    this.hoverAnims.clear()
    this.activeShimmers = []
    this.boardLayer = null
    this.activePointer = null
  }

  // In-place rebuild on restart. Tears down sprites + animator but keeps
  // the Pixi app, canvas, pointer wiring, ticker, and store subscriptions.
  private async rebuildBoard(): Promise<void> {
    const app = this.app
    const layer = this.boardLayer
    if (!app || !layer) return
    // Shimmers hold mask-clone refs to gem textures; dispose before the
    // underlying sprites are destroyed.
    for (const s of this.activeShimmers) this.disposeShimmer(s)
    this.activeShimmers = []
    for (const child of layer.children.slice()) {
      layer.removeChild(child)
      child.destroy({ children: true })
    }
    this.hoverAnims.clear()
    this.hoveredCell = null
    this.hoverHaloTargetAlpha = 0
    this.hasHoverPosition = false
    this.hoverIsPressed = false
    this.activePointer = null
    this.selectionRing = null
    this.ghostRing = null
    this.hoverHalo = null
    this.animator = null

    // Pixi Assets caches textures, so this resolves synchronously after
    // the first load.
    const textures = await this.loadGemTextures()
    if (this.disposed) return

    this.drawBoardBackground(layer)
    const sprites = this.buildSprites(layer, textures)
    this.buildSelectionRing(layer)
    this.buildHoverHalo(layer)

    this.animator = new AnimationController({
      parent: layer,
      sprites,
      geometry: { cellSize: CELL_SIZE, gemSize: GEM_SIZE, cellCenter },
      textures,
      cellScreenCenter: (pos) => this.cellScreenCenter(pos),
    })
    if (this.overlay) this.animator.setOverlay(this.overlay)
    this.updateSelectionRing()
    void this.animator.playInitialFill()
  }

  private async loadGemTextures(): Promise<Record<GemColor, Texture>> {
    const entries = await Promise.all(
      GEM_COLORS.map(async (color) => {
        const texture = await Assets.load<Texture>(`/gems/${color}.svg`)
        return [color, texture] as const
      }),
    )
    return Object.fromEntries(entries) as Record<GemColor, Texture>
  }

  private drawBoardBackground(parent: Container): void {
    const bg = new Graphics()
    for (let y = 0; y < BOARD_DIM; y++) {
      for (let x = 0; x < BOARD_DIM; x++) {
        const dark = (x + y) % 2 === 0
        bg.rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)
        bg.fill({ color: dark ? 0x1f1f2e : 0x252537 })
      }
    }
    parent.addChild(bg)
  }

  private buildSprites(
    parent: Container,
    textures: Record<GemColor, Texture>,
  ): Sprite[][] {
    const cells = useGameStore.getState().board.cells
    const sprites: Sprite[][] = []
    for (let y = 0; y < BOARD_DIM; y++) {
      const row: Sprite[] = []
      for (let x = 0; x < BOARD_DIM; x++) {
        const cell = cells[y]?.[x]
        if (!cell) throw new Error(`missing cell ${x},${y}`)
        const sprite = new Sprite(textures[cell.gemColor])
        sprite.anchor.set(0.5)
        sprite.width = GEM_SIZE
        sprite.height = GEM_SIZE
        const { x: px, y: py } = cellCenter(x, y)
        sprite.x = px
        sprite.y = py
        parent.addChild(sprite)
        row.push(sprite)
      }
      sprites.push(row)
    }
    return sprites
  }

  private buildSelectionRing(parent: Container): void {
    const inset = 3
    const ring = new Graphics()
    ring.roundRect(
      -CELL_SIZE / 2 + inset,
      -CELL_SIZE / 2 + inset,
      CELL_SIZE - inset * 2,
      CELL_SIZE - inset * 2,
      8,
    )
    ring.stroke({ color: 0xfacc15, width: 3, alignment: 0.5 })
    ring.visible = false
    parent.addChild(ring)
    this.selectionRing = ring

    const ghost = new Graphics()
    ghost.roundRect(
      -CELL_SIZE / 2 + inset,
      -CELL_SIZE / 2 + inset,
      CELL_SIZE - inset * 2,
      CELL_SIZE - inset * 2,
      8,
    )
    ghost.stroke({ color: 0xfacc15, width: 2, alignment: 0.5 })
    ghost.alpha = 0.45
    ghost.visible = false
    parent.addChild(ghost)
    this.ghostRing = ghost
  }

  private subscribeSelection(): void {
    // Scoped to board.selected — without this, the ring redrew on every
    // store mutation (every per-match damage commit during a cascade).
    // The drag-ghost ring updates separately via pointer handlers.
    let prevSelected = useGameStore.getState().board.selected
    this.unsubscribeSelection = useGameStore.subscribe((s) => {
      if (s.board.selected === prevSelected) return
      prevSelected = s.board.selected
      // Keyboard cursor follows pointer-driven selection so a mid-game
      // switch from mouse → keyboard resumes where the user last acted.
      if (s.board.selected) this.keyboardCursor = s.board.selected
      this.updateSelectionRing()
    })
    this.updateSelectionRing()
    // fightCounter bumps on any wholesale board swap (restart, accept-
    // reward → next fight, skip-reward → next fight). Rebuild sprites
    // in place from the new board state.
    let prevFightCounter = useGameStore.getState().fightCounter
    this.unsubscribeRestart = useGameStore.subscribe((s) => {
      if (s.fightCounter === prevFightCounter) return
      prevFightCounter = s.fightCounter
      void this.rebuildBoard()
    })
  }

  private updateSelectionRing(): void {
    const ring = this.selectionRing
    const ghost = this.ghostRing
    if (!ring || !ghost) return
    const active = this.activePointer
    const dragSource = active?.startCell ?? null
    const stored = useGameStore.getState().board.selected
    const pos = dragSource ?? stored
    if (pos) {
      const { x, y } = cellCenter(pos.x, pos.y)
      ring.x = x
      ring.y = y
      ring.visible = true
    } else {
      ring.visible = false
    }
    // Ghost ring shows either the drag-target preview (pointer) or the
    // keyboard cursor (when no pointer drag is active and no cell is
    // primed — the yellow selectionRing already covers the primed case).
    let ghostPos: Pos | null = null
    if (active) {
      ghostPos = this.computeDragTarget(active)
    } else if (this.cursorVisible && this.keyboardCursor && !stored) {
      ghostPos = this.keyboardCursor
    }
    if (ghostPos) {
      const { x, y } = cellCenter(ghostPos.x, ghostPos.y)
      ghost.x = x
      ghost.y = y
      ghost.visible = true
    } else {
      ghost.visible = false
    }
  }

  private computeDragTarget(active: PointerState): Pos | null {
    const hover = this.clientToCell(active.lastClientX, active.lastClientY)
    if (!hover || samePos(hover, active.startCell)) return null
    const dx = active.lastClientX - active.startClientX
    const dy = active.lastClientY - active.startClientY
    const dir: Pos =
      Math.abs(dx) > Math.abs(dy)
        ? { x: dx > 0 ? 1 : -1, y: 0 }
        : { x: 0, y: dy > 0 ? 1 : -1 }
    const target: Pos = {
      x: active.startCell.x + dir.x,
      y: active.startCell.y + dir.y,
    }
    return inBounds(target) ? target : null
  }

  private clientToCell(clientX: number, clientY: number): Pos | null {
    const rect = this.getCanvasRect()
    if (!rect) return null
    const logicalX = ((clientX - rect.left) * LOGICAL_SIZE) / rect.width
    const logicalY = ((clientY - rect.top) * LOGICAL_SIZE) / rect.height
    const bx = logicalX - BOARD_PADDING
    const by = logicalY - BOARD_PADDING
    if (bx < 0 || by < 0) return null
    const x = Math.floor(bx / CELL_SIZE)
    const y = Math.floor(by / CELL_SIZE)
    const pos = { x, y }
    return inBounds(pos) ? pos : null
  }

  private attachPointerEvents(canvas: HTMLCanvasElement): void {
    const interaction = createBoardInteraction({
      performSwap: (from, to) => this.performSwap(from, to),
      isAnimating: () => this.animator?.isAnimating ?? false,
    })

    const onPointerDown = (ev: PointerEvent) => {
      this.resetNudgeIdle()
      // Safety net: every drag starts with a fresh rect. The ResizeObserver
      // path covers the common cases (sibling growth, parent resize), but
      // one extra getBoundingClientRect at drag-start is cheap and means
      // pointer→cell mapping can't lag a layout shift the observer missed.
      this.cachedCanvasRect = null
      const cell = this.clientToCell(ev.clientX, ev.clientY)
      if (!cell) return
      canvas.setPointerCapture(ev.pointerId)
      this.activePointer = {
        pointerId: ev.pointerId,
        startCell: cell,
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        lastClientX: ev.clientX,
        lastClientY: ev.clientY,
        everEscaped: false,
      }
      // Keep the hover halo + lift alive through the click — the selection
      // ring fades in alongside it instead of replacing it. If the click
      // commits to a swap, animation start will clean up via tickEffects.
      // Mark pressed so the halo dims slightly: visible "click registered"
      // feedback without snapping the glow off.
      this.setPressed(true)
      this.updateSelectionRing()
    }

    const onPointerMove = (ev: PointerEvent) => {
      this.resetNudgeIdle()
      const active = this.activePointer
      if (active) {
        if (active.pointerId !== ev.pointerId) return
        active.lastClientX = ev.clientX
        active.lastClientY = ev.clientY
        if (!active.everEscaped) {
          const hover = this.clientToCell(ev.clientX, ev.clientY)
          if (hover && !samePos(hover, active.startCell)) {
            active.everEscaped = true
          }
        }
        this.updateSelectionRing()
        return
      }
      // No active drag → hover-track. Animations suppress hover so the
      // scale lift doesn't fight drop/swap tweens.
      if (this.animator?.isAnimating) {
        this.setHover(null)
        return
      }
      this.updateHoverFromPointer(ev.clientX, ev.clientY)
    }

    const onPointerLeave = () => {
      this.setHover(null)
    }

    const onPointerUp = (ev: PointerEvent) => {
      const active = this.activePointer
      if (!active || active.pointerId !== ev.pointerId) return
      active.lastClientX = ev.clientX
      active.lastClientY = ev.clientY
      const target = this.computeDragTarget(active)
      if (canvas.hasPointerCapture(ev.pointerId)) {
        canvas.releasePointerCapture(ev.pointerId)
      }
      this.activePointer = null
      this.setPressed(false)
      this.updateSelectionRing()

      if (target) {
        void interaction.dragSwap(active.startCell, target)
        return
      }
      if (active.everEscaped) return
      void interaction.click(active.startCell)
    }

    const onPointerCancel = (ev: PointerEvent) => {
      const active = this.activePointer
      if (!active || active.pointerId !== ev.pointerId) return
      if (canvas.hasPointerCapture(ev.pointerId)) {
        canvas.releasePointerCapture(ev.pointerId)
      }
      this.activePointer = null
      this.setPressed(false)
      this.updateSelectionRing()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.addEventListener('pointerleave', onPointerLeave)
    // Cursor is driven dynamically in tickEffects (pointer when actionable,
    // default during animation / victory).

    this.detachPointer = () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('pointerleave', onPointerLeave)
    }
  }

  // Keyboard alternative to pointer interaction. Mirrors the click model:
  //   Arrow / WASD:   move the keyboard cursor (first press just reveals it
  //                   at the remembered position; subsequent presses move)
  //   Space / Enter:  pick up the gem under the cursor (primes it for swap);
  //                   pressing again drops without swapping
  //   Arrow / WASD while primed: swap with the adjacent cell in that
  //                              direction (no Shift needed)
  //   Escape:         drop the pickup, or hide the cursor if not primed
  // The cursor position persists across uses, so arrows resume from the
  // last cell instead of resetting to center each turn.
  // Window-level so the canvas doesn't need focus; ignored when a form
  // control has focus.
  private attachKeyboardEvents(): void {
    const DIRS: Record<string, Pos> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 },
      W: { x: 0, y: -1 },
      s: { x: 0, y: 1 },
      S: { x: 0, y: 1 },
      a: { x: -1, y: 0 },
      A: { x: -1, y: 0 },
      d: { x: 1, y: 0 },
      D: { x: 1, y: 0 },
    }
    const isCommit = (key: string) => key === ' ' || key === 'Enter'
    const initCursor = (): Pos => {
      if (this.keyboardCursor) return this.keyboardCursor
      const mid = Math.floor(BOARD_DIM / 2)
      return { x: mid, y: mid }
    }
    const onKeyDown = (ev: KeyboardEvent) => {
      const t = ev.target
      if (
        t instanceof HTMLElement &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return
      }
      this.resetNudgeIdle()
      const store = useGameStore.getState()
      if (store.fight.phase === 'victory' || store.fight.phase === 'game-over')
        return
      if (this.animator?.isAnimating) return
      const primed = store.board.selected

      if (ev.key === 'Escape') {
        if (primed) {
          ev.preventDefault()
          store.selectCell(null)
        } else if (this.cursorVisible) {
          ev.preventDefault()
          this.cursorVisible = false
          this.updateSelectionRing()
        }
        return
      }

      if (isCommit(ev.key)) {
        ev.preventDefault()
        if (primed) {
          // Drop the pickup without swapping. Cursor stays put.
          store.selectCell(null)
          this.cursorVisible = true
          this.updateSelectionRing()
          return
        }
        const pos = initCursor()
        this.keyboardCursor = pos
        this.cursorVisible = true
        store.selectCell(pos)
        return
      }

      const dir = DIRS[ev.key]
      if (!dir) return
      // Don't hijack browser shortcuts like Cmd+W / Ctrl+S.
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return
      ev.preventDefault()

      if (primed) {
        const target: Pos = { x: primed.x + dir.x, y: primed.y + dir.y }
        if (!inBounds(target)) return
        store.selectCell(null)
        this.keyboardCursor = target
        this.cursorVisible = true
        this.updateSelectionRing()
        void this.performSwap(primed, target)
        return
      }

      if (!this.cursorVisible || !this.keyboardCursor) {
        // First press just reveals the cursor; the next press moves it.
        this.keyboardCursor = initCursor()
        this.cursorVisible = true
        this.updateSelectionRing()
        return
      }

      const next: Pos = {
        x: this.keyboardCursor.x + dir.x,
        y: this.keyboardCursor.y + dir.y,
      }
      if (!inBounds(next)) return
      this.keyboardCursor = next
      this.updateSelectionRing()
    }
    window.addEventListener('keydown', onKeyDown)
    this.detachKeyboard = () => window.removeEventListener('keydown', onKeyDown)
  }

  private async performSwap(from: Pos, to: Pos): Promise<void> {
    const animator = this.animator
    if (!animator || animator.isAnimating) return
    // Clear hover before the cascade plays so the lift/halo don't ghost
    // through cleared cells.
    this.setHover(null)
    const result = useGameStore.getState().attemptSwap(from, to)
    await animator.play(result.events)
  }

  // Soft glow halo: concentric white circles with stepped alpha fake a
  // radial falloff (Pixi Graphics has no native soft brush). Additively
  // blended so the gem reads as "lit," not "covered." Alpha is eased
  // per-frame in tickEffects.
  private buildHoverHalo(parent: Container): void {
    const halo = new Graphics()
    halo.circle(0, 0, CELL_SIZE * 0.85).fill({ color: 0xffffff, alpha: 0.04 })
    halo.circle(0, 0, CELL_SIZE * 0.68).fill({ color: 0xffffff, alpha: 0.07 })
    halo.circle(0, 0, CELL_SIZE * 0.54).fill({ color: 0xffffff, alpha: 0.11 })
    halo.circle(0, 0, CELL_SIZE * 0.4).fill({ color: 0xffffff, alpha: 0.17 })
    halo.blendMode = 'add'
    halo.alpha = 0
    halo.visible = false
    parent.addChild(halo)
    this.hoverHalo = halo
  }

  // Pointer-driven hover update. Caches the cursor position and runs the
  // proximity-scale pass.
  private updateHoverFromPointer(clientX: number, clientY: number): void {
    this.lastHoverClientX = clientX
    this.lastHoverClientY = clientY
    this.hasHoverPosition = true
    this.applyHoverState()
  }

  // Sweep gems within a small bounding window around the cursor cell and set
  // each one's hover scale by distance: the closest gem grows the most,
  // neighbors get a smaller share via a smoothstep falloff. Any anim that's
  // no longer in the window (sprite left the proximity field) is eased back
  // to rest.
  // Window is sized from the radius so only cells that could possibly be
  // within proximity are touched (~9–25 cells), not all 64.
  // Re-runs on every pointermove and on press-state changes.
  private applyHoverState(): void {
    if (!this.hasHoverPosition) return
    const rect = this.getCanvasRect()
    if (!rect) return
    const cell = this.clientToCell(this.lastHoverClientX, this.lastHoverClientY)
    if (!cell) {
      this.setHover(null)
      return
    }
    this.setHover(cell)
    const animator = this.animator
    if (!animator) return
    const logicalX =
      ((this.lastHoverClientX - rect.left) * LOGICAL_SIZE) / rect.width
    const logicalY =
      ((this.lastHoverClientY - rect.top) * LOGICAL_SIZE) / rect.height
    const localX = logicalX - BOARD_PADDING
    const localY = logicalY - BOARD_PADDING
    const peak = this.hoverIsPressed ? HOVER_SCALE_PRESSED : HOVER_SCALE_PEAK
    const radius = HOVER_PROXIMITY_RADIUS_PX
    // Worst-case ring of cells whose center could land within `radius` of
    // the cursor. Any further out and the smoothstep is guaranteed to be 0,
    // so we don't need to look.
    const maxOffset = Math.ceil(radius / CELL_SIZE)
    const minX = Math.max(0, cell.x - maxOffset)
    const maxX = Math.min(BOARD_DIM - 1, cell.x + maxOffset)
    const minY = Math.max(0, cell.y - maxOffset)
    const maxY = Math.min(BOARD_DIM - 1, cell.y + maxOffset)

    const visited = new Set<Sprite>()
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const sprite = animator.peekSprite({ x, y })
        if (!sprite) continue
        const center = cellCenter(x, y)
        const dx = localX - center.x
        const dy = localY - center.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        // Smoothstep falloff: 1 at the cursor, 0 at/beyond the radius. The
        // 3t² - 2t³ shape gives a soft start and end so neighboring gems
        // ease into the lift instead of snapping in at the radius edge.
        const t = dist >= radius ? 0 : 1 - dist / radius
        const tSmooth = t * t * (3 - 2 * t)
        const scaleMul = 1 + (peak - 1) * tSmooth
        if (scaleMul > 1.0005) {
          this.setHoverTarget(sprite, scaleMul)
          visited.add(sprite)
        }
      }
    }
    // Any existing anim outside the window — typically the sprite the cursor
    // just left — eases back to rest. The set is small (<= window size + a
    // couple of stragglers), so this loop is cheap.
    if (this.hoverAnims.size > visited.size) {
      for (const sprite of this.hoverAnims.keys()) {
        if (!visited.has(sprite)) this.releaseHoverTarget(sprite)
      }
    }
  }

  // Updates the hovered cell + halo position/alpha. Scales are owned by
  // applyHoverState (it sweeps a window around the cursor each call). When
  // the pointer leaves entirely (cell === null), every proximity-active
  // anim is eased back to rest.
  private setHover(cell: Pos | null): void {
    const prev = this.hoveredCell
    if (prev && cell && samePos(prev, cell)) return
    if (!prev && !cell) return
    if (!cell) {
      this.hasHoverPosition = false
      for (const sprite of this.hoverAnims.keys()) {
        this.releaseHoverTarget(sprite)
      }
      this.hoverHaloTargetAlpha = 0
    } else {
      this.hoverHaloTargetAlpha = this.hoverIsPressed
        ? HOVER_HALO_PRESSED_ALPHA
        : HOVER_HALO_PEAK_ALPHA
    }
    this.hoveredCell = cell
    const halo = this.hoverHalo
    if (halo && cell) {
      const { x, y } = cellCenter(cell.x, cell.y)
      halo.x = x
      halo.y = y
      halo.visible = true
    }
    // Broadcast to React overlays (e.g. BurningOverlay) so they can
    // react in sync with the gem hover beat. Fires only on cell-cross
    // transitions — the guard at the top of this method dedupes
    // same-cell mousemoves.
    emitGameEvent({ kind: 'board-hover', cell })
  }

  private setPressed(pressed: boolean): void {
    if (this.hoverIsPressed === pressed) return
    this.hoverIsPressed = pressed
    if (this.hoveredCell) {
      this.hoverHaloTargetAlpha = pressed
        ? HOVER_HALO_PRESSED_ALPHA
        : HOVER_HALO_PEAK_ALPHA
    }
    // Re-run proximity so neighbors pick up the press-dimmed peak too.
    if (this.hasHoverPosition) this.applyHoverState()
  }

  private setHoverTarget(sprite: Sprite, scaleMul: number): void {
    let anim = this.hoverAnims.get(sprite)
    if (!anim) {
      anim = {
        sprite,
        baseScale: sprite.scale.x,
        targetScaleMul: 1,
        currentScaleMul: 1,
        velScaleMul: 0,
      }
      this.hoverAnims.set(sprite, anim)
    }
    anim.targetScaleMul = scaleMul
  }

  private releaseHoverTarget(sprite: Sprite): void {
    const anim = this.hoverAnims.get(sprite)
    if (anim) anim.targetScaleMul = 1
  }

  // Per-frame ease of scale lift and halo alpha. When the board starts
  // animating, reset all anims (drops/swaps own the sprites) and clear hover
  // so the halo fades cleanly.
  private startEffectsTicker(): void {
    const cb = (ticker: Ticker) => this.tickEffects(ticker.deltaMS)
    this.effectsTickerCb = cb
    Ticker.shared.add(cb)
  }

  private tickEffects(dtMs: number): void {
    if (this.disposed) return
    const animating = this.animator?.isAnimating ?? false
    this.updateCursor(animating)
    if (animating) {
      // Drop/swap tweens own sprite scale and position during animation;
      // bail out of hover entirely so we don't fight them. Reset scale to
      // resting so the animator starts from a clean baseline.
      if (this.hoverAnims.size > 0) {
        for (const anim of this.hoverAnims.values()) {
          anim.sprite.scale.set(anim.baseScale)
        }
        this.hoverAnims.clear()
      }
      if (this.hoveredCell) {
        this.hoveredCell = null
        this.hoverHaloTargetAlpha = 0
      }
    }
    // Cap dt: if a frame is dropped (tab backgrounded, GC pause) the spring
    // can integrate into instability at large dt. ~33ms keeps ω·dt < 1.
    const dt = Math.min(dtMs / 1000, 1 / 30)
    const easeK = 1 - Math.exp(-HOVER_EASE_RATE * dt)
    // Spring-integrate scale lift each frame. Semi-implicit Euler:
    // a = -2ζω·v - ω²(x - target); v += a·dt; x += v·dt. ζ < 1 means the
    // value overshoots its target slightly before settling — the rubber-band
    // feel on return to rest.
    if (this.hoverAnims.size > 0) {
      const omega = HOVER_SPRING_OMEGA
      const omegaSq = omega * omega
      const damp = 2 * HOVER_SPRING_ZETA * omega
      const toRemove: Sprite[] = []
      for (const anim of this.hoverAnims.values()) {
        const aScale =
          -damp * anim.velScaleMul -
          omegaSq * (anim.currentScaleMul - anim.targetScaleMul)
        anim.velScaleMul += aScale * dt
        anim.currentScaleMul += anim.velScaleMul * dt
        anim.sprite.scale.set(anim.baseScale * anim.currentScaleMul)
        // Release entries that have fully returned to rest. Both position
        // and velocity must be near zero — without the velocity check we'd
        // remove the anim mid-bounce.
        if (
          anim.targetScaleMul === 1 &&
          Math.abs(anim.currentScaleMul - 1) < 0.002 &&
          Math.abs(anim.velScaleMul) < 0.05
        ) {
          anim.sprite.scale.set(anim.baseScale)
          toRemove.push(anim.sprite)
        }
      }
      for (const s of toRemove) this.hoverAnims.delete(s)
    }
    // Ease halo alpha. Hide once fully faded so we don't keep submitting a
    // transparent draw call to the additive layer.
    const halo = this.hoverHalo
    if (halo) {
      const target = this.hoverHaloTargetAlpha
      halo.alpha = halo.alpha + (target - halo.alpha) * easeK
      if (target === 0 && halo.alpha < 0.01) {
        halo.alpha = 0
        halo.visible = false
      }
    }
    this.tickFloat(dtMs, animating)
    this.tickShimmers(dtMs, animating)
    this.tickNudge(dtMs, animating)
    this.boardEffects?.tick(dtMs)
  }

  // Idle-hint nudge. Pulses two gems that would swap into a match when the
  // player hasn't acted for NUDGE_TRIGGER_MS. Cycles to a different random
  // pair every NUDGE_CYCLE_MS so repeat-stares feel varied. Any pointer or
  // key activity calls resetNudgeIdle() — see hookups in input handlers.
  //
  // Attack ramp (env: 0→1 over NUDGE_ATTACK_MS) keeps the first bounces
  // subtle. Release winds down across a window aligned to the next sine
  // cycle boundary so both env and sin reach zero together — the pulse
  // always finishes on a complete wave.
  private tickNudge(dtMs: number, animating: boolean): void {
    const phase = useGameStore.getState().fight.phase
    const canHint =
      !animating && phase === 'player-acting' && isStarted()
    if (!canHint) {
      // Suppress immediately — animator owns sprite scale during anims and
      // an eased fade would just fight its tweens.
      this.nudgeIdleMs = 0
      this.nudgeAttackElapsedMs = 0
      this.nudgeIsReleasing = false
      this.restoreNudgeSprites()
      this.nudgePair = null
      return
    }
    if (this.nudgePulsingSprites.length > 0) {
      this.nudgePulseElapsedMs += dtMs
      // Cycle expiry triggers the cycle-aligned release.
      if (!this.nudgeIsReleasing) {
        this.nudgeCycleMs -= dtMs
        if (this.nudgeCycleMs <= 0) this.startNudgeRelease()
      }
      // Compute envelope (attack ramp, sustain at 1, or release ramp).
      let env: number
      if (this.nudgeIsReleasing) {
        const span =
          this.nudgeReleaseEndElapsedMs - this.nudgeReleaseStartElapsedMs
        const t =
          (this.nudgePulseElapsedMs - this.nudgeReleaseStartElapsedMs) / span
        if (t >= 1) {
          // End of cycle reached: sin === 0 and env === 0 simultaneously.
          this.restoreNudgeSprites()
          this.nudgePair = null
          this.nudgeIsReleasing = false
          this.nudgeAttackElapsedMs = 0
          return
        }
        env = 1 - easeInOutCubic(t)
      } else if (this.nudgeAttackElapsedMs < NUDGE_ATTACK_MS) {
        this.nudgeAttackElapsedMs += dtMs
        env = easeInOutCubic(
          Math.min(1, this.nudgeAttackElapsedMs / NUDGE_ATTACK_MS),
        )
      } else {
        env = 1
      }
      const phaseRad =
        (this.nudgePulseElapsedMs / NUDGE_PULSE_PERIOD_MS) * Math.PI * 2
      const mul = 1 + NUDGE_SCALE_AMPLITUDE * env * Math.sin(phaseRad)
      for (const entry of this.nudgePulsingSprites) {
        entry.sprite.scale.set(entry.baseScale * mul)
      }
      return
    }
    this.nudgeIdleMs += dtMs
    if (this.nudgeIdleMs >= NUDGE_TRIGGER_MS) this.pickNudgePair()
  }

  // Compute a release window that ENDS at the next sine cycle boundary
  // (sin === 0 there). With NUDGE_CYCLE_MS a multiple of the pulse period,
  // cycle-expiry triggers this with cur exactly on a boundary — release
  // then runs for one full period. User-resets can hit at any phase; the
  // half-period guard ensures we always get a visible taper.
  private startNudgeRelease(): void {
    if (this.nudgeIsReleasing) return
    const cur = this.nudgePulseElapsedMs
    const period = NUDGE_PULSE_PERIOD_MS
    let end = (Math.floor(cur / period) + 1) * period
    if (end - cur < period / 2) end += period
    this.nudgeIsReleasing = true
    this.nudgeReleaseStartElapsedMs = cur
    this.nudgeReleaseEndElapsedMs = end
  }

  private pickNudgePair(): void {
    const animator = this.animator
    if (!animator) return
    const cells = useGameStore.getState().board.cells
    // Board doesn't change while the player sits idle, so cycle picks reuse
    // the swap list. Identity check is enough: any store update produces a
    // fresh cells array.
    let swaps: Array<{ from: Pos; to: Pos }>
    if (this.nudgeSwapCacheCells === cells && this.nudgeSwapCache) {
      swaps = this.nudgeSwapCache
    } else {
      // Shallow-clone rows so swapMakesMatch's transient mutations don't
      // touch the live store arrays. Cells (the inner objects) aren't
      // mutated by the scan, only row slots.
      const cloned = cells.map((row) => row.slice())
      swaps = findAllValidSwaps(cloned)
      this.nudgeSwapCache = swaps
      this.nudgeSwapCacheCells = cells
    }
    if (swaps.length === 0) return
    // Avoid re-picking the last pair when alternatives exist.
    let pool = swaps
    if (this.nudgeLastPairKey && swaps.length > 1) {
      pool = swaps.filter(
        (s) => pairKey(s.from, s.to) !== this.nudgeLastPairKey,
      )
    }
    const pick = pool[Math.floor(Math.random() * pool.length)]
    if (!pick) return
    const fromSprite = animator.peekSprite(pick.from)
    const toSprite = animator.peekSprite(pick.to)
    if (!fromSprite || !toSprite) return
    this.restoreNudgeSprites()
    this.nudgePair = pick
    this.nudgeLastPairKey = pairKey(pick.from, pick.to)
    this.nudgeCycleMs = NUDGE_CYCLE_MS
    this.nudgePulseElapsedMs = 0
    this.nudgeAttackElapsedMs = 0
    this.nudgeIsReleasing = false
    this.nudgePulsingSprites = [
      { sprite: fromSprite, baseScale: fromSprite.scale.x },
      { sprite: toSprite, baseScale: toSprite.scale.x },
    ]
  }

  private restoreNudgeSprites(): void {
    for (const entry of this.nudgePulsingSprites) {
      entry.sprite.scale.set(entry.baseScale)
    }
    this.nudgePulsingSprites = []
  }

  // Player acted: start the cycle-aligned release. tickNudge tapers
  // amplitude across the rest of the current sine cycle and releases at
  // the boundary (where scale === baseScale by construction).
  private resetNudgeIdle(): void {
    this.nudgeIdleMs = 0
    this.nudgeLastPairKey = null
    if (this.nudgePair && !this.nudgeIsReleasing) this.startNudgeRelease()
  }

  // Slow Lissajous drift on every resting gem. Skipped during
  // AnimationController animations (it owns sprite positions then). Uses
  // cellCenter as the absolute base so writes don't accumulate, and assigns
  // a random phase per sprite the first time it's seen.
  //
  // Each sprite stores the breath sample at its anchor moment (initDx/Dy)
  // and we subtract it from every later sample, so the first write after
  // anchoring is exactly cellCenter and the breath eases in from zero. The
  // anchor is set:
  //   - on first sight (newly-spawned sprites after a drop), and
  //   - any time the sprite sits at exact cellCenter, which means the
  //     animator just finalized it there (the only other way to land at
  //     exact center is a sin zero-crossing during idle drift, where
  //     re-anchoring is a no-op for the current frame).
  // Idle sprites the animator didn't touch sit at cellCenter+offset on the
  // first frame after a cascade, fail the exact-center test, keep their
  // existing anchor, and continue drifting seamlessly.
  private tickFloat(dtMs: number, animating: boolean): void {
    // Freeze the clock during animations so when breathing resumes, sin(t)
    // returns exactly the value it had on the last idle frame — the next
    // write equals the last write, zero snap.
    if (animating) {
      this.floatAccumMs = 0
      return
    }
    this.floatElapsedMs += dtMs
    // 30Hz cadence — accumulate dt and only run the per-cell sweep when
    // we've crossed the threshold. Resets to 0 on animation, so the first
    // post-animation frame runs immediately (no snap on resume).
    this.floatAccumMs += dtMs
    if (this.floatAccumMs < 33) return
    this.floatAccumMs = 0
    const animator = this.animator
    if (!animator) return
    const t = this.floatElapsedMs
    const wx1 = (2 * Math.PI) / FLOAT_PERIOD_X1_MS
    const wx2 = (2 * Math.PI) / FLOAT_PERIOD_X2_MS
    const wy1 = (2 * Math.PI) / FLOAT_PERIOD_Y1_MS
    const wy2 = (2 * Math.PI) / FLOAT_PERIOD_Y2_MS
    // Tolerance for "sprite is at exact cellCenter". The animator writes
    // integer-aligned values to cellCenter; breath offsets are sub-pixel
    // but never exactly zero except at sin zero-crossings (which the
    // re-anchor handles harmlessly). 0.01px is well below human perception
    // and well above floating-point noise.
    const CENTER_EPS = 0.01
    for (let y = 0; y < BOARD_DIM; y++) {
      for (let x = 0; x < BOARD_DIM; x++) {
        const sprite = animator.peekSprite({ x, y })
        if (!sprite) continue
        const center = cellCenter(x, y)
        let phases = this.floatPhases.get(sprite)
        if (!phases) {
          const TAU = 2 * Math.PI
          phases = {
            px1: Math.random() * TAU,
            px2: Math.random() * TAU,
            py1: Math.random() * TAU,
            py2: Math.random() * TAU,
            // Will be set right after we sample curDx/curDy below.
            initDx: 0,
            initDy: 0,
          }
          this.floatPhases.set(sprite, phases)
        }
        const curDx =
          0.6 * Math.sin(t * wx1 + phases.px1) +
          0.4 * Math.sin(t * wx2 + phases.px2)
        const curDy =
          0.6 * Math.sin(t * wy1 + phases.py1) +
          0.4 * Math.sin(t * wy2 + phases.py2)
        // Re-anchor when the sprite is at exact cellCenter — either it's
        // just been seen for the first time (default initDx/Dy = 0, sprite
        // at center because the animator placed it) or the animator just
        // finalized a drop/swap/spawn there. Idle sprites the animator
        // didn't touch sit at cellCenter+breath_offset and fail this test,
        // keeping their existing anchor and drift.
        if (
          Math.abs(sprite.x - center.x) < CENTER_EPS &&
          Math.abs(sprite.y - center.y) < CENTER_EPS
        ) {
          phases.initDx = curDx
          phases.initDy = curDy
        }
        const dx = curDx - phases.initDx
        const dy = curDy - phases.initDy
        sprite.x = center.x + FLOAT_AMPLITUDE_X_PX * dx
        sprite.y = center.y + FLOAT_AMPLITUDE_Y_PX * dy
      }
    }
  }

  // Drive existing shimmer streaks each frame, and (when idle) tick down
  // the cooldown and spawn a new one. Frequency is board-wide — single
  // shimmer at a time, long quiet gaps between.
  private tickShimmers(dtMs: number, animating: boolean): void {
    // Animation owns the sprites; abort any in-flight shimmers so we don't
    // hold a mask reference to a sprite that may be destroyed by a clear.
    if (animating && this.activeShimmers.length > 0) {
      for (const s of this.activeShimmers) this.disposeShimmer(s)
      this.activeShimmers = []
    }
    if (this.activeShimmers.length > 0) {
      const survivors: ShimmerInstance[] = []
      for (const s of this.activeShimmers) {
        s.elapsed += dtMs
        if (s.elapsed >= SHIMMER_DURATION_MS) {
          this.disposeShimmer(s)
          continue
        }
        const t = s.elapsed / SHIMMER_DURATION_MS
        s.view.x = s.startX + (s.endX - s.startX) * t
        s.view.y = s.startY + (s.endY - s.startY) * t
        // Triangle envelope: 0 → peak around the midpoint → 0.
        const env = t < 0.45 ? t / 0.45 : (1 - t) / 0.55
        s.view.alpha = Math.max(0, env) * SHIMMER_PEAK_ALPHA
        survivors.push(s)
      }
      this.activeShimmers = survivors
    }
    if (animating) return
    this.shimmerCooldownMs -= dtMs
    if (this.shimmerCooldownMs > 0) return
    this.shimmerCooldownMs = randomShimmerInterval()
    if (this.activeShimmers.length === 0) this.spawnShimmer()
  }

  // Sets canvas cursor to "pointer" only when actions are available
  // (board ready for input). During animations or after a victory the
  // board is non-actionable, so the cursor reverts to the default arrow.
  private updateCursor(animating: boolean): void {
    const canvas = this.app?.canvas
    if (!canvas) return
    const phase = useGameStore.getState().fight.phase
    const desired = animating || phase === 'victory' ? 'default' : 'pointer'
    if (this.lastCursor === desired) return
    canvas.style.cursor = desired
    this.lastCursor = desired
  }

  private disposeShimmer(s: ShimmerInstance): void {
    s.view.mask = null
    s.view.parent?.removeChild(s.view)
    s.view.destroy()
    s.maskClone.parent?.removeChild(s.maskClone)
    // texture: false — the clone shares the gem's texture, leave it alive
    // so the original gem doesn't lose its asset.
    s.maskClone.destroy({ texture: false })
  }

  private spawnShimmer(): void {
    const layer = this.boardLayer
    const animator = this.animator
    if (!layer || !animator) return
    const cx = Math.floor(Math.random() * BOARD_DIM)
    const cy = Math.floor(Math.random() * BOARD_DIM)
    const sprite = animator.peekSprite({ x: cx, y: cy })
    if (!sprite) return
    const len = GEM_SIZE * SHIMMER_LEN_RATIO
    const width = SHIMMER_WIDTH_PX
    // Soft-edge pill: layered roundRects with stepped alpha so the streak
    // doesn't read as a hard rectangle.
    const streak = new Graphics()
    streak
      .roundRect(
        -len / 2 - 2,
        -width / 2 - 2,
        len + 4,
        width + 4,
        (width + 4) / 2,
      )
      .fill({ color: 0xffffff, alpha: 0.12 })
    streak
      .roundRect(-len / 2, -width / 2, len, width, width / 2)
      .fill({ color: 0xffffff, alpha: 0.5 })
    streak
      .roundRect(
        (-len / 2) * 0.6,
        (-width / 2) * 0.55,
        len * 0.6,
        width * 0.55,
        (width * 0.55) / 2,
      )
      .fill({ color: 0xffffff, alpha: 0.95 })
    streak.blendMode = 'add'
    // Clone the gem sprite for use as an alpha mask — Pixi removes the
    // assigned mask object from normal rendering, so we'd erase the gem
    // if we used the original. The clone shares the live texture, matches
    // position/size, and is destroyed with the shimmer.
    const maskClone = new Sprite(sprite.texture)
    maskClone.anchor.set(sprite.anchor.x, sprite.anchor.y)
    maskClone.width = sprite.width
    maskClone.height = sprite.height
    maskClone.x = sprite.x
    maskClone.y = sprite.y
    layer.addChild(maskClone)
    streak.mask = maskClone
    // Fixed orientation + motion so every shimmer behaves identically.
    // Streak is rotated to "\", sweeping perpendicular along the "/"
    // diagonal of the cell — from bottom-left corner up to top-right.
    streak.rotation = SHIMMER_STREAK_ROTATION
    const { x: ccx, y: ccy } = cellCenter(cx, cy)
    const sweep = CELL_SIZE * SHIMMER_SWEEP_RATIO
    const dx = (sweep * Math.cos(SHIMMER_MOTION_ANGLE)) / 2
    const dy = (sweep * Math.sin(SHIMMER_MOTION_ANGLE)) / 2
    const startX = ccx - dx
    const startY = ccy - dy
    const endX = ccx + dx
    const endY = ccy + dy
    streak.x = startX
    streak.y = startY
    streak.alpha = 0
    layer.addChild(streak)
    this.activeShimmers.push({
      view: streak,
      maskClone,
      elapsed: 0,
      startX,
      startY,
      endX,
      endY,
    })
  }
}
