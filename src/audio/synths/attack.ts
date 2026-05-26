import { getCtx, isMuted, out } from '../context'
import { intensity, jitter, makeNoiseBurst } from '../utils'

function synthAttack(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const pitchJ = jitter(0.08)
  const I = intensity(amount)
  const heavyGain = I
  const brightGain = 1 + (I - 1) * 0.5 // mid/high gets half the boost

  const kick = c.createOscillator()
  kick.type = 'sine'
  // Bigger hits drop the kick lower for extra weight.
  kick.frequency.setValueAtTime(170 * pitchJ * (1 - 0.15 * (I - 1) / 0.7), now)
  kick.frequency.exponentialRampToValueAtTime(60, now + 0.06)
  const kickGain = c.createGain()
  kickGain.gain.setValueAtTime(0.0001, now)
  kickGain.gain.exponentialRampToValueAtTime(
    0.22 * jitter(0.18) * heavyGain,
    now + 0.003,
  )
  kickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08)
  kick.connect(kickGain).connect(out(c))
  kick.start(now)
  kick.stop(now + 0.1)

  // Lowpass (not bandpass) sweep avoids the pitched "squeak" artifact.
  const swooshDur = 0.11
  const swoosh = makeNoiseBurst(c)
  const swooshHp = c.createBiquadFilter()
  swooshHp.type = 'highpass'
  swooshHp.frequency.value = 800
  swooshHp.Q.value = 0.5
  const swooshLp = c.createBiquadFilter()
  swooshLp.type = 'lowpass'
  swooshLp.frequency.setValueAtTime(6000 * pitchJ, now)
  swooshLp.frequency.exponentialRampToValueAtTime(1400, now + swooshDur)
  swooshLp.Q.value = 0.5
  const swooshGain = c.createGain()
  swooshGain.gain.setValueAtTime(0.0001, now)
  swooshGain.gain.exponentialRampToValueAtTime(
    0.22 * jitter(0.2) * brightGain,
    now + 0.008,
  )
  swooshGain.gain.exponentialRampToValueAtTime(0.0001, now + swooshDur)
  swoosh
    .connect(swooshHp)
    .connect(swooshLp)
    .connect(swooshGain)
    .connect(out(c))
  swoosh.start(now)
  swoosh.stop(now + swooshDur + 0.02)

  const shink = makeNoiseBurst(c)
  const shinkBp = c.createBiquadFilter()
  shinkBp.type = 'bandpass'
  shinkBp.frequency.value = 2400 * pitchJ
  shinkBp.Q.value = 1.6
  const shinkGain = c.createGain()
  shinkGain.gain.setValueAtTime(0.0001, now)
  shinkGain.gain.exponentialRampToValueAtTime(
    0.2 * jitter(0.2) * brightGain,
    now + 0.001,
  )
  shinkGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018)
  shink.connect(shinkBp).connect(shinkGain).connect(out(c))
  shink.start(now)
  shink.stop(now + 0.025)

  const snap = makeNoiseBurst(c)
  const snapBp = c.createBiquadFilter()
  snapBp.type = 'bandpass'
  snapBp.frequency.value = 3000 * pitchJ
  snapBp.Q.value = 2
  const snapGain = c.createGain()
  snapGain.gain.setValueAtTime(0.0001, now)
  snapGain.gain.exponentialRampToValueAtTime(
    0.28 * jitter(0.2) * brightGain,
    now + 0.002,
  )
  snapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045)
  snap.connect(snapBp).connect(snapGain).connect(out(c))
  snap.start(now)
  snap.stop(now + 0.06)

  const crunch = makeNoiseBurst(c)
  const crunchBp = c.createBiquadFilter()
  crunchBp.type = 'bandpass'
  crunchBp.frequency.setValueAtTime(1200 * pitchJ, now)
  crunchBp.frequency.exponentialRampToValueAtTime(700, now + 0.09)
  crunchBp.Q.value = 1.4
  const crunchGain = c.createGain()
  crunchGain.gain.setValueAtTime(0.0001, now)
  crunchGain.gain.exponentialRampToValueAtTime(
    0.28 * jitter(0.2) * (0.5 * brightGain + 0.5 * heavyGain),
    now + 0.003,
  )
  crunchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1)
  crunch.connect(crunchBp).connect(crunchGain).connect(out(c))
  crunch.start(now)
  crunch.stop(now + 0.12)
}

export function playAttackSfx(amount = 1): void {
  if (isMuted()) return
  synthAttack(amount)
}
