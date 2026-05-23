import { getCtx, isMuted, out } from '../context'
import { intensity, jitter, makeNoiseBurst } from '../utils'

// Tile ignite: Smolder's tile-burn intent lights N cells. Whoosh + low
// rumble + sustained mid-roar bed + popping crackle. Layers tuned so
// the cue clearly reads as "fire catches" — distinct from a generic
// whoosh — without overpowering the per-match cues that follow.
function synthBurnIgnite(count: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(count)

  // Bandpass whoosh, sweeping up. Brighter top end and louder peak
  // than the previous pass so the leading edge of the cue feels like
  // air being sucked toward the flame.
  const noise = makeNoiseBurst(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(380 * jitter(0.1), now)
  bp.frequency.exponentialRampToValueAtTime(1700 * jitter(0.1), now + 0.18)
  bp.Q.value = 1.1
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.14 * jitter(0.2) * I, now + 0.03)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.24)
  noise.connect(bp).connect(ng).connect(out(c))
  noise.start(now)
  noise.stop(now + 0.26)

  // Sustained lowpassed roar — the "body" of the fire that wasn't there
  // before. Longer tail than the whoosh, mid-low filter so it doesn't
  // get hissy. Sits behind the whoosh, in front of the rumble.
  const roar = makeNoiseBurst(c)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 900 * jitter(0.1)
  lp.Q.value = 0.7
  const rg = c.createGain()
  rg.gain.setValueAtTime(0.0001, now)
  rg.gain.exponentialRampToValueAtTime(0.075 * I, now + 0.05)
  rg.gain.exponentialRampToValueAtTime(0.0001, now + 0.36)
  roar.connect(lp).connect(rg).connect(out(c))
  roar.start(now)
  roar.stop(now + 0.38)

  // Low rumble: 95→55Hz sine for impact body. Louder than before so
  // the cue has weight without relying on the whoosh alone.
  const sub = c.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(95 * jitter(0.08), now)
  sub.frequency.exponentialRampToValueAtTime(55 * jitter(0.08), now + 0.2)
  const sg = c.createGain()
  sg.gain.setValueAtTime(0.0001, now)
  sg.gain.exponentialRampToValueAtTime(0.16 * I, now + 0.02)
  sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.24)
  sub.connect(sg).connect(out(c))
  sub.start(now)
  sub.stop(now + 0.26)

  // Crackle: 4-6 short bandpass-noise pops scattered across the first
  // 150ms. More of them, louder, spread further so the cue feels like
  // a flame actually catching — uneven, alive.
  const sparks = 4 + Math.floor(Math.random() * 3)
  for (let i = 0; i < sparks; i++) {
    const offset = 0.01 + Math.random() * 0.14
    const n2 = makeNoiseBurst(c)
    const bp2 = c.createBiquadFilter()
    bp2.type = 'bandpass'
    bp2.frequency.value = 2000 + Math.random() * 2400
    bp2.Q.value = 4
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, now + offset)
    g.gain.exponentialRampToValueAtTime(0.075 * jitter(0.35), now + offset + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.07)
    n2.connect(bp2).connect(g).connect(out(c))
    n2.start(now + offset)
    n2.stop(now + offset + 0.09)
  }
}

// Burn burst: a burning tile got matched and is resolving. Chirp +
// crackle. Re-widened the chirp range and bumped the crackle peak so
// the cue has real "pop" — previously it sat too far under the
// per-match clack and didn't read as a discrete moment.
function synthBurnBurst(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime

  // Pitched chirp — fwoosh curl as the flame jumps and dies. Range
  // 260→760 Hz (wider than the previous 260→620) gives the cue more
  // bite at the peak without going screechy.
  const osc = c.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(260 * jitter(0.1), now)
  osc.frequency.exponentialRampToValueAtTime(760 * jitter(0.1), now + 0.1)
  const og = c.createGain()
  og.gain.setValueAtTime(0.0001, now)
  og.gain.exponentialRampToValueAtTime(0.17 * jitter(0.2), now + 0.01)
  og.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
  osc.connect(og).connect(out(c))
  osc.start(now)
  osc.stop(now + 0.2)

  // Crackle: highpassed noise — sparks flying outward. Louder so the
  // burst's "fire" character is unmistakable.
  const noise = makeNoiseBurst(c)
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 2000
  hp.Q.value = 0.8
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.12 * jitter(0.2), now + 0.006)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.15)
  noise.connect(hp).connect(ng).connect(out(c))
  noise.start(now)
  noise.stop(now + 0.17)
}

// Burn status applied to a target — flame whoosh, "fire just curled
// around something". Different from synthBurnIgnite (which is the
// "lighting cells" cue, with more crackle) and from synthBurnBurst
// (the "resolve" pop). This one is a singular wrap: short rising
// noise sweep through a bandpass, a soft low whump for body, no
// crackle layer. Lands clean on top of the per-particle trail
// arriving at the target's frame.
function synthBurnApply(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime

  // Bandpass-noise whoosh, climbing from ~500Hz to ~2.6kHz over 130ms
  // — the "fwooph" of a flame jumping onto its victim. Louder peak +
  // wider top so the cue clearly reads as flame, not just wind.
  const noise = makeNoiseBurst(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(500 * jitter(0.1), now)
  bp.frequency.exponentialRampToValueAtTime(2600 * jitter(0.1), now + 0.13)
  bp.Q.value = 1.5
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.17 * jitter(0.2), now + 0.025)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.2)
  noise.connect(bp).connect(ng).connect(out(c))
  noise.start(now)
  noise.stop(now + 0.22)

  // Low whump — the "weight" of the flame's impact. Single short sine
  // that dies fast. Louder so the cue has body.
  const sub = c.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(110 * jitter(0.08), now)
  sub.frequency.exponentialRampToValueAtTime(70 * jitter(0.08), now + 0.12)
  const sg = c.createGain()
  sg.gain.setValueAtTime(0.0001, now)
  sg.gain.exponentialRampToValueAtTime(0.1, now + 0.014)
  sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
  sub.connect(sg).connect(out(c))
  sub.start(now)
  sub.stop(now + 0.18)

  // 2 crackle pops on the way in — they're what makes the cue read as
  // "fire" rather than a generic whoosh. Scattered in the first 90ms.
  for (let i = 0; i < 2; i++) {
    const offset = 0.02 + Math.random() * 0.07
    const n2 = makeNoiseBurst(c)
    const bp2 = c.createBiquadFilter()
    bp2.type = 'bandpass'
    bp2.frequency.value = 2400 + Math.random() * 1600
    bp2.Q.value = 4
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, now + offset)
    g.gain.exponentialRampToValueAtTime(0.06 * jitter(0.3), now + offset + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.06)
    n2.connect(bp2).connect(g).connect(out(c))
    n2.start(now + offset)
    n2.stop(now + offset + 0.08)
  }
}

// Burn fizzle: a burning tile's countdown ran out without being matched.
// Sibilant "ssss." — noise focused in the /s/ phoneme band (~6–7 kHz)
// so the cue reads as a vocal "hiss-stop" rather than a generic wash.
// Quiet by design: this is a non-event from the player's perspective
// (threat passed, no damage), so it sits well below the per-match cues
// that run on the same beat.
function synthBurnFizzle(count: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(count)

  // Highpass with a slight downward sweep on the cutoff (6.5 → 3.5 kHz
  // over 800ms). Starts brightly sibilant, dims into a softer hiss as
  // it dies — the audio analogue of the smoke wisp losing energy.
  const noise = makeNoiseBurst(c)
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.setValueAtTime(6500 * jitter(0.06), now)
  hp.frequency.exponentialRampToValueAtTime(3500 * jitter(0.06), now + 0.8)
  hp.Q.value = 0.9

  // Peaking boost at ~6.8 kHz adds the focused resonance that makes
  // noise read as a spoken /s/ rather than wash. +6 dB with moderate Q
  // is enough character without becoming a whistle.
  const peak = c.createBiquadFilter()
  peak.type = 'peaking'
  peak.frequency.value = 6800 * jitter(0.05)
  peak.gain.value = 6
  peak.Q.value = 1.8

  // Multi-stage envelope: attack → gentle initial decay → sustained
  // body → soft mid-tail → final fade. Splitting into smaller per-
  // stage ratios (~2× each) keeps the perceived fade linear; a single
  // long exponentialRamp from peak to silence would dump most of the
  // audible energy in the first 100ms and read as "cut off" no matter
  // how long the stop time is.
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.07 * jitter(0.15) * I, now + 0.025)
  ng.gain.exponentialRampToValueAtTime(0.05 * I, now + 0.2)
  ng.gain.exponentialRampToValueAtTime(0.025 * I, now + 0.45)
  ng.gain.exponentialRampToValueAtTime(0.008 * I, now + 0.72)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.95)
  noise.connect(hp).connect(peak).connect(ng).connect(out(c))
  noise.start(now)
  noise.stop(now + 0.97)
}

export function playBurnIgniteSfx(count = 1): void {
  if (isMuted()) return
  synthBurnIgnite(count)
}

export function playBurnBurstSfx(): void {
  if (isMuted()) return
  synthBurnBurst()
}

export function playBurnApplySfx(): void {
  if (isMuted()) return
  synthBurnApply()
}

export function playBurnFizzleSfx(count = 1): void {
  if (isMuted()) return
  synthBurnFizzle(count)
}

// Burn DoT impact — the "hit" beat when a burn-tick damage event lands
// on its target. Distinct from:
//   - synthBurnApply (the whoosh at spawn time, "fire about to curl in")
//   - synthBurnBurst (tile-clear pop, with a pitched chirp)
// This one is just sizzle + low whump — fire-themed impact without
// borrowing the generic playAttackSfx. Scales with damage amount.
function synthBurnImpact(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(amount)

  // Low whump for the "thud" of the hit. Slightly louder than apply's
  // whump because this IS the impact, not the lead-in.
  const sub = c.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(120 * jitter(0.08), now)
  sub.frequency.exponentialRampToValueAtTime(60 * jitter(0.08), now + 0.1)
  const sg = c.createGain()
  sg.gain.setValueAtTime(0.0001, now)
  sg.gain.exponentialRampToValueAtTime(0.14 * I, now + 0.01)
  sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.14)
  sub.connect(sg).connect(out(c))
  sub.start(now)
  sub.stop(now + 0.16)

  // Mid-band sizzle: bandpassed noise that lingers ~150ms, mimicking
  // skin/cloth catching. Wider Q than ignite's whoosh so it reads as
  // texture, not movement.
  const sizzle = makeNoiseBurst(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(1200 * jitter(0.1), now)
  bp.frequency.exponentialRampToValueAtTime(600 * jitter(0.1), now + 0.15)
  bp.Q.value = 1.4
  const zg = c.createGain()
  zg.gain.setValueAtTime(0.0001, now)
  zg.gain.exponentialRampToValueAtTime(0.1 * jitter(0.2) * I, now + 0.012)
  zg.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
  sizzle.connect(bp).connect(zg).connect(out(c))
  sizzle.start(now)
  sizzle.stop(now + 0.2)

  // 1-2 crackle pops to sell "fire damage" specifically. Few, quick.
  const pops = amount >= 3 ? 2 : 1
  for (let i = 0; i < pops; i++) {
    const offset = 0.005 + Math.random() * 0.05
    const n2 = makeNoiseBurst(c)
    const bp2 = c.createBiquadFilter()
    bp2.type = 'bandpass'
    bp2.frequency.value = 2400 + Math.random() * 1400
    bp2.Q.value = 5
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, now + offset)
    g.gain.exponentialRampToValueAtTime(0.05 * jitter(0.3), now + offset + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.05)
    n2.connect(bp2).connect(g).connect(out(c))
    n2.start(now + offset)
    n2.stop(now + offset + 0.07)
  }
}

export function playBurnImpactSfx(amount = 1): void {
  if (isMuted()) return
  synthBurnImpact(amount)
}
