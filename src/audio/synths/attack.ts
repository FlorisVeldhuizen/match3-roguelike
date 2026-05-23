import { getCtx, isMuted, out } from '../context'
import { intensity, jitter, makeNoiseBurst } from '../utils'

// Attack hit. Blade-slash character: an air-cutting *swhip* leading into a
// metallic impact. Six layers stacked at the head; center of mass sits in
// the upper-mid range (1–7 kHz). Critically the mid-band content is all
// filtered NOISE, not pitched oscillators — pitched mid sweeps read as
// vocal (dog bark, siren) rather than air movement.
//   1. Blade swoosh — bandpass-swept noise 4kHz→1kHz, the airy "shhwwip".
//   2. Crack — bandpassed noise at ~2.4 kHz, the contact transient.
//   3. Blade ring — quiet sine ping at ~2.8 kHz, the steel shimmer.
//   4. Bright snap — bandpassed noise at ~3 kHz for the cutting bite.
//   5. Mid crunch — bandpassed noise at ~1.1 kHz with a downward sweep for
//      the meaty body of impact.
//   6. Low tail — short low sine for a *hint* of body weight. Modest peak
//      and fast decay; just enough to anchor the strike without owning it.
// Pitch jitter so chained hits during a cascade don't sample-loop.
function synthAttack(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  // Shadowed local — earlier code used `jitter` as a *value* (a 1±0.04 mult)
  // rather than calling jitter() per layer. Renamed to `pitchJ` and added
  // per-layer velocity jitter so the strike "weight" varies between hits
  // (separate from pitch).
  const pitchJ = jitter(0.08)
  // Intensity gates the kick layer weight and the overall mix. Bigger hits
  // get a slightly heavier (lower-pitched) kick and more low-end body — the
  // swoosh/snap/crunch high band gets less of a boost so a heavy hit doesn't
  // turn into a bright shriek.
  const I = intensity(amount)
  const heavyGain = I // sub layer benefits most
  const brightGain = 1 + (I - 1) * 0.5 // mid/high gets half the boost

  // Low tail: anchor, not punch. Cut hard from its earlier strength — too
  // much sustain in this band reads as "kick drum" rather than "weapon
  // hit". Higher start freq, modest peak, short decay.
  const kick = c.createOscillator()
  kick.type = 'sine'
  // Bigger hits drop the kick a touch lower for extra weight.
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

  // Blade swoosh: noise burst with a lowpass cutoff sweeping down — the
  // airy "shhwwip" of a blade cutting through air. Lowpass (not bandpass)
  // is essential: a bandpass has a *peak* at its center frequency, and
  // sweeping that peak through noise tells the ear exactly where the pitch
  // is — that's where the "squeak" comes from. A lowpass has no peak,
  // just an edge — so the noise gets progressively muffled with no
  // perceivable pitch.
  //
  // Highpass at 800 Hz upstream removes low rumble so the muffling stage
  // at the end of the sweep doesn't turn into a low-frequency thump.
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

  // Crack: short bandpassed noise at ~2.4 kHz with a 1ms attack — the
  // defined contact transient. Pulled down from earlier "shink" territory
  // into the upper-mid band so it sits closer to the snap/ring and reads
  // as part of the impact body rather than a separate high layer.
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

  // Bright snap: the cutting bite at the moment of contact. Bandpass at
  // 3 kHz with Q=2 keeps it tonal-cracky rather than hissy. Pushed a touch
  // hotter than before so it bridges the shink into the mid crunch.
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

  // Mid crunch: the meat. Bandpass at ~1.1 kHz, slightly downward sweep so
  // the impact "settles" rather than holding steady.
  const crunch = makeNoiseBurst(c)
  const crunchBp = c.createBiquadFilter()
  crunchBp.type = 'bandpass'
  crunchBp.frequency.setValueAtTime(1200 * pitchJ, now)
  crunchBp.frequency.exponentialRampToValueAtTime(700, now + 0.09)
  crunchBp.Q.value = 1.4
  const crunchGain = c.createGain()
  crunchGain.gain.setValueAtTime(0.0001, now)
  // Mid crunch sits between bright and heavy — split the difference between
  // the two gain envelopes so the body grows with intensity but doesn't dominate.
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
