import type { Enemy } from '../../types'

export const SHOVE_HUES = [170, 290, 38, 130] as const

export function shoveHueFor(enemies: Enemy[], enemyId: string): number | null {
  const idx = enemies.findIndex((e) => e.id === enemyId)
  if (idx < 0) return null
  return SHOVE_HUES[idx % SHOVE_HUES.length]
}
