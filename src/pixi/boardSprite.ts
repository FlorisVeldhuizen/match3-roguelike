import type { Sprite } from 'pixi.js'

/** True when a board gem sprite can safely receive transform updates. */
export function boardSpriteLive(sprite: Sprite | null | undefined): sprite is Sprite {
  return sprite != null && !sprite.destroyed
}
