import { getCtx, isMuted, out } from '../context'
import { intensity, jitter, makeNoiseBurst } from '../utils'

// Heavy shield hit: low thud with a brief inharmonic body. Sub-thud anchors
// the weight, two low partials give it a metallic-but-dense character (a
// thick plate, not a bell), and a lowpassed noise impact provides the
// "smack" of contact. Short decays — heavy shields don't ring out, they
// absorb the blow and dampen fast.
function synthShieldThump(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(amount)

  // Sub-thud: the body weight of the strike. Pitch + velocity jitter so
  // chained blocks don't sample-loop. Heavier blocks pitch lower and hit
  // louder — a 6-damage block lands with real weight vs a 1-damage tap.
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

  // Low metallic body: two close inharmonic partials, lowpassed so they
  // sound like a thick plate flexing rather than a bell ringing. Short
  // decays prevent any ring tail.
  const f0 = 180 + (Math.random() - 0.5) * 20
  // (ratio, peakGain, decayMs)
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

  // Impact smack: lowpassed noise burst — the "contact" of weapon on plate.
  // Lowpass keeps it dull/heavy instead of bright/tinny.
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

// Shield break: shattered-metal event. Brighter than the earlier "heavy
// thump" version — the player's existing block-absorbed cue is the heavy
// thud; this one should sound like the plate finally giving way and
// ringing out as fragments fly. Sibling palette to synthAttack (filtered
// noise + brief metal partials), but with a multi-partial ring tail.
//
// Avoiding the "squeak" problem from previous attempts: instead of one
// sustained sine in the formant range, we use THREE short inharmonic sine
// partials at staggered start times. Multiple partials and stagger mean
// the ear doesn't lock onto any single pitch; perceptually they merge
// into a "shimmery metallic decay" rather than a tone.
// Track recent shield-cracks so we can drop debris/ring count when they
// pile up faster than the ear can resolve them.
let lastShieldCrackAtSec = 0

function synthShieldCrack(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(amount)
  const stacked = now - lastShieldCrackAtSec < 0.15
  lastShieldCrackAtSec = now

  // Sub-thud: anchor, not centerpiece. Peak cut from 0.5 → 0.32 and decay
  // shortened so the cue doesn't lead with a heavy bass drop — that
  // dominated the previous version and gave it the "thumpy" character.
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

  // Structural snap: filtered noise standing in for the previous sawtooth
  // sweep. A bandpass at ~1.4 kHz with Q=1 widens the previous resonance
  // into a soft band, and a lowpass cutoff sweep from 4 kHz down to 1 kHz
  // (slightly brighter than before) gives the "settling crrk" with a touch
  // more shatter character.
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

  // Fracture crunch: lowpassed noise burst — the wideband "crack" of the
  // material giving way. Brighter start (3 kHz → 800 Hz sweep) so the
  // initial crack has shatter bite, not just dull thud.
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

  // Metal ring: three sine partials at inharmonic ratios (1820, 2470,
  // 3540 Hz — neither octave-stacked nor harmonic), each brief and quiet,
  // start times staggered by ~12ms so they enter as a sequence rather
  // than a single chord. The stagger is what prevents the squeak — a
  // single sustained sine in this band registers as a pure tone, but
  // three brief overlapping ones merge into "metallic shimmer".
  // Stacked instances drop the third (highest, quietest) partial — its
  // 80ms decay is short enough that listeners won't notice it missing
  // when another crack is already filling the same band.
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

  // Debris: 3–5 short bandpassed noise bursts, slightly brighter range than
  // before (400–1700 Hz vs the previous 250–1150). Brighter bursts read as
  // metallic chunks rather than wood/stone tumbling. Count scales with the
  // intensity of the break — a 6-damage hit kicks up more shrapnel than a
  // 1-damage finisher.
  // Stacked: cap debris at 2 regardless of intensity. The lost shrapnel
  // count is masked by the previous crack still ringing.
  const debrisCount = stacked ? 2 : 3 + Math.floor((I - 1) * 3) // I=1 → 3, I=1.7 → 5
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

// Armor cue (blue particle landing on the block badge) shares the shield-
// thump sound with the enemy's block-absorbed event. Intentional reuse —
// both are "armor doing its job".
export function playShieldParticleTickSfx(amount = 1): void {
  if (isMuted()) return
  synthShieldThump(amount)
}
