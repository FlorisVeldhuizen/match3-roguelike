import { getCtx, isMuted, out } from '../context'
import { intensity, jitter, makeNoiseBurst } from '../utils'

// ---- Fire-synthesis helpers ----
// Brown-noise approximation: white noise cascaded through two lowpass
// filters at the supplied cutoff. Returns the source + the post-filter
// output node so the caller can route into further filters/gain. Caller
// is responsible for src.start() / src.stop().
function brownishNoise(
  c: AudioContext,
  cutoffHz: number,
): { src: AudioBufferSourceNode; out: AudioNode } {
  const src = makeNoiseBurst(c)
  const lp1 = c.createBiquadFilter()
  lp1.type = 'lowpass'
  lp1.frequency.value = cutoffHz
  lp1.Q.value = 0.7
  const lp2 = c.createBiquadFilter()
  lp2.type = 'lowpass'
  lp2.frequency.value = cutoffHz
  lp2.Q.value = 0.7
  src.connect(lp1).connect(lp2)
  return { src, out: lp2 }
}

// Amplitude-modulating gain: oscillates around `base` ± `depth` at
// `rateHz` for `durSec`. This is what gives fire its flicker — without
// an LFO modulating the noise body's gain, the cue sounds like a static
// hiss instead of a living flame.
function makeFlickerGain(
  c: AudioContext,
  t0: number,
  base: number,
  depth: number,
  rateHz: number,
  durSec: number,
): GainNode {
  const g = c.createGain()
  g.gain.setValueAtTime(base, t0)
  const lfo = c.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = rateHz
  const lfoGain = c.createGain()
  lfoGain.gain.value = depth
  lfo.connect(lfoGain).connect(g.gain)
  lfo.start(t0)
  lfo.stop(t0 + durSec + 0.02)
  return g
}

// Tile ignite: Smolder's tile-burn intent lights N cells. Whoosh + low
// rumble + sustained mid-roar bed + popping crackle. Layers tuned so
// the cue clearly reads as "fire catches" — distinct from a generic
// whoosh — without overpowering the per-match cues that follow.
function synthBurnIgnite(count: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(count)

  // Bandpass whoosh, sweeping up — air being sucked toward the flame.
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

  // Sustained lowpassed roar — the "body" of the fire. Sits behind the
  // whoosh, in front of the rumble.
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

  // Low rumble: 95→55Hz sine for impact body.
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
  // 150ms — uneven, alive, like a flame actually catching.
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

// Burn burst: one or more burning tiles got matched. One cue per match
// (scaled by count), not one cue per cell — N per-cell bursts staggered
// 35ms apart sample-loop into a muddy "buzz" on big multi-cell clears.
// The visual already shows N bursts; the audio just needs to land once.
function synthBurnBurst(count: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(count)

  // Pitched chirp — fwoosh curl as the flame jumps and dies. 260→760 Hz.
  const osc = c.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(260 * jitter(0.1), now)
  osc.frequency.exponentialRampToValueAtTime(760 * jitter(0.1), now + 0.1)
  const og = c.createGain()
  og.gain.setValueAtTime(0.0001, now)
  og.gain.exponentialRampToValueAtTime(0.17 * jitter(0.2) * I, now + 0.01)
  og.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
  osc.connect(og).connect(out(c))
  osc.start(now)
  osc.stop(now + 0.2)

  // Crackle: highpassed noise — sparks flying outward.
  const noise = makeNoiseBurst(c)
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 2000
  hp.Q.value = 0.8
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.12 * jitter(0.2) * I, now + 0.006)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.15)
  noise.connect(hp).connect(ng).connect(out(c))
  noise.start(now)
  noise.stop(now + 0.17)
}

// Burn-apply: pure brown-noise roar + flicker LFO + soft sub. No crackle
// bed and no mid-band sizzle — both read as bubbling liquid rather than
// fire when sustained. Reads as "the flame is here to stay" — locked in
// vs. roar/fireball/combust alternatives after A/B.
function synthBurnApplyBonfire(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const DUR = 0.48

  // Sustained body with slow attack — the bonfire "settling on you".
  const body = brownishNoise(c, 600)
  const env = c.createGain()
  env.gain.setValueAtTime(0.0001, now)
  env.gain.exponentialRampToValueAtTime(1, now + 0.05)
  env.gain.setValueAtTime(1, now + 0.3)
  env.gain.exponentialRampToValueAtTime(0.0001, now + DUR)
  const flicker = makeFlickerGain(c, now, 0.16, 0.1, 10, DUR)
  body.out.connect(env).connect(flicker).connect(out(c))
  body.src.start(now)
  body.src.stop(now + DUR + 0.02)

  // Soft sub
  const sub = c.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(60, now)
  sub.frequency.exponentialRampToValueAtTime(40, now + 0.3)
  const sg = c.createGain()
  sg.gain.setValueAtTime(0.0001, now)
  sg.gain.exponentialRampToValueAtTime(0.13, now + 0.05)
  sg.gain.exponentialRampToValueAtTime(0.0001, now + DUR)
  sub.connect(sg).connect(out(c))
  sub.start(now)
  sub.stop(now + DUR + 0.02)
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
  // noise read as a spoken /s/ rather than wash.
  const peak = c.createBiquadFilter()
  peak.type = 'peaking'
  peak.frequency.value = 6800 * jitter(0.05)
  peak.gain.value = 6
  peak.Q.value = 1.8

  // Multi-stage envelope keeps the perceived fade linear; a single long
  // exponentialRamp from peak to silence would dump most of the audible
  // energy in the first 100ms and read as "cut off" no matter how long
  // the stop time is.
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

// Burn-impact: heavy oven-blast feel. Strong bass, brown-noise body with
// 9Hz flicker, no crackle bed (it read as bubbling on the sustained
// roar). Reads as "the AIR went hot" — locked in vs. scorch/searing/
// gasburn alternatives after A/B.
function synthBurnImpactFurnace(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(amount)
  const DUR = 0.38

  // Heavy sub — the bass of a furnace door opening
  const sub = c.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(90 * jitter(0.05), now)
  sub.frequency.exponentialRampToValueAtTime(38 * jitter(0.05), now + 0.22)
  const sg = c.createGain()
  sg.gain.setValueAtTime(0.0001, now)
  sg.gain.exponentialRampToValueAtTime(0.24 * I, now + 0.018)
  sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
  sub.connect(sg).connect(out(c))
  sub.start(now)
  sub.stop(now + 0.32)

  // Brown-noise body with strong flicker
  const body = brownishNoise(c, 500)
  const bEnv = c.createGain()
  bEnv.gain.setValueAtTime(0.0001, now)
  bEnv.gain.exponentialRampToValueAtTime(0.2 * I, now + 0.04)
  bEnv.gain.exponentialRampToValueAtTime(0.0001, now + DUR)
  const bFlicker = makeFlickerGain(c, now, 1, 0.35, 9, DUR)
  body.out.connect(bEnv).connect(bFlicker).connect(out(c))
  body.src.start(now)
  body.src.stop(now + DUR + 0.02)
}

export function playBurnIgniteSfx(count = 1): void {
  if (isMuted()) return
  synthBurnIgnite(count)
}

export function playBurnBurstSfx(count = 1): void {
  if (isMuted()) return
  synthBurnBurst(count)
}

export function playBurnFizzleSfx(count = 1): void {
  if (isMuted()) return
  synthBurnFizzle(count)
}

export function playBurnApplySfx(): void {
  if (isMuted()) return
  synthBurnApplyBonfire()
}

export function playBurnImpactSfx(amount = 1): void {
  if (isMuted()) return
  synthBurnImpactFurnace(amount)
}
