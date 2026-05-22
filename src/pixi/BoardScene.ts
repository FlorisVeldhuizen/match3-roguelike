import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  type Texture,
} from 'pixi.js'
import { useGameStore } from '../core/state/store'
import { type GemColor, GEM_COLORS, type Pos } from '../types'
import { createBoardInteraction } from './input'
import { tweenSwap } from './animations/swap'

const CELL_SIZE = 64
const GEM_SIZE = 54
const BOARD_PADDING = 8
const BOARD_DIM = 8
const LOGICAL_SIZE = BOARD_PADDING * 2 + CELL_SIZE * BOARD_DIM
const SWAP_DURATION_MS = 200

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
  everEscaped: boolean // pointer has left startCell at least once
}

export class BoardScene {
  private readonly mountEl: HTMLElement
  private app: Application | null = null
  private sprites: Sprite[][] = []
  private selectionRing: Graphics | null = null
  private ghostRing: Graphics | null = null
  private isAnimating = false
  private disposed = false
  private unsubscribeSelection: (() => void) | null = null
  private detachPointer: (() => void) | null = null
  private activePointer: PointerState | null = null

  constructor(mountEl: HTMLElement) {
    this.mountEl = mountEl
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
    this.buildSprites(board, textures)
    this.buildSelectionRing(board)
    this.subscribeSelection()
    this.attachPointerEvents(app.canvas)
  }

  destroy(): void {
    this.disposed = true
    this.unsubscribeSelection?.()
    this.unsubscribeSelection = null
    this.detachPointer?.()
    this.detachPointer = null
    if (this.app) {
      this.app.destroy(true, { children: true, texture: false })
      this.app = null
    }
    this.sprites = []
    this.selectionRing = null
    this.ghostRing = null
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
  ): void {
    const cells = useGameStore.getState().board.cells
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
      this.sprites.push(row)
    }
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
    // Drag-press cell takes precedence over click-stored selection.
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
    // Cell-based threshold: the swap is only projected once the pointer
    // has left the source cell. Coming back inside it clears the ghost.
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
      isAnimating: () => this.isAnimating,
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
      this.updateSelectionRing()
    }

    const onPointerMove = (ev: PointerEvent) => {
      const active = this.activePointer
      if (!active || active.pointerId !== ev.pointerId) return
      active.lastClientX = ev.clientX
      active.lastClientY = ev.clientY
      if (!active.everEscaped) {
        const hover = this.clientToCell(ev.clientX, ev.clientY)
        if (hover && !samePos(hover, active.startCell)) {
          active.everEscaped = true
        }
      }
      this.updateSelectionRing()
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
      this.updateSelectionRing()

      if (target) {
        void interaction.dragSwap(active.startCell, target)
        return
      }
      // Release inside the source cell after a drag began → cancel completely.
      if (active.everEscaped) return
      // Pure tap (never left source cell) → click semantics.
      void interaction.click(active.startCell)
    }

    const onPointerCancel = (ev: PointerEvent) => {
      const active = this.activePointer
      if (!active || active.pointerId !== ev.pointerId) return
      if (canvas.hasPointerCapture(ev.pointerId)) {
        canvas.releasePointerCapture(ev.pointerId)
      }
      this.activePointer = null
      this.updateSelectionRing()
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerCancel)
    canvas.style.cursor = 'pointer'

    this.detachPointer = () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
    }
  }

  private async performSwap(from: Pos, to: Pos): Promise<void> {
    if (this.isAnimating) return
    const rowFrom = this.sprites[from.y]
    const rowTo = this.sprites[to.y]
    if (!rowFrom || !rowTo) return
    const a = rowFrom[from.x]
    const b = rowTo[to.x]
    if (!a || !b) return
    this.isAnimating = true
    try {
      useGameStore.getState().swapCells(from, to)
      await tweenSwap(a, b, SWAP_DURATION_MS)
      if (this.disposed) return
      rowFrom[from.x] = b
      rowTo[to.x] = a
    } finally {
      this.isAnimating = false
    }
  }
}
