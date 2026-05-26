import { getCtx, isMuted } from '../context'
import { intensity, jitter, schedRingPartial } from '../utils'

function synthHealArpeggio(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(amount)
  const pitchJ = jitter(0.04)

  const base = 520 * pitchJ
  const RATIOS = [1.0, 1.26, 1.5, 2.0]
  for (let i = 0; i < RATIOS.length; i++) {
    const ratio = RATIOS[i]
    if (ratio === undefined) continue
    schedRingPartial(c, now + i * 0.04, base * ratio, 0.085 * I, 0.16, 0.004)
  }
}

export function playHealSfx(amount = 1): void {
  if (isMuted()) return
  synthHealArpeggio(amount)
}
