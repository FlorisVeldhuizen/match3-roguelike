import { Assets, Sprite, type Texture } from 'pixi.js'
import { GEM_COLORS, type GemColor } from '../types'
import {
  gemAssetPath,
  gemBoardScale,
  getGemStyle,
  isPixelGemStyle,
  type GemStyleVariant,
} from './settings'

export type GemBoardVisuals = {
  textures: Record<GemColor, Texture>
  boardScale: number
}

export type GemBoardSprite = Sprite

async function loadTextures(
  variant: GemStyleVariant,
): Promise<Record<GemColor, Texture>> {
  const entries = await Promise.all(
    GEM_COLORS.map(async (color) => {
      const texture = await Assets.load<Texture>(gemAssetPath(variant, color))
      if (isPixelGemStyle(variant)) {
        texture.source.scaleMode = 'nearest'
      }
      return [color, texture] as const
    }),
  )
  return Object.fromEntries(entries) as Record<GemColor, Texture>
}

export async function loadGemBoardVisuals(): Promise<GemBoardVisuals> {
  const variant = getGemStyle()
  const textures = await loadTextures(variant)
  return { textures, boardScale: gemBoardScale(variant) }
}

export function boardVisualsAsTextures(
  visuals: GemBoardVisuals,
): Record<GemColor, Texture> {
  return visuals.textures
}

/** Fit gem into a square cell without carrying over scale from a prior style. */
export function fitGemSpriteSize(
  sprite: GemBoardSprite,
  visuals: GemBoardVisuals,
  gemSize: number,
): void {
  sprite.anchor.set(0.5)
  const target = gemSize * visuals.boardScale
  const tex = sprite.texture
  const w = tex.width
  const h = tex.height
  if (w <= 0 || h <= 0) return
  const s = target / Math.max(w, h)
  sprite.scale.set(s)
}

export function createBoardGemSprite(
  color: GemColor,
  visuals: GemBoardVisuals,
  gemSize: number,
): GemBoardSprite {
  const sprite = new Sprite(visuals.textures[color])
  fitGemSpriteSize(sprite, visuals, gemSize)
  return sprite
}

export function applyBoardGemColor(
  sprite: GemBoardSprite,
  color: GemColor,
  visuals: GemBoardVisuals,
  gemSize: number,
): void {
  sprite.texture = visuals.textures[color]
  fitGemSpriteSize(sprite, visuals, gemSize)
}
