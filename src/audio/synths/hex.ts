import { getCtx, isMuted, out } from '../context'
import { jitter, makeNoiseBurst } from '../utils'

function synthHexApply(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime

  const dur = 0.42 * jitter(0.1)
  const noise = makeNoiseBurst(c)
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 4.5 * jitter(0.15)
  filter.frequency.setValueAtTime(1800 * jitter(0.08), now)
  filter.frequency.exponentialRampToValueAtTime(900 * jitter(0.08), now + dur)
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.18, now + 0.05)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  noise.connect(filter).connect(ng).connect(out(c))
  noise.start(now)
  noise.stop(now + dur + 0.02)

  const detune = jitter(0.04)
  const FREQS = [440, 523, 659]
  const decay = 0.32
  for (const f of FREQS) {
    const osc = c.createOscillator()
    osc.type = 'sine'
    const startF = f * detune
    osc.frequency.setValueAtTime(startF, now)
    osc.frequency.exponentialRampToValueAtTime(startF * 0.96, now + decay)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(0.06 * jitter(0.2), now + 0.025)
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay)
    osc.connect(g).connect(out(c))
    osc.start(now)
    osc.stop(now + decay + 0.02)
  }
}

function synthHexTrigger(stacks: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = Math.min(1.4, 0.6 + stacks * 0.12)
  const dur = 0.22

  const detune = jitter(0.04)
  const FREQS = [659, 523]
  const gap = 0.05
  for (let i = 0; i < FREQS.length; i++) {
    const f = FREQS[i]
    if (f === undefined) continue
    const t = now + gap * i
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(f * detune, t)
    osc.frequency.exponentialRampToValueAtTime(f * detune * 0.92, t + 0.15)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.08 * I, t + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    osc.connect(g).connect(out(c))
    osc.start(t)
    osc.stop(t + 0.2)
  }

  const noise = makeNoiseBurst(c)
  const filter = c.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 1400
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.05 * I, now + 0.01)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  noise.connect(filter).connect(ng).connect(out(c))
  noise.start(now)
  noise.stop(now + dur + 0.02)
}

function synthHexExpire(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const dur = 0.32
  const noise = makeNoiseBurst(c)
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 3
  // Inverted sweep vs apply: rising 900→2200 Hz.
  filter.frequency.setValueAtTime(900 * jitter(0.08), now)
  filter.frequency.exponentialRampToValueAtTime(2200 * jitter(0.08), now + dur)
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.14, now + 0.04)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  noise.connect(filter).connect(ng).connect(out(c))
  noise.start(now)
  noise.stop(now + dur + 0.02)
}

export function playHexApplySfx(): void {
  if (isMuted()) return
  synthHexApply()
}

export function playHexTriggerSfx(stacks = 1): void {
  if (isMuted()) return
  synthHexTrigger(stacks)
}

export function playHexExpireSfx(): void {
  if (isMuted()) return
  synthHexExpire()
}
