import { getCtx, isMuted, out } from '../context'
import { intensity, jitter, makeNoiseBurst, schedRingPartial } from '../utils'

// ---- Heal / health-potion variants ----
// Bleep (the original/baseline) is a two-note arcade pickup with a fizzy
// noise sprinkle. Variants below explore different "what does drinking a
// potion sound like" sketches: pure music-box chime, pure bubbling fizz
// (no melody), longer rising arpeggio, slow-swell pad, scattered sparkle,
// and a three-note chord.

// Bleep (baseline): Two-note arcade pickup (root → perfect fifth) on a
// square wave for the classic 8-bit pickup character, with a bandpassed
// noise sprinkle threaded behind it so the cue reads as "fizzy" / "rustly"
// rather than a clean tone. Tiny pitch jitter per call so chained heals
// don't sound like a tape loop.
function synthHealBleep(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(amount)
  // Bumped from 3% → 5% pitch wobble. 3% was too subtle to register against
  // the bleep's strong tonal character.
  const pitchJ = jitter(0.05)
  // Slight overlap variation between root and fifth so the "bounce" rhythm
  // doesn't sample-loop on rapid heals.
  const fifthOffset = 0.07 + (Math.random() - 0.5) * 0.015

  // Two-note bleep: 80ms on the root, then 110ms on the fifth above.
  // Square gives the arcade timbre; a hair of lowpass keeps it from biting.
  const notes: [number, number, number][] = [
    [660 * pitchJ, 0, 0.08], // root, t-offset, duration
    [990 * pitchJ, fifthOffset, 0.11], // perfect fifth, slight overlap
  ]
  for (const [freq, offset, dur] of notes) {
    const osc = c.createOscillator()
    osc.type = 'square'
    osc.frequency.value = freq
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 3200
    lp.Q.value = 0.7
    const g = c.createGain()
    const t = now + offset
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.14 * I, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(lp).connect(g).connect(out(c))
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  // Fizz: short bandpassed noise burst riding under the bleep — the
  // "rustle" of potion bubbling/sparkling. Bandpass keeps it from hissing.
  // Bigger heals get more fizz — louder, longer, brighter.
  const fizzDur = 0.22 * (0.85 + 0.3 * (I - 1) / 0.7)
  const noise = makeNoiseBurst(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(2400, now)
  bp.frequency.exponentialRampToValueAtTime(3600, now + fizzDur)
  bp.Q.value = 2.5
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.06 * I, now + 0.01)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + fizzDur)
  noise.connect(bp).connect(ng).connect(out(c))
  noise.start(now)
  noise.stop(now + fizzDur + 0.02)
}

// Chime: mellow pure-sine version of the bleep. Same two-note pattern (root
// → perfect fifth) but pure sines and no fizz — music-box character rather
// than arcade. Slightly longer decays so it doesn't feel rushed without the
// noise underneath.
function synthHealChime(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(amount)
  const pitchJ = jitter(0.05)
  const fifthOffset = 0.075 + (Math.random() - 0.5) * 0.015

  schedRingPartial(c, now, 660 * pitchJ, 0.11 * I, 0.18, 0.005)
  schedRingPartial(c, now + fifthOffset, 990 * pitchJ, 0.11 * I, 0.22, 0.005)
}

// Bubble: pure potion-bubbling — no melodic content. Three bandpassed-noise
// bursts at random frequencies in the 1.5–3.5 kHz band, scattered across
// 180ms. Reads as "you're drinking something" without any acquisition pip.
function synthHealBubble(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(amount)

  for (let i = 0; i < 3; i++) {
    const t = now + i * 0.055 + Math.random() * 0.025
    const dur = 0.06
    const burst = makeNoiseBurst(c)
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1500 + Math.random() * 2000
    bp.Q.value = 2.2
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.1 * I, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    burst.connect(bp).connect(g).connect(out(c))
    burst.start(t)
    burst.stop(t + dur + 0.02)
  }
}

// Arpeggio: longer rising 4-note major arpeggio (root + third + fifth +
// octave). Starts at 520 Hz so the run climbs into chime territory. Reads
// as a more deliberate "you regained health" pattern than the 2-note bleep.
function synthHealArpeggio(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(amount)
  const pitchJ = jitter(0.04)

  const base = 520 * pitchJ
  // Root + major third + perfect fifth + octave.
  const RATIOS = [1.0, 1.26, 1.5, 2.0]
  for (let i = 0; i < RATIOS.length; i++) {
    const ratio = RATIOS[i]
    if (ratio === undefined) continue
    schedRingPartial(c, now + i * 0.04, base * ratio, 0.085 * I, 0.16, 0.004)
  }
}

// Swell: slow-attack sustained sine pad — 60ms swell-in, 400ms decay, two
// octave-stacked partials (root + octave). Reads as warm regenerative
// healing rather than a quick pickup pip. Most "passive heal" of the variants.
function synthHealSwell(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(amount)
  const pitchJ = jitter(0.04)

  const root = 520 * pitchJ
  schedRingPartial(c, now, root, 0.09 * I, 0.4, 0.06)
  schedRingPartial(c, now, root * 2.0, 0.045 * I, 0.3, 0.06)
}

// Sparkle: scattered high pings — same family as armor's sparkle but in a
// slightly lower band (1.6–3.2 kHz). 5 short sine pings, random frequencies,
// scattered across 180ms. Reads as "magical healing energy" rather than
// "drinking a potion".
function synthHealSparkle(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(amount)

  for (let i = 0; i < 5; i++) {
    const t = now + Math.random() * 0.18
    const freq = 1600 + Math.random() * 1600
    schedRingPartial(c, t, freq, 0.06 * I, 0.1, 0.003)
  }
}

// Chord: three notes played simultaneously — root + fifth + octave — at
// 520/780/1040 Hz on pure sines. Same arpeggio notes as Arpeggio but all at
// once instead of in sequence. Reads as a brief warm triadic chime, no
// time-spread climb.
function synthHealChord(amount: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = intensity(amount)
  const pitchJ = jitter(0.04)

  const root = 520 * pitchJ
  schedRingPartial(c, now, root, 0.07 * I, 0.22, 0.005)
  schedRingPartial(c, now, root * 1.5, 0.055 * I, 0.2, 0.005)
  schedRingPartial(c, now, root * 2.0, 0.04 * I, 0.18, 0.005)
}

// --- Heal-variant selection ---

export const HEAL_VARIANTS = [
  'bleep',
  'chime',
  'bubble',
  'arpeggio',
  'swell',
  'sparkle',
  'chord',
] as const
export type HealVariant = (typeof HEAL_VARIANTS)[number]

const HEAL_VARIANT_KEY = 'heal-variant'
// Locked in as the 4-note rising arpeggio after picker A/B. The HealPicker UI
// has been removed; the variant machinery stays reachable via setHealVariant()
// so the alternatives can be re-auditioned without re-deriving them.
const DEFAULT_HEAL_VARIANT: HealVariant = 'arpeggio'

function readHealVariant(): HealVariant {
  try {
    const v = localStorage.getItem(HEAL_VARIANT_KEY) as HealVariant | null
    if (v && (HEAL_VARIANTS as readonly string[]).includes(v)) return v
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_HEAL_VARIANT
}

let healVariant: HealVariant = readHealVariant()
const healVariantListeners = new Set<(v: HealVariant) => void>()

export function getHealVariant(): HealVariant {
  return healVariant
}

export function setHealVariant(v: HealVariant): void {
  healVariant = v
  try {
    localStorage.setItem(HEAL_VARIANT_KEY, v)
  } catch {
    // no-op
  }
  for (const l of healVariantListeners) l(v)
}

export function subscribeHealVariant(
  listener: (v: HealVariant) => void,
): () => void {
  healVariantListeners.add(listener)
  return () => {
    healVariantListeners.delete(listener)
  }
}

function synthHealForVariant(v: HealVariant, amount: number): void {
  switch (v) {
    case 'bleep':
      return synthHealBleep(amount)
    case 'chime':
      return synthHealChime(amount)
    case 'bubble':
      return synthHealBubble(amount)
    case 'arpeggio':
      return synthHealArpeggio(amount)
    case 'swell':
      return synthHealSwell(amount)
    case 'sparkle':
      return synthHealSparkle(amount)
    case 'chord':
      return synthHealChord(amount)
  }
}

export function playHealSfx(amount = 1): void {
  if (isMuted()) return
  synthHealForVariant(healVariant, amount)
}

// Audition a heal variant — bypasses mute on purpose, matching previewDropVariant.
export function previewHealVariant(v: HealVariant): void {
  synthHealForVariant(v, 1)
}
