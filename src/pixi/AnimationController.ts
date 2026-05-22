import { Sprite, type Container, type Texture } from 'pixi.js'
import type { GameEvent, GemColor, Pos } from '../types'
import { tweenSwap } from './animations/swap'
import { tweenClear } from './animations/clear'
import { tweenDrop } from './animations/drop'

// Per-cell visual timings.
const SWAP_MS = 200
const CLEAR_MS = 280
const DROP_PER_CELL_MS = 80
const DROP_MIN_MS = 150

export type BoardGeometry = {
  cellSize: number
  gemSize: number
  cellCenter: (x: number, y: number) => { x: number; y: number }
}

// Owns the (Sprite | null)[][] grid that mirrors the logical board, and
// drives sprites in response to GameEvent[] streams.
export class AnimationController {
  private sprites: (Sprite | null)[][]
  private readonly geometry: BoardGeometry
  private readonly parent: Container
  private readonly textures: Record<GemColor, Texture>
  private playing: Promise<void> = Promise.resolve()

  constructor(opts: {
    parent: Container
    sprites: Sprite[][]
    geometry: BoardGeometry
    textures: Record<GemColor, Texture>
  }) {
    this.parent = opts.parent
    this.sprites = opts.sprites.map((row) => row.slice() as (Sprite | null)[])
    this.geometry = opts.geometry
    this.textures = opts.textures
  }

  get isAnimating(): boolean {
    return this.busy
  }

  private busy = false

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
    switch (event.kind) {
      case 'swap':
        await this.animateSwap(event.from, event.to)
        return
      case 'swap-reverted':
        // Animate the reverse so the gems return to their original cells.
        await this.animateSwap(event.from, event.to)
        return
      case 'cascade-start':
      case 'match-found':
        return
      case 'gems-cleared':
        await this.animateClear(event.cells)
        return
      case 'gems-fell':
        await this.animateFall(event.movements)
        return
      case 'gems-spawned':
        await this.animateSpawn(event.spawns)
        return
    }
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
    // Swap sprite references in the grid so they track logical positions.
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
    // Detach sprites from their old positions first (capture all sources),
    // then assign to destinations. This avoids two movements colliding mid-tween
    // when multiple gems fall in the same column.
    const moves = movements
      .map(({ from, to }) => ({ sprite: this.getSprite(from), from, to }))
      .filter((m): m is { sprite: Sprite; from: Pos; to: Pos } => m.sprite !== null)
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
      // Start above the board, offset by the cell row so each spawn falls
      // its own distance from above the visible top.
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
}
