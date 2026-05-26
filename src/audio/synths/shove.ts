import { getCtx, isMuted, out } from '../context'
import { jitter, makeNoiseBurst } from '../utils'

// Swarmer cluster-shove resolve — a quick whoosh (the gems flying) +
// a soft thud (the gems landing) capped at ~350ms total. Reads as
// "stuff just got rearranged" without the heaviness of a column
// smash. Scales subtly with move count so a 3-swarmer cluster has a
// bigger sweep than a single-swarmer one.
function synthShove(moveCount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = Math.min(1.4, 0.6 + moveCount * 0.18)
  // Total shape: whoosh peaks around 60ms, thud at ~180ms, decay tail.
  const dur = 0.34

  // Whoosh: bandpass noise sweeping 600 → 250 Hz (downward, like
  // something being thrown across the board to land somewhere lower).
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

  // Thud: short sine bump at 110 Hz on a fast envelope.
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
