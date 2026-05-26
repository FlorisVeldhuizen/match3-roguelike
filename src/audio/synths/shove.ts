import { getCtx, isMuted, out } from '../context'
import { jitter, makeNoiseBurst } from '../utils'

function synthShove(moveCount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = Math.min(1.4, 0.6 + moveCount * 0.18)
  const dur = 0.34

  const noise = makeNoiseBurst(c)
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 2.4 * jitter(0.15)
  filter.frequency.setValueAtTime(600 * jitter(0.12), now)
  filter.frequency.exponentialRampToValueAtTime(250 * jitter(0.1), now + 0.18)
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.18 * I, now + 0.05)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  noise.connect(filter).connect(ng).connect(out(c))
  noise.start(now)
  noise.stop(now + dur + 0.02)

  const t = now + 0.16
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(140 * jitter(0.08), t)
  osc.frequency.exponentialRampToValueAtTime(85 * jitter(0.08), t + 0.14)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.22 * I, t + 0.015)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
  osc.connect(g).connect(out(c))
  osc.start(t)
  osc.stop(t + 0.2)
}

export function playShoveSfx(moveCount = 1): void {
  if (isMuted()) return
  synthShove(moveCount)
}
