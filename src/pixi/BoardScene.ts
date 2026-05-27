import { Application, Container, Graphics, Sprite, Ticker } from 'pixi.js'
import { useGameStore } from '../core/state/store'
import { type GemColor, type Pos } from '../types'
import { createBoardInteraction } from './input'
import { AnimationController } from './AnimationController'
import { BoardEffects } from './BoardEffects'
import { emitGameEvent, subscribeGameEvents } from '../core/events/emitter'
import {
  getTimeScale,
  onDebugSwap,
  subscribeTimeScale,
} from '../debug/devControls'
import { findAllValidSwaps } from '../core/board/generation'
import { setHoveredCell } from '../ui/state/hoveredCell'
import { registerBoardSpellPlayback } from '../ui/state/boardSpellPlayback'
import type { GameEvent } from '../types'
import { subscribeGemStyle } from '../gems/settings'
import {
  createBoardGemSprite,
  loadGemBoardVisuals,
  type GemBoardSprite,
  type GemBoardVisuals,
} from '../gems/visuals'
import { boardSpriteLive } from './boardSprite'

const NUDGE_TRIGGER_MS = 7000
const NUDGE_PULSE_PERIOD_MS = 1000
// Multiple of pulse period so cycle-expiry lands on a sine zero
const NUDGE_CYCLE_MS = 3000
const NUDGE_SCALE_AMPLITUDE = 0.09
const NUDGE_ATTACK_MS = 500
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

const CELL_SIZE = 64
const GEM_SIZE = 54
const BOARD_PADDING = 8
const BOARD_DIM = 8
const LOGICAL_SIZE = BOARD_PADDING * 2 + CELL_SIZE * BOARD_DIM

const CELL_CENTERS: { x: number; y: number }[][] = Array.from(
  { length: BOARD_DIM },
  (_, y) =>
    Array.from({ length: BOARD_DIM }, (_, x) => ({
      x: x * CELL_SIZE + CELL_SIZE / 2,
      y: y * CELL_SIZE + CELL_SIZE / 2,
    })),
)
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

const HOVER_EASE_RATE = 14
const HOVER_SPRING_OMEGA = 18
const HOVER_SPRING_ZETA = 0.42
const HOVER_HALO_PEAK_ALPHA = 0.4
const HOVER_HALO_PRESSED_ALPHA = 0.22
const HOVER_SCALE_PEAK = 1.12
const HOVER_SCALE_PRESSED = 1.07
const HOVER_PROXIMITY_RADIUS_PX = CELL_SIZE * 1.5

const SHIMMER_MIN_INTERVAL_MS = 1100
const SHIMMER_MAX_INTERVAL_MS = 2400
const SHIMMER_DURATION_MS = 900
const SHIMMER_PEAK_ALPHA = 0.6
const SHIMMER_STREAK_ROTATION = Math.PI / 4
const SHIMMER_MOTION_ANGLE = -Math.PI / 4
const SHIMMER_LEN_RATIO = 1.7
const SHIMMER_WIDTH_PX = 6
const SHIMMER_SWEEP_RATIO = 1.5

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
  initDx: number
  initDy: number
}

type HoverAnim = {
  sprite: Sprite
  baseScale: number
  targetScaleMul: number
  currentScaleMul: number
  velScaleMul: number
}

type ShimmerInstance = {
  view: Graphics
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

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}


export class BoardScene {
  private readonly mountEl: HTMLElement
  private app: Application | null = null
  private animator: AnimationController | null = null
  private selectionRing: Graphics | null = null
  private ghostRing: Graphics | null = null
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
  private detachBoardSpellPlayback: (() => void) | null = null
  private detachGemStyle: (() => void) | null = null
  private detachBoardStructure: (() => void) | null = null
  private pendingIntroSprites: Sprite[][] | null = null
  private activePointer: PointerState | null = null
  private cachedCanvasRect: DOMRect | null = null
  private overlay: import('./OverlayScene').OverlayScene | null = null
  private hoverHalo: Graphics | null = null
  private hoveredCell: Pos | null = null
  private hoverAnims = new Map<Sprite, HoverAnim>()
  private hoverHaloTargetAlpha = 0
  private hoverIsPressed = false
  private lastHoverClientX = 0
  private lastHoverClientY = 0
  private hasHoverPosition = false
  private boardLayer: Container | null = null
  private boardEffects: BoardEffects | null = null
  private activeShimmers: ShimmerInstance[] = []
  private shimmerCooldownMs = randomShimmerInterval()
  private floatElapsedMs = 0
  private floatAccumMs = 0
  private floatPhases = new WeakMap<Sprite, FloatPhases>()
  private effectsTickerCb: ((ticker: Ticker) => void) | null = null
  private lastCursor = ''
  private nudgeIdleMs = 0
  private nudgePair: { from: Pos; to: Pos } | null = null
  private nudgeCycleMs = 0
  private nudgeLastPairKey: string | null = null
  private nudgePulseElapsedMs = 0
  private nudgePulsingSprites: Array<{ sprite: Sprite; baseScale: number }> = []
  private nudgeAttackElapsedMs = 0
  private nudgeIsReleasing = false
  private nudgeReleaseStartElapsedMs = 0
  private nudgeReleaseEndElapsedMs = 0
  private nudgeSwapCache: Array<{ from: Pos; to: Pos }> | null = null
  private nudgeSwapCacheCells: unknown = null
  private nudgeSwapCachePetrified: unknown = null

  constructor(mountEl: HTMLElement) {
    this.mountEl = mountEl
  }

  setOverlay(overlay: import('./OverlayScene').OverlayScene): void {
    this.overlay = overlay
    if (this.animator) this.animator.setOverlay(overlay)
  }

  private cellToStage(pos: Pos): { x: number; y: number } | null {
    if (!this.boardLayer) return null
    const center = cellCenter(pos.x, pos.y)
    return {
      x: BOARD_PADDING + center.x,
      y: BOARD_PADDING + center.y,
    }
  }

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

  private attachDevControls(app: Application): void {
    const applyScale = (value: number) => {
      Ticker.shared.speed = value
      app.ticker.speed = value
    }
    applyScale(getTimeScale())
    this.detachTimeScale = subscribeTimeScale(applyScale)
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

    const visuals = await loadGemBoardVisuals()
    if (this.disposed) return

    const board = new Container()
    board.x = BOARD_PADDING
    board.y = BOARD_PADDING
    app.stage.addChild(board)

    this.drawBoardBackground(board)
    const sprites = this.buildSprites(board, visuals)
    this.buildSelectionRing(board)
    this.buildHoverHalo(board)
    this.boardLayer = board
    this.animator = new AnimationController({
      parent: board,
      sprites,
      geometry: { cellSize: CELL_SIZE, gemSize: GEM_SIZE, cellCenter },
      visuals,
      cellScreenCenter: (pos) => this.cellScreenCenter(pos),
    })
    if (this.overlay) this.animator.setOverlay(this.overlay)
    this.wireBoardSpellPlayback()
    this.attachBoardStructureInvalidation()
    for (const row of sprites) for (const s of row) s.alpha = 0
    this.pendingIntroSprites = sprites
    this.playPendingIntro()
    this.subscribeSelection()
    this.attachPointerEvents(app.canvas)
    this.attachKeyboardEvents()
    this.attachRectInvalidation()
    this.attachVisibilityPause(app)
    this.attachDevControls(app)
    this.detachGemStyle = subscribeGemStyle(() => void this.applyGemStyle())
    this.boardEffects = new BoardEffects(app.stage, (pos) =>
      this.cellToStage(pos),
    )
    this.startEffectsTicker()
  }

  private playPendingIntro(): void {
    if (this.disposed) return
    const sprites = this.pendingIntroSprites
    if (!sprites || !this.animator) return
    this.pendingIntroSprites = null
    const runPhase = useGameStore.getState().runPhase
    if (runPhase !== 'fight') {
      return
    }
    for (const row of sprites) for (const s of row) s.alpha = 1
    void this.animator.playInitialFill()
  }

  destroy(): void {
    this.disposed = true
    this.unsubscribeSelection?.()
    this.unsubscribeSelection = null
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
    this.detachBoardSpellPlayback?.()
    this.detachBoardSpellPlayback = null
    this.detachGemStyle?.()
    this.detachGemStyle = null
    this.detachBoardStructure?.()
    this.detachBoardStructure = null
    this.cachedCanvasRect = null
    if (this.effectsTickerCb) Ticker.shared.remove(this.effectsTickerCb)
    this.effectsTickerCb = null
    this.boardEffects?.destroy()
    this.boardEffects = null
    if (this.app) {
      this.app.destroy(true, { children: true, texture: false })
      this.app = null
    }
    this.animator?.dispose()
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

  private async rebuildBoard(): Promise<void> {
    const app = this.app
    const layer = this.boardLayer
    if (!app || !layer) return
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
    this.nudgePulsingSprites = []
    this.nudgePair = null
    this.nudgeIdleMs = 0
    this.nudgeAttackElapsedMs = 0
    this.nudgePulseElapsedMs = 0
    this.nudgeIsReleasing = false
    this.invalidateNudgeSwapCache()

    const visuals = await loadGemBoardVisuals()
    if (this.disposed) return

    this.drawBoardBackground(layer)
    const sprites = this.buildSprites(layer, visuals)
    this.buildSelectionRing(layer)
    this.buildHoverHalo(layer)

    this.animator = new AnimationController({
      parent: layer,
      sprites,
      geometry: { cellSize: CELL_SIZE, gemSize: GEM_SIZE, cellCenter },
      visuals,
      cellScreenCenter: (pos) => this.cellScreenCenter(pos),
    })
    if (this.overlay) this.animator.setOverlay(this.overlay)
    this.wireBoardSpellPlayback()
    this.updateSelectionRing()
    void this.animator.playInitialFill()
  }

  private wireBoardSpellPlayback(): void {
    this.detachBoardSpellPlayback?.()
    this.detachBoardSpellPlayback = registerBoardSpellPlayback((events) =>
      this.playBoardSpellEvents(events),
    )
  }

  private async playBoardSpellEvents(events: GameEvent[]): Promise<void> {
    const animator = this.animator
    if (!animator || animator.isAnimating) return
    this.setHover(null)
    await animator.play(events)
    const fightPhase = useGameStore.getState().fight.phase
    const fightEnded = fightPhase === 'victory' || fightPhase === 'game-over'
    if (fightEnded && !prefersReducedMotion()) {
      await animator.sweepBoard()
    }
    emitGameEvent({ kind: 'gameplay-settled' })
  }

  private async applyGemStyle(): Promise<void> {
    if (!this.animator) return
    const visuals = await loadGemBoardVisuals()
    if (this.disposed) return
    this.purgeBoardEffectsForSpriteSwap()
    this.animator.setGemVisuals(visuals)
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
    visuals: GemBoardVisuals,
  ): GemBoardSprite[][] {
    const cells = useGameStore.getState().board.cells
    const sprites: GemBoardSprite[][] = []
    for (let y = 0; y < BOARD_DIM; y++) {
      const row: GemBoardSprite[] = []
      for (let x = 0; x < BOARD_DIM; x++) {
        const cell = cells[y]?.[x]
        if (!cell) throw new Error(`missing cell ${x},${y}`)
        const sprite = createBoardGemSprite(cell.gemColor, visuals, GEM_SIZE)
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
    let prevSelected = useGameStore.getState().board.selected
    this.unsubscribeSelection = useGameStore.subscribe((s) => {
      if (s.board.selected === prevSelected) return
      prevSelected = s.board.selected
      if (s.board.selected) this.keyboardCursor = s.board.selected
      this.updateSelectionRing()
    })
    this.updateSelectionRing()
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
    const dx = active.lastClientX - active.startClientX
    const dy = active.lastClientY - active.startClientY
    const hover = this.clientToCell(active.lastClientX, active.lastClientY)
    if (hover && samePos(hover, active.startCell)) return null
    // Off-board fallback: use drag delta direction if minimum threshold met
    if (!hover) {
      const rect = this.getCanvasRect()
      if (!rect || rect.width === 0) return null
      const scale = rect.width / LOGICAL_SIZE
      const logicalDrag = Math.max(Math.abs(dx), Math.abs(dy)) / scale
      if (logicalDrag < CELL_SIZE / 3) return null
    }
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
      const storeState = useGameStore.getState()
      if (storeState.fight.phase !== 'player-acting') return
      if (storeState.runPhase !== 'fight') return
      this.cachedCanvasRect = null
      const cell = this.clientToCell(ev.clientX, ev.clientY)
      if (!cell) return
      const targetingSpell = storeState.boardTargetingSpell
      if (targetingSpell !== null) {
        const gem = storeState.board.cells[cell.y]?.[cell.x]
        if (gem && targetingSpell === 'shatter') {
          void this.performShatter(gem.gemColor)
        } else if (targetingSpell === 'frozen-wall') {
          void this.performFrozenWall(cell.y)
        }
        storeState.cancelBoardTargeting()
        return
      }
      if ((storeState.board.petrifiedRows[cell.y] ?? 0) > 0) return
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
      this.setPressed(true)
      this.updateSelectionRing()
    }

    const onPointerMove = (ev: PointerEvent) => {
      this.resetNudgeIdle()
      setHoveredCell(this.clientToCell(ev.clientX, ev.clientY))
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
      const storeState = useGameStore.getState()
      const interactable =
        !this.animator?.isAnimating &&
        storeState.fight.phase === 'player-acting' &&
        storeState.runPhase === 'fight'
      if (!interactable) {
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

    this.detachPointer = () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('pointerleave', onPointerLeave)
    }
  }

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
        if (store.boardTargetingSpell !== null) {
          ev.preventDefault()
          store.cancelBoardTargeting()
          return
        }
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
    this.setHover(null)
    const petrifiedRows = useGameStore.getState().board.petrifiedRows
    if (
      (petrifiedRows[from.y] ?? 0) > 0 ||
      (petrifiedRows[to.y] ?? 0) > 0
    ) {
      return
    }
    const result = useGameStore.getState().attemptSwap(from, to)
    await animator.play(result.events)
    const fightPhase = useGameStore.getState().fight.phase
    const fightEnded = fightPhase === 'victory' || fightPhase === 'game-over'
    if (fightEnded && !prefersReducedMotion()) {
      await animator.sweepBoard()
    }
    emitGameEvent({ kind: 'gameplay-settled' })
  }

  private async performShatter(color: GemColor): Promise<void> {
    const animator = this.animator
    if (!animator || animator.isAnimating) return
    this.setHover(null)
    const result = useGameStore.getState().castShatter(color)
    if (!result.ok) return
    await this.playBoardSpellEvents(result.events)
  }

  private async performFrozenWall(row: number): Promise<void> {
    const animator = this.animator
    if (!animator || animator.isAnimating) return
    this.setHover(null)
    const result = useGameStore.getState().castFrozenWall(row)
    if (!result.ok) return
    await this.playBoardSpellEvents(result.events)
  }

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

  private updateHoverFromPointer(clientX: number, clientY: number): void {
    this.lastHoverClientX = clientX
    this.lastHoverClientY = clientY
    this.hasHoverPosition = true
    this.applyHoverState()
  }

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
    const maxOffset = Math.ceil(radius / CELL_SIZE)
    const minX = Math.max(0, cell.x - maxOffset)
    const maxX = Math.min(BOARD_DIM - 1, cell.x + maxOffset)
    const minY = Math.max(0, cell.y - maxOffset)
    const maxY = Math.min(BOARD_DIM - 1, cell.y + maxOffset)

    const visited = new Set<Sprite>()
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const sprite = animator.peekSprite({ x, y })
        if (!boardSpriteLive(sprite)) continue
        const center = cellCenter(x, y)
        const dx = localX - center.x
        const dy = localY - center.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const t = dist >= radius ? 0 : 1 - dist / radius
        const tSmooth = t * t * (3 - 2 * t)
        const scaleMul = 1 + (peak - 1) * tSmooth
        if (scaleMul > 1.0005) {
          this.setHoverTarget(sprite, scaleMul)
          visited.add(sprite)
        }
      }
    }
    if (this.hoverAnims.size > visited.size) {
      for (const sprite of this.hoverAnims.keys()) {
        if (!visited.has(sprite)) this.releaseHoverTarget(sprite)
      }
    }
  }

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
    if (this.hasHoverPosition) this.applyHoverState()
  }

  private setHoverTarget(sprite: Sprite, scaleMul: number): void {
    if (!boardSpriteLive(sprite)) return
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
      this.resetHoverAnims()
      if (this.hoveredCell) {
        this.hoveredCell = null
        this.hoverHaloTargetAlpha = 0
      }
    }
    // Cap dt to avoid spring instability after dropped frames
    const dt = Math.min(dtMs / 1000, 1 / 30)
    const easeK = 1 - Math.exp(-HOVER_EASE_RATE * dt)
    if (this.hoverAnims.size > 0) {
      const omega = HOVER_SPRING_OMEGA
      const omegaSq = omega * omega
      const damp = 2 * HOVER_SPRING_ZETA * omega
      const toRemove: Sprite[] = []
      for (const anim of this.hoverAnims.values()) {
        if (!boardSpriteLive(anim.sprite)) {
          toRemove.push(anim.sprite)
          continue
        }
        const aScale =
          -damp * anim.velScaleMul -
          omegaSq * (anim.currentScaleMul - anim.targetScaleMul)
        anim.velScaleMul += aScale * dt
        anim.currentScaleMul += anim.velScaleMul * dt
        anim.sprite.scale.set(anim.baseScale * anim.currentScaleMul)
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

  private nudgeSpritesStale(): boolean {
    return this.nudgePulsingSprites.some((e) => !boardSpriteLive(e.sprite))
  }

  private invalidateNudgeSwapCache(): void {
    this.nudgeSwapCache = null
    this.nudgeSwapCacheCells = null
    this.nudgeSwapCachePetrified = null
  }

  private resetHoverAnims(): void {
    for (const anim of this.hoverAnims.values()) {
      if (boardSpriteLive(anim.sprite)) {
        anim.sprite.scale.set(anim.baseScale)
      }
    }
    this.hoverAnims.clear()
  }

  private attachBoardStructureInvalidation(): void {
    this.detachBoardStructure?.()
    this.detachBoardStructure = subscribeGameEvents((event) => {
      switch (event.kind) {
        case 'gems-cleared':
        case 'gems-transmuted':
        case 'board-shuffled':
        case 'board-swept':
        case 'petrify-placed':
        case 'petrify-fired':
        case 'petrify-row-ticked':
        case 'trick-swapped':
          this.invalidateNudgeSwapCache()
          break
      }
    })
  }

  private purgeBoardEffectsForSpriteSwap(): void {
    this.clearNudgeHint()
    this.invalidateNudgeSwapCache()
    this.resetHoverAnims()
    if (this.activeShimmers.length > 0) {
      for (const s of this.activeShimmers) this.disposeShimmer(s)
      this.activeShimmers = []
    }
  }

  private clearNudgeHint(): void {
    this.restoreNudgeSprites()
    this.nudgePair = null
    this.nudgeIsReleasing = false
    this.nudgeAttackElapsedMs = 0
  }

  private tickNudge(dtMs: number, animating: boolean): void {
    const phase = useGameStore.getState().fight.phase
    const canHint =
      !animating && phase === 'player-acting'
    if (!canHint) {
      this.nudgeIdleMs = 0
      this.clearNudgeHint()
      return
    }
    if (this.nudgePulsingSprites.length > 0) {
      if (this.nudgeSpritesStale()) {
        this.clearNudgeHint()
        return
      }
      this.nudgePulseElapsedMs += dtMs
      if (!this.nudgeIsReleasing) {
        this.nudgeCycleMs -= dtMs
        if (this.nudgeCycleMs <= 0) this.startNudgeRelease()
      }
      let env: number
      if (this.nudgeIsReleasing) {
        const span =
          this.nudgeReleaseEndElapsedMs - this.nudgeReleaseStartElapsedMs
        const t =
          (this.nudgePulseElapsedMs - this.nudgeReleaseStartElapsedMs) / span
        if (t >= 1) {
          this.clearNudgeHint()
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
        if (!boardSpriteLive(entry.sprite)) continue
        entry.sprite.scale.set(entry.baseScale * mul)
      }
      return
    }
    this.nudgeIdleMs += dtMs
    if (this.nudgeIdleMs >= NUDGE_TRIGGER_MS) this.pickNudgePair()
  }

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
    const petrifiedRows = useGameStore.getState().board.petrifiedRows
    let swaps: Array<{ from: Pos; to: Pos }>
    if (
      this.nudgeSwapCacheCells === cells &&
      this.nudgeSwapCachePetrified === petrifiedRows &&
      this.nudgeSwapCache
    ) {
      swaps = this.nudgeSwapCache
    } else {
      const cloned = cells.map((row) => row.slice())
      swaps = findAllValidSwaps(cloned, petrifiedRows)
      this.nudgeSwapCache = swaps
      this.nudgeSwapCacheCells = cells
      this.nudgeSwapCachePetrified = petrifiedRows
    }
    if (swaps.length === 0) return
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
    if (!boardSpriteLive(fromSprite) || !boardSpriteLive(toSprite)) return
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
      if (!boardSpriteLive(entry.sprite)) continue
      entry.sprite.scale.set(entry.baseScale)
    }
    this.nudgePulsingSprites = []
  }

  private resetNudgeIdle(): void {
    this.nudgeIdleMs = 0
    this.nudgeLastPairKey = null
    if (this.nudgePair && !this.nudgeIsReleasing) this.startNudgeRelease()
  }

  private tickFloat(dtMs: number, animating: boolean): void {
    if (animating) {
      this.floatAccumMs = 0
      return
    }
    this.floatElapsedMs += dtMs
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
    const CENTER_EPS = 0.01
    for (let y = 0; y < BOARD_DIM; y++) {
      for (let x = 0; x < BOARD_DIM; x++) {
        const sprite = animator.peekSprite({ x, y })
        if (!boardSpriteLive(sprite)) continue
        const center = cellCenter(x, y)
        let phases = this.floatPhases.get(sprite)
        if (!phases) {
          const TAU = 2 * Math.PI
          phases = {
            px1: Math.random() * TAU,
            px2: Math.random() * TAU,
            py1: Math.random() * TAU,
            py2: Math.random() * TAU,
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
        // Re-anchor when sprite is at exact cellCenter (animator just placed it)
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

  private tickShimmers(dtMs: number, animating: boolean): void {
    if (animating && this.activeShimmers.length > 0) {
      for (const s of this.activeShimmers) this.disposeShimmer(s)
      this.activeShimmers = []
    }
    if (this.activeShimmers.length > 0) {
      const survivors: ShimmerInstance[] = []
      for (const s of this.activeShimmers) {
        if (s.maskClone.destroyed) {
          this.disposeShimmer(s)
          continue
        }
        s.elapsed += dtMs
        if (s.elapsed >= SHIMMER_DURATION_MS) {
          this.disposeShimmer(s)
          continue
        }
        const t = s.elapsed / SHIMMER_DURATION_MS
        s.view.x = s.startX + (s.endX - s.startX) * t
        s.view.y = s.startY + (s.endY - s.startY) * t
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
    // texture: false — clone shares the gem's texture, don't destroy it
    s.maskClone.destroy({ texture: false })
  }

  private spawnShimmer(): void {
    const layer = this.boardLayer
    const animator = this.animator
    if (!layer || !animator) return
    const cx = Math.floor(Math.random() * BOARD_DIM)
    const cy = Math.floor(Math.random() * BOARD_DIM)
    const sprite = animator.peekSprite({ x: cx, y: cy })
    if (!boardSpriteLive(sprite)) return
    const len = GEM_SIZE * SHIMMER_LEN_RATIO
    const width = SHIMMER_WIDTH_PX
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
    // Clone gem sprite as mask — Pixi removes the mask from normal rendering
    const maskClone = new Sprite(sprite.texture)
    maskClone.anchor.set(sprite.anchor.x, sprite.anchor.y)
    maskClone.width = sprite.width
    maskClone.height = sprite.height
    maskClone.x = sprite.x
    maskClone.y = sprite.y
    layer.addChild(maskClone)
    streak.mask = maskClone
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
