import { getCtx, isMuted, out } from '../context'
import { jitter } from '../utils'

// --- Turn-start variants ---
// Begin-of-turn cue for "Your Turn". Originally a soft two-note doorbell
// (E4→B4) but felt too quiet/unclear, so we expose a few alternatives via
// the picker. All sit a full octave below the cascade chime so they occupy
// their own register and read as "your turn" rather than "cascade resolved".
// Same music-box sine palette as the cascade chime to keep the cue family
// coherent.

// Doorbell (original baseline): soft two-note ascending fifth (E4 → B4),
// slow 25ms attack. Read as "calm pickup" rather than "alert".
function synthTurnStartDoorbell(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const gap = 0.085 + (Math.random() - 0.5) * 0.01
  const notes: [number, number][] = [
    [330, 0],
    [494, gap],
  ]
  for (const [freq, offset] of notes) {
    const partials: [number, number, number][] = [
      [1.0, 0.06, 520],
      [2.0, 0.02, 280],
      [4.0, 0.006, 130],
    ]
    const attackTime = 0.025 * jitter(0.2)
    for (const [ratio, peak, decay] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq * ratio
      const peakJ = peak * jitter(0.2)
      const decayS = (decay / 1000) * jitter(0.15)
      const t = now + offset
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peakJ, t + attackTime)
      g.gain.exponentialRampToValueAtTime(0.0001, t + decayS)
      osc.connect(g).connect(out(c))
      osc.start(t)
      osc.stop(t + decayS + 0.02)
    }
  }
}

// Triad (LOCKED IN): three-note ascending major triad (A4 → C#5 → E5).
// Brighter register than doorbell, soft mallet-style attack so the ascent
// reads as "settled" rather than "alert". The triadic climb does the
// signaling — volume stays modest. Picker UI removed; setTurnStartVariant()
// still reaches the alternatives if we want to re-audition.
//
// Tuning history:
//   - initial lock-in: 0.07 / 0.025 / 0.008 partial peaks, 12ms attack
//   - first trim:      0.05 / 0.018 / 0.0055 (~30% cut, mastering pass)
//   - chill pass:      0.038 / 0.013 / 0.003 (~25% further cut on the
//                      fundamental + octave, ~45% cut on the 4× sparkle
//                      partial — that bright top was what gave the cue
//                      its alert edge). Attack stretched 12→22 ms so the
//                      onset is mallet-soft, not pingy.
//
// Master compressor in context.ts further tames the stacked partials; this
// per-cue trim is the primary control for "feels loud".
function synthTurnStartTriad(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const baseFreq = 440 // A4
  // Major triad: root → major third → perfect fifth.
  const RATIOS = [1.0, 5 / 4, 3 / 2]
  const stagger = 0.065 + (Math.random() - 0.5) * 0.01
  for (let i = 0; i < RATIOS.length; i++) {
    const ratio = RATIOS[i]
    if (ratio === undefined) continue
    const t = now + stagger * i
    const isLast = i === RATIOS.length - 1
    const decayMul = isLast ? 1.6 : 1.0
    const partials: [number, number, number][] = [
      [1.0, 0.038, 380 * decayMul],
      [2.0, 0.013, 220 * decayMul],
      [4.0, 0.003, 110 * decayMul],
    ]
    const attackTime = 0.022 * jitter(0.22)
    for (const [pRatio, peak, decay] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = baseFreq * ratio * pRatio
      const peakJ = peak * jitter(0.18)
      const decayS = (decay / 1000) * jitter(0.15)
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peakJ, t + attackTime)
      g.gain.exponentialRampToValueAtTime(0.0001, t + decayS)
      osc.connect(g).connect(out(c))
      osc.start(t)
      osc.stop(t + decayS + 0.02)
    }
  }
}

// Bell: single struck note (A4) with classic bell partials. Decays long
// enough to feel like a "bell rang" rather than a tap. Strikes once,
// rings out — clearest possible "turn started" signal because there's
// nothing else competing.
function synthTurnStartBell(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const baseFreq = 440 * jitter(0.02)
  // Inharmonic bell partials — ratios drawn from a struck-metal model.
  // 2.756 and 5.404 give the "ringing bell" character without committing
  // to a full church-bell decay.
  const partials: [number, number, number][] = [
    [1.0, 0.1, 700],
    [2.0, 0.04, 400],
    [2.756, 0.025, 320],
    [5.404, 0.012, 180],
  ]
  const attackTime = 0.004
  for (const [ratio, peak, decay] of partials) {
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = baseFreq * ratio
    const peakJ = peak * jitter(0.15)
    const decayS = (decay / 1000) * jitter(0.12)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(peakJ, now + attackTime)
    g.gain.exponentialRampToValueAtTime(0.0001, now + decayS)
    osc.connect(g).connect(out(c))
    osc.start(now)
    osc.stop(now + decayS + 0.02)
  }
}

export const TURN_START_VARIANTS = ['doorbell', 'triad', 'bell'] as const
export type TurnStartVariant = (typeof TURN_START_VARIANTS)[number]
const TURN_START_VARIANT_KEY = 'turn-start-variant'
const DEFAULT_TURN_START_VARIANT: TurnStartVariant = 'triad'

function readTurnStartVariant(): TurnStartVariant {
  try {
    const v = localStorage.getItem(TURN_START_VARIANT_KEY) as TurnStartVariant | null
    if (v && (TURN_START_VARIANTS as readonly string[]).includes(v)) return v
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_TURN_START_VARIANT
}

let turnStartVariant: TurnStartVariant = readTurnStartVariant()
const turnStartVariantListeners = new Set<(v: TurnStartVariant) => void>()

export function getTurnStartVariant(): TurnStartVariant {
  return turnStartVariant
}

export function setTurnStartVariant(v: TurnStartVariant): void {
  turnStartVariant = v
  try {
    localStorage.setItem(TURN_START_VARIANT_KEY, v)
  } catch {
    // no-op
  }
  for (const l of turnStartVariantListeners) l(v)
}

export function subscribeTurnStartVariant(
  listener: (v: TurnStartVariant) => void,
): () => void {
  turnStartVariantListeners.add(listener)
  return () => {
    turnStartVariantListeners.delete(listener)
  }
}

function synthTurnStartForVariant(v: TurnStartVariant): void {
  switch (v) {
    case 'doorbell':
      return synthTurnStartDoorbell()
    case 'triad':
      return synthTurnStartTriad()
    case 'bell':
      return synthTurnStartBell()
  }
}

export function playTurnStartSfx(): void {
  if (isMuted()) return
  synthTurnStartForVariant(turnStartVariant)
}

// Audition — bypasses mute so the picker isn't silent on mute.
export function previewTurnStartVariant(v: TurnStartVariant): void {
  synthTurnStartForVariant(v)
}

// --- Enemy-turn variants ---
// New cue announcing the "Enemy Turn" banner. Inverted palette versus the
// turn-start cue: down + dark + weighted, instead of up + bright + airy.
// Same sine partial family as the rest of the audio so it sits in the same
// "instrument world" — just darker.

// Descend (LOCKED IN): minor third descending in the low register
// (A3 → F3) on sine partials, with a sub-thud (~80 Hz) anchor at the
// downbeat. The slight detune on the upper partial gives a barely-audible
// beat — dread without horror-movie cheese. Picker UI removed;
// setEnemyTurnVariant() still reaches the alternatives.
//
// Tuning history (parallel to triad — both fire every phase transition):
//   - initial lock-in: 0.09 / 0.025 partials, 0.015 detune, 0.12 sub-thud
//   - first trim:      0.063 / 0.018 / 0.011 / 0.084 (~30% cut)
//   - chill pass:      0.048 / 0.014 / 0.008 / 0.055 (further ~25% cut on
//                      partials, ~35% on sub-thud — that low layer was the
//                      dominant perceptual weight). Attack stretched
//                      18→22 ms to match triad's mallet-soft onset.
//
// Sub-thud kept proportionally heavier than the triad's brightness layer
// because the descend's identity is *weight*, not sparkle. Both cues now
// sit in roughly the same loudness band — neither dominates the other.
function synthEnemyTurnDescend(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const gap = 0.1 + (Math.random() - 0.5) * 0.012
  // A3 → F3 (descending minor third). Pinned musically; per-call pitch
  // wobble lives in the detuned partial below.
  const notes: [number, number][] = [
    [220, 0],
    [174.6, gap],
  ]
  for (const [freq, offset] of notes) {
    // Two sine partials: fundamental and octave, plus a slightly detuned
    // octave (+6 cents) to give a soft beat.
    const partials: [number, number, number][] = [
      [1.0, 0.048, 340],
      [2.0, 0.014, 200],
    ]
    const attackTime = 0.022 * jitter(0.2)
    const t = now + offset
    for (const [ratio, peak, decay] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq * ratio
      const peakJ = peak * jitter(0.15)
      const decayS = (decay / 1000) * jitter(0.12)
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peakJ, t + attackTime)
      g.gain.exponentialRampToValueAtTime(0.0001, t + decayS)
      osc.connect(g).connect(out(c))
      osc.start(t)
      osc.stop(t + decayS + 0.02)
    }
    // Detuned octave — slightly sharp (~+6 cents = factor 1.00347) so it
    // beats against the clean octave at ~1 Hz, giving a soft pulse.
    const detune = c.createOscillator()
    detune.type = 'sine'
    detune.frequency.value = freq * 2.0 * 1.00347
    const dg = c.createGain()
    dg.gain.setValueAtTime(0.0001, t)
    dg.gain.exponentialRampToValueAtTime(0.008, t + 0.022)
    dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    detune.connect(dg).connect(out(c))
    detune.start(t)
    detune.stop(t + 0.24)
  }
  // Sub-thud anchor: brief ~80 Hz sine pulse at the downbeat for weight.
  const sub = c.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(95 * jitter(0.08), now)
  sub.frequency.exponentialRampToValueAtTime(60, now + 0.14)
  const sg = c.createGain()
  sg.gain.setValueAtTime(0.0001, now)
  sg.gain.exponentialRampToValueAtTime(0.055 * jitter(0.18), now + 0.006)
  sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
  sub.connect(sg).connect(out(c))
  sub.start(now)
  sub.stop(now + 0.18)
}

// Stab: sharp downward saw stab from F3 → C3, lowpassed to keep it from
// being harsh. Most "incoming threat" of the variants — single gesture, no
// ringing tail. Reads as a brass stab without the brass timbre.
function synthEnemyTurnStab(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const dur = 0.32 * jitter(0.1)
  const startFreq = 175 * jitter(0.06) // ~F3
  const endFreq = 130 * jitter(0.06) // ~C3
  const osc = c.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(startFreq, now)
  osc.frequency.exponentialRampToValueAtTime(endFreq, now + dur * 0.6)
  // Lowpass with descending cutoff — opens, then closes, so the timbre
  // darkens as the pitch falls. Q kept low so it doesn't whistle.
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 1.4
  lp.frequency.setValueAtTime(1400 * jitter(0.1), now)
  lp.frequency.exponentialRampToValueAtTime(500, now + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, now)
  g.gain.exponentialRampToValueAtTime(0.18 * jitter(0.15), now + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  osc.connect(lp).connect(g).connect(out(c))
  osc.start(now)
  osc.stop(now + dur + 0.02)
  // Sub-thud — same anchor as descend, gives the stab weight.
  const sub = c.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(85 * jitter(0.08), now)
  sub.frequency.exponentialRampToValueAtTime(55, now + 0.12)
  const sg = c.createGain()
  sg.gain.setValueAtTime(0.0001, now)
  sg.gain.exponentialRampToValueAtTime(0.1, now + 0.005)
  sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.14)
  sub.connect(sg).connect(out(c))
  sub.start(now)
  sub.stop(now + 0.16)
}

// Dread: tritone (A3 + Eb4) struck together on sine partials, no descent,
// no movement — just an unresolved interval ringing. Most "ominous" of the
// variants, but stays musical because the partials are pure sines, not
// detuned/distorted.
function synthEnemyTurnDread(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  // A3 + Eb4 — augmented fourth / tritone, the classic unresolved interval.
  const freqs = [220 * jitter(0.02), 311.1 * jitter(0.02)]
  for (const freq of freqs) {
    const partials: [number, number, number][] = [
      [1.0, 0.08, 420],
      [2.0, 0.022, 240],
    ]
    const attackTime = 0.022
    for (const [ratio, peak, decay] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq * ratio
      const peakJ = peak * jitter(0.15)
      const decayS = (decay / 1000) * jitter(0.12)
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(peakJ, now + attackTime)
      g.gain.exponentialRampToValueAtTime(0.0001, now + decayS)
      osc.connect(g).connect(out(c))
      osc.start(now)
      osc.stop(now + decayS + 0.02)
    }
  }
  // Sub-anchor — same weight as descend/stab, ties the family together.
  const sub = c.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(73.4 * jitter(0.06), now) // D2-ish
  sub.frequency.exponentialRampToValueAtTime(55, now + 0.18)
  const sg = c.createGain()
  sg.gain.setValueAtTime(0.0001, now)
  sg.gain.exponentialRampToValueAtTime(0.1, now + 0.006)
  sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.2)
  sub.connect(sg).connect(out(c))
  sub.start(now)
  sub.stop(now + 0.22)
}

export const ENEMY_TURN_VARIANTS = ['descend', 'stab', 'dread'] as const
export type EnemyTurnVariant = (typeof ENEMY_TURN_VARIANTS)[number]
const ENEMY_TURN_VARIANT_KEY = 'enemy-turn-variant'
const DEFAULT_ENEMY_TURN_VARIANT: EnemyTurnVariant = 'descend'

function readEnemyTurnVariant(): EnemyTurnVariant {
  try {
    const v = localStorage.getItem(ENEMY_TURN_VARIANT_KEY) as EnemyTurnVariant | null
    if (v && (ENEMY_TURN_VARIANTS as readonly string[]).includes(v)) return v
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_ENEMY_TURN_VARIANT
}

let enemyTurnVariant: EnemyTurnVariant = readEnemyTurnVariant()
const enemyTurnVariantListeners = new Set<(v: EnemyTurnVariant) => void>()

export function getEnemyTurnVariant(): EnemyTurnVariant {
  return enemyTurnVariant
}

export function setEnemyTurnVariant(v: EnemyTurnVariant): void {
  enemyTurnVariant = v
  try {
    localStorage.setItem(ENEMY_TURN_VARIANT_KEY, v)
  } catch {
    // no-op
  }
  for (const l of enemyTurnVariantListeners) l(v)
}

export function subscribeEnemyTurnVariant(
  listener: (v: EnemyTurnVariant) => void,
): () => void {
  enemyTurnVariantListeners.add(listener)
  return () => {
    enemyTurnVariantListeners.delete(listener)
  }
}

function synthEnemyTurnForVariant(v: EnemyTurnVariant): void {
  switch (v) {
    case 'descend':
      return synthEnemyTurnDescend()
    case 'stab':
      return synthEnemyTurnStab()
    case 'dread':
      return synthEnemyTurnDread()
  }
}

export function playEnemyTurnSfx(): void {
  if (isMuted()) return
  synthEnemyTurnForVariant(enemyTurnVariant)
}

export function previewEnemyTurnVariant(v: EnemyTurnVariant): void {
  synthEnemyTurnForVariant(v)
}

// Extra-turn chime — a 4-note ascending major arpeggio (root → 3rd → 5th →
// octave) in the same music-box voice. Originally tuned brighter/louder as
// a reward cue, but pulled back to match the triad/descend chillness pass
// so all three turn-banner cues sit in the same loudness band. The reward
// character now comes from the *arpeggio shape* + the sparkle layer, not
// from extra volume. Sits a fourth above the cascade chime base (G5 root)
// so it doesn't collide with the cascade band.
//
// Tuning: partial peaks 0.08/0.028/0.01 → 0.055/0.019/0.004 (~30% cut on
// fundamental + octave, ~60% on the 4× sparkle partial, matching how the
// triad shed its bright top). Sparkle pings 0.022 → 0.015. Attack stretched
// 16 → 22 ms.
function synthExtraTurn(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  // G major arpeggio: G5 → B5 → D6 → G6 (1, 5/4, 3/2, 2 ratios from G5=784Hz).
  const baseFreq = 784
  const ARP_RATIOS = [1, 5 / 4, 3 / 2, 2]
  const stagger = 0.075 + (Math.random() - 0.5) * 0.015
  for (let i = 0; i < ARP_RATIOS.length; i++) {
    const ratio = ARP_RATIOS[i]
    if (ratio === undefined) continue
    const t = now + stagger * i
    const isLast = i === ARP_RATIOS.length - 1
    // Last note rings out roughly 2× longer than mid notes — turns the
    // arpeggio into a clear "landing", not a four-note tap.
    const decayMul = isLast ? 2.0 : 1.0
    const partials: [number, number, number][] = [
      [1.0, 0.055, 480 * decayMul],
      [2.0, 0.019, 280 * decayMul],
      [4.0, 0.004, 150 * decayMul],
    ]
    const attackTime = 0.022 * jitter(0.22)
    for (const [pRatio, peak, decay] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = baseFreq * ratio * pRatio
      const peakJ = peak * jitter(0.2)
      const decayS = (decay / 1000) * jitter(0.18)
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peakJ, t + attackTime)
      g.gain.exponentialRampToValueAtTime(0.0001, t + decayS)
      osc.connect(g).connect(out(c))
      osc.start(t)
      osc.stop(t + decayS + 0.02)
    }
  }

  // Sparkle layer — 3 high pinged sines scattered across the arpeggio.
  // Same shimmer idea as cascade-celebration but always-on here (extra-turn
  // is rare enough that a sparkle each time stays special, not annoying).
  const arpDur = stagger * (ARP_RATIOS.length - 1) + 0.3
  for (let i = 0; i < 3; i++) {
    const t = now + 0.05 + Math.random() * arpDur
    const freq = baseFreq * (3 + Math.random() * 2.5) // 2.4 kHz – 4.4 kHz band
    if (freq > 5000) continue
    const ping = c.createOscillator()
    ping.type = 'sine'
    ping.frequency.value = freq
    const pg = c.createGain()
    pg.gain.setValueAtTime(0.0001, t)
    pg.gain.exponentialRampToValueAtTime(0.015, t + 0.008)
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    ping.connect(pg).connect(out(c))
    ping.start(t)
    ping.stop(t + 0.2)
  }
}

export function playExtraTurnSfx(): void {
  if (isMuted()) return
  synthExtraTurn()
}
