// Shared synth utilities — pure helpers used across multiple synth modules.
// Lives here (rather than in any one synth file) so we don't have to pick
// an arbitrary owner.

import { out } from './context'

// Multiplicative jitter helper: returns a value in [1 - pct/2, 1 + pct/2].
// Use for pitch / gain / time scaling so a single number describes the spread.
// e.g. freq * jitter(0.06) gives ±3% pitch wobble.
export function jitter(pct: number): number {
  return 1 + (Math.random() - 0.5) * pct
}

// Map an event amount (damage, heal, armor gained, cluster size...) into a
// multiplier that controls "perceived impact" — peak gain, sub-pitch weight,
// and decay. Log curve so a 6-armor gain feels weightier than 3, but a 30-
// damage hit doesn't blow the speakers vs a 3-damage hit. Capped at 1.7 so
// the scaling stays within "tasteful" range.
//
//   amount 1 → 1.00 (baseline)
//   amount 2 → 1.30
//   amount 3 → 1.48
//   amount 4 → 1.60
//   amount 6 → 1.70 (cap)
export function intensity(amount: number): number {
  const a = Math.max(1, amount)
  return Math.min(1.7, 1 + 0.3 * Math.log2(a))
}

// Shared white-noise buffer pool. Each synth burst used to allocate its
// own buffer; routing through 4 pre-built 1s buffers (picked at random)
// gives variety without the per-call alloc. `dur` is kept as a callsite
// hint; the buffer outlasts any reasonable cue and callers stop the
// source at their own envelope tail.
const NOISE_POOL_SIZE = 4
const NOISE_POOL_DURATION_S = 1.0
let noisePool: AudioBuffer[] | null = null

function ensureNoisePool(c: AudioContext): void {
  if (noisePool) return
  const pool: AudioBuffer[] = []
  const len = Math.floor(NOISE_POOL_DURATION_S * c.sampleRate)
  for (let n = 0; n < NOISE_POOL_SIZE; n++) {
    const buf = c.createBuffer(1, len, c.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    pool.push(buf)
  }
  noisePool = pool
}

export function makeNoiseBurst(c: AudioContext): AudioBufferSourceNode {
  ensureNoisePool(c)
  const pool = noisePool!
  const buf = pool[Math.floor(Math.random() * pool.length)] ?? pool[0]
  const src = c.createBufferSource()
  if (buf) src.buffer = buf
  return src
}

// Shared sine-with-envelope partial used by the chime/arpeggio/swell/sparkle/
// chord heal variants. Scheduled at absolute AudioContext time `t`.
export function schedRingPartial(
  c: AudioContext,
  t: number,
  freq: number,
  peak: number,
  decay: number,
  attack: number,
): void {
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freq
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
  osc.connect(g).connect(out(c))
  osc.start(t)
  osc.stop(t + decay + 0.02)
}
