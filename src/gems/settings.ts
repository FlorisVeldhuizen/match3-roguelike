import { GEM_COLORS, type GemColor } from '../types'

/** Board + HUD gem art sets — see public/gems/CREDITS.md */
export const GEM_STYLE_VARIANTS = [
  'pack-melle',
  'pack-birthstones',
  'vector',
] as const

export type GemStyleVariant = (typeof GEM_STYLE_VARIANTS)[number]

const STORAGE_KEY = 'gem-style-variant'

const DEFAULT_VARIANT: GemStyleVariant = 'vector'

const REMOVED_VARIANTS = new Set([
  'pack-karsiori',
  'pack-karsiori-chill',
  'pack-firestorm',
  'pack-crystals',
  'pack-hearts',
  'pack-spriteattack',
  'pack-7soul',
  'pack-7soul-34',
  'pack-ornate',
  'pack-etting-small',
  'pixel-chunky',
  'pixel-soft',
  'pixel-rune',
])

const VARIANT_EXT: Record<GemStyleVariant, 'png' | 'svg'> = {
  'pack-melle': 'png',
  'pack-birthstones': 'png',
  vector: 'svg',
}

const VARIANT_LABELS: Record<GemStyleVariant, string> = {
  'pack-melle': 'Faceted',
  'pack-birthstones': 'Birthstones',
  vector: 'Classic',
}

const VARIANT_HINTS: Record<GemStyleVariant, string> = {
  'pack-melle': 'Melle — emerald-cut faceted gems',
  'pack-birthstones': '7Soul1 ovals — slightly enlarged on the board',
  vector: 'Original in-project diamond SVGs (pre–Celtic)',
}

/** Extra board scale so small-silhouette packs fill the cell better */
const VARIANT_BOARD_SCALE: Partial<Record<GemStyleVariant, number>> = {
  'pack-birthstones': 1.14,
}

export function gemStyleLabel(variant: GemStyleVariant): string {
  return VARIANT_LABELS[variant]
}

export function gemStyleHint(variant: GemStyleVariant): string {
  return VARIANT_HINTS[variant]
}

export function gemAssetExtension(variant: GemStyleVariant): 'png' | 'svg' {
  return VARIANT_EXT[variant]
}

export function gemBoardScale(variant: GemStyleVariant): number {
  return VARIANT_BOARD_SCALE[variant] ?? 1
}

export function isPixelGemStyle(variant: GemStyleVariant): boolean {
  return variant !== 'vector'
}

export function gemAssetPath(variant: GemStyleVariant, color: GemColor): string {
  const ext = gemAssetExtension(variant)
  return `/gems/${variant}/${color}.${ext}`
}

function normalizeVariant(raw: string | null): GemStyleVariant {
  if (raw === 'pack-7soul' || raw === 'pack-7soul-34') {
    return 'pack-birthstones'
  }
  if (
    raw === 'pixel-chunky' ||
    raw === 'pixel-soft' ||
    raw === 'pixel-rune'
  ) {
    return 'vector'
  }
  if (raw && GEM_STYLE_VARIANTS.includes(raw as GemStyleVariant)) {
    return raw as GemStyleVariant
  }
  if (raw && REMOVED_VARIANTS.has(raw)) {
    return DEFAULT_VARIANT
  }
  return DEFAULT_VARIANT
}

function readVariant(): GemStyleVariant {
  try {
    return normalizeVariant(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_VARIANT
  }
}

let variant: GemStyleVariant = readVariant()
const listeners = new Set<(v: GemStyleVariant) => void>()

export function getGemStyle(): GemStyleVariant {
  return variant
}

export function applyGemStyleToDocument(v: GemStyleVariant = variant): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.gemStyle = v
  root.style.setProperty('--gem-board-scale', String(gemBoardScale(v)))
  for (const color of GEM_COLORS) {
    root.style.setProperty(
      `--gem-${color}-url`,
      `url('${gemAssetPath(v, color)}')`,
    )
  }
}

export function setGemStyle(next: GemStyleVariant): void {
  if (variant === next) return
  variant = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // no-op
  }
  applyGemStyleToDocument(next)
  for (const l of listeners) l(next)
}

export function subscribeGemStyle(
  listener: (v: GemStyleVariant) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

applyGemStyleToDocument()
