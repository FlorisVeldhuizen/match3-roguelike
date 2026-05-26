import { getCtx, isMuted, out } from '../context'
import { jitter, makeNoiseBurst } from '../utils'

// Caster hex apply — the moment the curse lands on every gem of the
// targeted colour. Sonic identity: high-band filtered noise sweep
// (arcane shimmer) + descending minor-3rd triad on a detuned sine
// voice (the curse "settling in"). Brief — ~400ms — so it doesn't
// crowd the per-match cues that follow once the player engages with
// the hexed colour.
function synthHexApply(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime

  // Shimmer layer: bandpass noise sweeping down 1800→900 Hz. The
  // descending sweep reads as "magic settling" rather than "magic
  // rising" (rising would feel like the player triggering something).
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

  // Chord layer: triad in a minor flavor (A4, C5, E5 → approx 440, 523,
  // 659). All three notes hit together (no arpeggio) — a single
  // "the hex is on" beat, slightly detuned per call so chained hex
  // events on multi-caster boards don't sample-loop.
  const detune = jitter(0.04)
  const FREQS = [440, 523, 659]
  const decay = 0.32
  for (const f of FREQS) {
    const osc = c.createOscillator()
    osc.type = 'sine'
    const startF = f * detune
    osc.frequency.setValueAtTime(startF, now)
    // Slight downward bend at the tail — sustains the "settling" arc.
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

// Brief zap when the player matches a hexed gem and Weak applies.
// One short detuned blip + softer noise tick — should read as
// "punishment, you walked into the curse" rather than a celebration.
// Scales subtly with stack count so a 5-line of hexed gems gets a
// bigger zap than a 3-match.
function synthHexTrigger(stacks: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const I = Math.min(1.4, 0.6 + stacks * 0.12)
  const dur = 0.22

  // Detuned descending sine — minor 3rd from E5 → C5.
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

  // Soft noise tick under the zap to give it physical body.
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

// Brief upward shimmer when a hex expires (turnsLeft reached 0).
// Reads as "curse breaking" — short, bright, optimistic without
// being celebratory (the player just survived a debuff window).
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
