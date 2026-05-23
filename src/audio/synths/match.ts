import { getCtx, isMuted, out } from '../context'
import { jitter, makeNoiseBurst } from '../utils'

// Gem-match-clear variants — fires once per cleared cluster from a match.
// Like the drop cue, this fires very frequently, so all variants are mixed
// quietly. All variants scale with cluster size via the shared `I` factor
// (gentler curve than damage/heal — clack fires constantly and per-cell
// loudness boosts add up fast in a cascade).
function matchIntensity(clusterSize: number): number {
  return 1 + 0.18 * Math.log2(Math.max(1, clusterSize / 3))
}

// ---- Twinkle family ----
// All twinkle variants share the same DNA: a small number of short pure-sine
// pings, staggered. They differ in interval choice (octave / fifth / both)
// and timing. Twinkle (octave, default) is the anchor — Glint and Chirp
// are siblings that explore adjacent territory without losing minimalism.
//
// All use the same base frequency (1700 Hz) and same intensity-driven pitch
// scaling so the family feels coherent — only the interval pattern changes.

// Helper: render a sequence of staggered sine-ping notes at a given base
// frequency. Used by all three twinkle variants. Centralized here so they
// stay tightly comparable — the *only* differences between variants are
// the ratios array and the per-note stagger / peak / decay tuple.
function renderTwinkleSeq(
  c: AudioContext,
  now: number,
  base: number,
  detune: number,
  ratios: number[],
  stagger: number,
  peak: number,
  decay: number,
  attack: number,
  intensity: number,
): void {
  for (let i = 0; i < ratios.length; i++) {
    const ratio = ratios[i]
    if (ratio === undefined) continue
    const t = now + stagger * i
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = base * ratio * detune
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak * intensity, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    osc.connect(g).connect(out(c))
    osc.start(t)
    osc.stop(t + decay + 0.02)
  }
}

// Twinkle (default): root + octave. The user-validated minimal anchor.
function synthMatchTwinkle(clusterSize: number): void {
  const c = getCtx()
  if (!c) return
  const I = matchIntensity(clusterSize)
  const detune = jitter(0.025)
  const base = 1700 * (1 + 0.06 * (I - 1) / 0.18)
  renderTwinkleSeq(c, c.currentTime, base, detune, [1, 2], 0.012, 0.045, 0.08, 0.003, I)
}

// Glint: root + perfect fifth (7 semitones) instead of an octave. Smaller
// interval = a gentler tonal step — the cue reads as "two pings" rather
// than "low ping, high ping". Slightly quieter and shorter decay so the
// fifth doesn't accidentally land as a melody fragment.
function synthMatchGlint(clusterSize: number): void {
  const c = getCtx()
  if (!c) return
  const I = matchIntensity(clusterSize)
  const detune = jitter(0.025)
  const base = 1700 * (1 + 0.06 * (I - 1) / 0.18)
  // 2^(7/12) = perfect fifth (~1.498). Equal-tempered fifth so it lines up
  // cleanly with the cascade chime if both are playing.
  const FIFTH = Math.pow(2, 7 / 12)
  renderTwinkleSeq(
    c, c.currentTime, base, detune,
    [1, FIFTH],
    0.012,
    0.04,   // slightly quieter than Twinkle (0.045)
    0.07,   // slightly shorter decay (0.08 → 0.07)
    0.003,
    I,
  )
}

// Reserved (not bound): coin-pickup ping. Originally auditioned as a match-
// clear variant ("Chirp") — a tiny rising root-fifth-octave arpeggio in the
// twinkle voice. Validated by user as "a great sound for a coin", so it's
// parked here for a future coin / gold / loot cue. Not currently wired to
// any event. Call playCoinPingSfx() when that cue is introduced.
function synthCoinPing(amount: number): void {
  const c = getCtx()
  if (!c) return
  // Re-use matchIntensity for now — small/big coin gain reads bigger/louder
  // the same way a small/big match does. When the coin cue is wired up, swap
  // this for a coin-specific curve if needed.
  const I = matchIntensity(amount)
  const detune = jitter(0.025)
  const base = 1700 * (1 + 0.06 * (I - 1) / 0.18)
  const FIFTH = Math.pow(2, 7 / 12)
  renderTwinkleSeq(
    c, c.currentTime, base, detune,
    [1, FIFTH, 2],
    0.01,   // tighter stagger so three notes don't bleed into a melody
    0.035,  // each note quieter — three notes in a row sum louder than two
    0.07,   // short decay so the arp resolves fast
    0.003,
    I,
  )
}

export function playCoinPingSfx(amount = 1): void {
  if (isMuted()) return
  synthCoinPing(amount)
}

// ---- Whoosh family ----
// All whoosh variants share the same DNA: filtered noise with an upward
// frequency sweep and a swell envelope. They differ in sweep range, peak
// loudness, and whether they include a tonal anchor.

// Whoosh (formerly the only one): same upward sweep but ~50% louder and
// peaks earlier (35% into the cue, was 55%) so it punches forward instead
// of fading in from nothing. Slightly wider sweep range too — the previous
// version was hard to hear because the bandpass narrowed all the noise
// content into a thin slice.
function synthMatchWhoosh(clusterSize: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = matchIntensity(clusterSize)
  const dur = 0.095

  const noise = makeNoiseBurst(c)
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 400
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  // Q lowered from 1.6 → 1.3 — wider band lets more noise energy through.
  bp.Q.value = 1.3
  bp.frequency.setValueAtTime(550 * jitter(0.1), now)
  bp.frequency.exponentialRampToValueAtTime(2800 * jitter(0.1), now + dur)

  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, now)
  // Peak ~0.20 (was 0.13) and at 35% of duration (was 55%) — bigger swell
  // that lands forward, not from behind.
  g.gain.exponentialRampToValueAtTime(0.2 * I, now + dur * 0.35)
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  noise.connect(hp).connect(bp).connect(g).connect(out(c))
  noise.start(now)
  noise.stop(now + dur + 0.02)
}

// Swell: longer sibling of Whoosh — same sweep range and Q, but stretched
// out to 135ms and with the envelope peaking later (50% into the cue, was
// 35%). Reads as a more deliberate "draw-in" — the motion takes its time
// before resolving. Slightly quieter peak (0.18 vs 0.20) because the longer
// duration means more sustained energy.
function synthMatchSwell(clusterSize: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = matchIntensity(clusterSize)
  const dur = 0.135

  const noise = makeNoiseBurst(c)
  const hp = c.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 400
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 1.3
  bp.frequency.setValueAtTime(550 * jitter(0.1), now)
  bp.frequency.exponentialRampToValueAtTime(2800 * jitter(0.1), now + dur)

  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, now)
  g.gain.exponentialRampToValueAtTime(0.18 * I, now + dur * 0.5)
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  noise.connect(hp).connect(bp).connect(g).connect(out(c))
  noise.start(now)
  noise.stop(now + dur + 0.02)
}

// User auditioned all five against each other and locked in 'swell' as
// the match-clear cue. The picker UI was removed at that point, but the
// variant state stays so the underlying synth functions (twinkle / glint /
// whoosh / swell) remain reachable via setMatchVariant() — useful if we
// ever want to A/B again, swap defaults, or expose a new UI. 'chirp' was
// repurposed as the reserved coin-ping synth above; not listed here.
export const MATCH_VARIANTS = [
  'twinkle',
  'glint',
  'whoosh',
  'swell',
] as const
export type MatchVariant = (typeof MATCH_VARIANTS)[number]

const MATCH_VARIANT_KEY = 'match-variant'
const DEFAULT_MATCH_VARIANT: MatchVariant = 'swell'

function readMatchVariant(): MatchVariant {
  try {
    const v = localStorage.getItem(MATCH_VARIANT_KEY) as MatchVariant | null
    if (v && (MATCH_VARIANTS as readonly string[]).includes(v)) return v
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_MATCH_VARIANT
}

let matchVariant: MatchVariant = readMatchVariant()
const matchVariantListeners = new Set<(v: MatchVariant) => void>()

export function getMatchVariant(): MatchVariant {
  return matchVariant
}

export function setMatchVariant(v: MatchVariant): void {
  matchVariant = v
  try {
    localStorage.setItem(MATCH_VARIANT_KEY, v)
  } catch {
    // no-op
  }
  for (const l of matchVariantListeners) l(v)
}

export function subscribeMatchVariant(
  listener: (v: MatchVariant) => void,
): () => void {
  matchVariantListeners.add(listener)
  return () => {
    matchVariantListeners.delete(listener)
  }
}

function synthMatchForVariant(v: MatchVariant, clusterSize: number): void {
  switch (v) {
    case 'twinkle':
      return synthMatchTwinkle(clusterSize)
    case 'glint':
      return synthMatchGlint(clusterSize)
    case 'whoosh':
      return synthMatchWhoosh(clusterSize)
    case 'swell':
      return synthMatchSwell(clusterSize)
  }
}

export function playClackSfx(clusterSize = 3): void {
  if (isMuted()) return
  synthMatchForVariant(matchVariant, clusterSize)
}

// Audition a match variant at a representative cluster size. Mirrors
// previewDropVariant — bypasses mute so the picker isn't silent on mute.
export function previewMatchVariant(v: MatchVariant): void {
  synthMatchForVariant(v, 3)
}
