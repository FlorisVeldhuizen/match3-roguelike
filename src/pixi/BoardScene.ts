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

const CELL_SIZE = 64
const GEM_SIZE = 54
const BOARD_PADDING = 8
const BOARD_DIM = 8
const LOGICAL_SIZE = BOARD_PADDING * 2 + CELL_SIZE * BOARD_DIM

const cellCenter = (x: number, y: number) => ({
  x: x * CELL_SIZE + CELL_SIZE / 2,
  y: y * CELL_SIZE + CELL_SIZE / 2,
})

const inBounds = (p: Pos): boolean =>
  p.x >= 0 && p.x < BOARD_DIM && p.y >= 0 && p.y < BOARD_DIM

const samePos = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y

type PointerState = {
  pointerId: number
  startCell: Pos
  startClientX: number
  startClientY: number
  lastClientX: number
  lastClientY: number
  everEscaped: boolean
}

// Cursor-relative nudge: max offset (px) when the pointer sits at the cell
// edge. Smaller numbers feel like a polite lean; larger feels like the gem
// is chasing the cursor.
const HOVER_NUDGE_MAX_PX = 2.2
const HOVER_EASE_RATE = 14 // higher = snappier; ~14 lands a smooth ~120ms feel
const HOVER_HALO_PEAK_ALPHA = 0.4
// Pressed state dims the halo to half-strength — small but legible "click
// registered" feedback without overpowering the hover glow.
const HOVER_HALO_PRESSED_ALPHA = 0.22

type HoverAnim = {
  sprite: Sprite
  baseX: number
  baseY: number
  targetOffsetX: number
  targetOffsetY: number
}

export class BoardScene {
  private readonly mountEl: HTMLElement
  private app: Application | null = null
  private animator: AnimationController | null = null
  private selectionRing: Graphics | null = null
  private ghostRing: Graphics | null = null
  private disposed = false
  private unsubscribeSelection: (() => void) | null = null
  private detachPointer: (() => void) | null = null
  private activePointer: PointerState | null = null
  private overlay: import('./OverlayScene').OverlayScene | null = null
  private hoverHalo: Graphics | null = null
  private hoveredCell: Pos | null = null
  // Per-sprite nudge state. Typically holds 0–2 entries: the currently
  // hovered sprite (target = cursor-relative offset) and at most one
  // departing sprite easing back to rest.
  private hoverAnims = new Map<Sprite, HoverAnim>()
  private hoverHaloTargetAlpha = 0
  private hoverIsPressed = false
  private effectsTickerCb: ((ticker: Ticker) => void) | null = null

  constructor(mountEl: HTMLElement) {
    this.mountEl = mountEl
  }

  setOverlay(overlay: import('./OverlayScene').OverlayScene): void {
    this.overlay = overlay
    if (this.animator) this.animator.setOverlay(overlay)
  }

  // Screen-space center of cell (x,y), accounting for board padding and the
  // canvas's CSS scaling. Returns null if the canvas isn't measurable yet.
  cellScreenCenter(pos: Pos): { x: number; y: number } | null {
    const canvas = this.app?.canvas
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const center = cellCenter(pos.x, pos.y)
    const lx = BOARD_PADDING + center.x
    const ly = BOARD_PADDING + center.y
    return {
      x: rect.left + (lx / LOGICAL_SIZE) * rect.width,
      y: rect.top + (ly / LOGICAL_SIZE) * rect.height,
    }
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
    this.animator = new AnimationController({
      parent: board,
      sprites,
      geometry: { cellSize: CELL_SIZE, gemSize: GEM_SIZE, cellCenter },
      textures,
      cellScreenCenter: (pos) => this.cellScreenCenter(pos),
    })
    if (this.overlay) this.animator.setOverlay(this.overlay)
    this.subscribeSelection()
    this.attachPointerEvents(app.canvas)
    this.startEffectsTicker()
  }

  destroy(): void {
    this.disposed = true
    this.unsubscribeSelection?.()
    this.unsubscribeSelection = null
    this.detachPointer?.()
    this.detachPointer = null
    if (this.effectsTickerCb) Ticker.shared.remove(this.effectsTickerCb)
    this.effectsTickerCb = null
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
    this.hoverAnims.clear()
    this.activePointer = null
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
    this.unsubscribeSelection = useGameStore.subscribe(() => {
      this.updateSelectionRing()
    })
    this.updateSelectionRing()
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
    const target = active ? this.computeDragTarget(active) : null
    if (target) {
      const { x, y } = cellCenter(target.x, target.y)
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
    const canvas = this.app?.canvas
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
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
      // Keep the hover halo + nudge alive through the click — the selection
      // ring fades in alongside it instead of replacing it. If the click
      // commits to a swap, animation start will clean up via tickEffects.
      // Mark pressed so the halo dims slightly: visible "click registered"
      // feedback without snapping the glow off.
      this.setPressed(true)
      this.updateSelectionRing()
    }

    const onPointerMove = (ev: PointerEvent) => {
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
      // No active drag → hover-track. Animations suppress hover so nudges
      // don't fight drop/swap tweens.
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
    canvas.style.cursor = 'pointer'

    this.detachPointer = () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('pointerleave', onPointerLeave)
    }
  }

  private async performSwap(from: Pos, to: Pos): Promise<void> {
    const animator = this.animator
    if (!animator || animator.isAnimating) return
    // Clear hover before the cascade plays so the nudge/halo don't ghost
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

  // Pointer-driven hover update. Picks the hovered cell from the cursor and
  // computes a cursor-relative nudge offset (the gem leans toward the mouse
  // within the cell, instead of always jumping straight up). Called every
  // pointermove while not dragging or animating.
  private updateHoverFromPointer(clientX: number, clientY: number): void {
    const cell = this.clientToCell(clientX, clientY)
    if (!cell) {
      this.setHover(null)
      return
    }
    this.setHover(cell)
    const sprite = this.animator?.peekSprite(cell)
    if (!sprite) return
    // Cursor position in board-container coords (i.e. matching cellCenter).
    const canvas = this.app?.canvas
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const logicalX = ((clientX - rect.left) * LOGICAL_SIZE) / rect.width
    const logicalY = ((clientY - rect.top) * LOGICAL_SIZE) / rect.height
    const localX = logicalX - BOARD_PADDING
    const localY = logicalY - BOARD_PADDING
    const center = cellCenter(cell.x, cell.y)
    // dx/dy ∈ [-CELL_SIZE/2, +CELL_SIZE/2]. Scale so the corner of the cell
    // maps to HOVER_NUDGE_MAX_PX of offset — gives a polite lean rather
    // than a chase.
    const ratio = HOVER_NUDGE_MAX_PX / (CELL_SIZE / 2)
    const targetOffsetX = (localX - center.x) * ratio
    const targetOffsetY = (localY - center.y) * ratio
    this.setHoverTarget(sprite, targetOffsetX, targetOffsetY)
  }

  // Track hovered cell + manage the departing-sprite handoff. When the cell
  // changes, the previously hovered sprite stays in hoverAnims with target
  // offset (0,0) so it eases back to rest in the background; the new sprite
  // gets a fresh anim entry the next time setHoverTarget runs.
  private setHover(cell: Pos | null): void {
    const prev = this.hoveredCell
    if (prev && cell && samePos(prev, cell)) return
    if (!prev && !cell) return
    // Old sprite (if any) eases back to base.
    if (prev) {
      const oldSprite = this.animator?.peekSprite(prev) ?? null
      if (oldSprite) this.releaseHoverTarget(oldSprite)
    }
    this.hoveredCell = cell
    this.refreshHaloTargetAlpha()
    const halo = this.hoverHalo
    if (halo && cell) {
      const { x, y } = cellCenter(cell.x, cell.y)
      halo.x = x
      halo.y = y
      halo.visible = true
    }
  }

  // Recompute the halo target alpha from current (hover, pressed) state.
  // Called whenever either flips so the eased halo.alpha drifts toward the
  // right level (hover = full glow, pressed = dimmed, neither = off).
  private refreshHaloTargetAlpha(): void {
    if (!this.hoveredCell) {
      this.hoverHaloTargetAlpha = 0
      return
    }
    this.hoverHaloTargetAlpha = this.hoverIsPressed
      ? HOVER_HALO_PRESSED_ALPHA
      : HOVER_HALO_PEAK_ALPHA
  }

  private setPressed(pressed: boolean): void {
    if (this.hoverIsPressed === pressed) return
    this.hoverIsPressed = pressed
    this.refreshHaloTargetAlpha()
  }

  private setHoverTarget(sprite: Sprite, dx: number, dy: number): void {
    let anim = this.hoverAnims.get(sprite)
    if (!anim) {
      anim = {
        sprite,
        baseX: sprite.x,
        baseY: sprite.y,
        targetOffsetX: 0,
        targetOffsetY: 0,
      }
      this.hoverAnims.set(sprite, anim)
    }
    anim.targetOffsetX = dx
    anim.targetOffsetY = dy
  }

  private releaseHoverTarget(sprite: Sprite): void {
    const anim = this.hoverAnims.get(sprite)
    if (anim) {
      anim.targetOffsetX = 0
      anim.targetOffsetY = 0
    }
  }

  // Per-frame ease of nudge offsets and halo alpha. When the board starts
  // animating, snap all anims to their base (drops/swaps own the sprites)
  // and clear hover so the halo fades cleanly.
  private startEffectsTicker(): void {
    const cb = (ticker: Ticker) => this.tickEffects(ticker.deltaMS)
    this.effectsTickerCb = cb
    Ticker.shared.add(cb)
  }

  private tickEffects(dtMs: number): void {
    if (this.disposed) return
    const animating = this.animator?.isAnimating ?? false
    if (animating) {
      // Drop/swap tweens own sprite positions during animation; bail out of
      // hover entirely so we don't fight them.
      if (this.hoverAnims.size > 0) {
        for (const anim of this.hoverAnims.values()) {
          anim.sprite.x = anim.baseX
          anim.sprite.y = anim.baseY
        }
        this.hoverAnims.clear()
      }
      if (this.hoveredCell) {
        this.hoveredCell = null
        this.hoverHaloTargetAlpha = 0
      }
    }
    const dt = dtMs / 1000
    const easeK = 1 - Math.exp(-HOVER_EASE_RATE * dt)
    // Ease each nudged sprite toward its target offset.
    if (this.hoverAnims.size > 0) {
      const toRemove: Sprite[] = []
      for (const anim of this.hoverAnims.values()) {
        const curOffX = anim.sprite.x - anim.baseX
        const curOffY = anim.sprite.y - anim.baseY
        const newOffX = curOffX + (anim.targetOffsetX - curOffX) * easeK
        const newOffY = curOffY + (anim.targetOffsetY - curOffY) * easeK
        anim.sprite.x = anim.baseX + newOffX
        anim.sprite.y = anim.baseY + newOffY
        // Release entries that have settled at rest (only when target is
        // also rest — entries actively being pulled keep their slot).
        if (
          anim.targetOffsetX === 0 &&
          anim.targetOffsetY === 0 &&
          Math.abs(newOffX) < 0.05 &&
          Math.abs(newOffY) < 0.05
        ) {
          anim.sprite.x = anim.baseX
          anim.sprite.y = anim.baseY
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
  }
}
