import { out } from './context'

// Returns a value in [1 - pct/2, 1 + pct/2] for pitch/gain/time jitter.
export function jitter(pct: number): number {
  return 1 + (Math.random() - 0.5) * pct
}

// Log-curve scaling so big amounts feel weightier without blowing up.
//   amount 1 → 1.00, 3 → 1.48, 6+ → 1.70 (cap)
export function intensity(amount: number): number {
  const a = Math.max(1, amount)
  return Math.min(1.7, 1 + 0.3 * Math.log2(a))
}

// Pre-built noise buffers to avoid per-call allocations.
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
