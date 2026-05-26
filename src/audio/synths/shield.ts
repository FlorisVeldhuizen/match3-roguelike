import { getCtx, isMuted, out } from '../context'
import { intensity, jitter, makeNoiseBurst } from '../utils'

function synthShieldThump(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(amount)

  const subJ = jitter(0.12) * (1 - 0.15 * (I - 1) / 0.7)
  const subVel = jitter(0.2) * I
  const sub = c.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(90 * subJ, now)
  sub.frequency.exponentialRampToValueAtTime(55 * subJ, now + 0.12)
  const subGain = c.createGain()
  subGain.gain.setValueAtTime(0.0001, now)
  subGain.gain.exponentialRampToValueAtTime(0.4 * subVel, now + 0.004)
  subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
  sub.connect(subGain).connect(out(c))
  sub.start(now)
  sub.stop(now + 0.18)

  const f0 = 180 + (Math.random() - 0.5) * 20
  const partials: [number, number, number][] = [
    [1.0, 0.22, 140],
    [2.31, 0.1, 90],
  ]
  for (const [ratio, peak, decay] of partials) {
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = f0 * ratio
    const peakJ = peak * jitter(0.2) * I
    const decayS = (decay / 1000) * jitter(0.16)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(peakJ, now + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, now + decayS)
    osc.connect(g).connect(out(c))
    osc.start(now)
    osc.stop(now + decayS + 0.02)
  }

  const noise = makeNoiseBurst(c)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 700 * jitter(0.15)
  lp.Q.value = 1
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.32 * jitter(0.18) * I, now + 0.003)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
  noise.connect(lp).connect(ng).connect(out(c))
  noise.start(now)
  noise.stop(now + 0.08)
}

let lastShieldCrackAtSec = 0

function synthShieldCrack(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(amount)
  const stacked = now - lastShieldCrackAtSec < 0.15
  lastShieldCrackAtSec = now

  const thudJ = jitter(0.1)
  const thud = c.createOscillator()
  thud.type = 'sine'
  thud.frequency.setValueAtTime(150 * thudJ, now)
  thud.frequency.exponentialRampToValueAtTime(55 * thudJ, now + 0.14)
  const thudGain = c.createGain()
  thudGain.gain.setValueAtTime(0.0001, now)
  thudGain.gain.exponentialRampToValueAtTime(0.32 * jitter(0.18) * I, now + 0.005)
  thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
  thud.connect(thudGain).connect(out(c))
  thud.start(now)
  thud.stop(now + 0.18)

  const snapDur = 0.12
  const snap = makeNoiseBurst(c)
  const snapBp = c.createBiquadFilter()
  snapBp.type = 'bandpass'
  snapBp.frequency.value = 1600 * jitter(0.18)
  snapBp.Q.value = 1
  const snapLp = c.createBiquadFilter()
  snapLp.type = 'lowpass'
  snapLp.frequency.setValueAtTime(4000 * jitter(0.15), now)
  snapLp.frequency.exponentialRampToValueAtTime(1000, now + snapDur)
  snapLp.Q.value = 0.6
  const snapGain = c.createGain()
  snapGain.gain.setValueAtTime(0.0001, now)
  snapGain.gain.exponentialRampToValueAtTime(0.34 * jitter(0.18) * I, now + 0.004)
  snapGain.gain.exponentialRampToValueAtTime(0.0001, now + snapDur)
  snap
    .connect(snapBp)
    .connect(snapLp)
    .connect(snapGain)
    .connect(out(c))
  snap.start(now)
  snap.stop(now + snapDur + 0.02)

  const crunch = makeNoiseBurst(c)
  const crunchLp = c.createBiquadFilter()
  crunchLp.type = 'lowpass'
  crunchLp.frequency.setValueAtTime(3000 * jitter(0.18), now)
  crunchLp.frequency.exponentialRampToValueAtTime(800, now + 0.14)
  crunchLp.Q.value = 1
  const crunchGain = c.createGain()
  crunchGain.gain.setValueAtTime(0.0001, now)
  crunchGain.gain.exponentialRampToValueAtTime(0.36 * jitter(0.18) * I, now + 0.004)
  crunchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
  crunch.connect(crunchLp).connect(crunchGain).connect(out(c))
  crunch.start(now)
  crunch.stop(now + 0.18)

  // Inharmonic ratios (not octave-stacked) so partials merge into shimmer, not a tone.
  const ringPartials: [number, number, number][] = stacked
    ? [
        [1820, 0.0, 0.13],
        [2470, 0.012, 0.1],
      ]
    : [
        [1820, 0.0, 0.13],
        [2470, 0.012, 0.1],
        [3540, 0.024, 0.08],
      ]
  for (const [freq, offset, decay] of ringPartials) {
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq * (1 + (Math.random() - 0.5) * 0.02)
    const g = c.createGain()
    const t = now + offset
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    osc.connect(g).connect(out(c))
    osc.start(t)
    osc.stop(t + decay + 0.02)
  }

  const debrisCount = stacked ? 2 : 3 + Math.floor((I - 1) * 3)
  for (let i = 0; i < debrisCount; i++) {
    const t = now + 0.06 + Math.random() * 0.2
    const burst = makeNoiseBurst(c)
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 400 + Math.random() * 1300
    bp.Q.value = 1.2
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.18 * I, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
    burst.connect(bp).connect(g).connect(out(c))
    burst.start(t)
    burst.stop(t + 0.1)
  }
}

export function playShieldThumpSfx(amount = 1): void {
  if (isMuted()) return
  synthShieldThump(amount)
}

export function playShieldCrackSfx(amount = 1): void {
  if (isMuted()) return
  synthShieldCrack(amount)
}

export function playShieldParticleTickSfx(amount = 1): void {
  if (isMuted()) return
  synthShieldThump(amount)
}
