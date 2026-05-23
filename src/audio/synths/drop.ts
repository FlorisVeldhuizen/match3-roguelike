import { getCtx, isMuted, out } from '../context'
import { jitter, makeNoiseBurst } from '../utils'

// Drop-sound variants — fires once per cascade step when columns settle. This
// cue fires a LOT (every cascade resolves at least once, deep chains many
// times) so all variants are mixed quieter than per-match cues like clack
// or attack. Peak gains here cap around 0.15 — about half of the original
// thump's 0.32 — to keep the cue subtle. User locked in 'clack' as the
// default after an A/B against the other four; the picker UI has been
// removed but the variants and dispatch remain so a new UI (or programmatic
// override via setDropVariant) can reach them.

// Thump: original low-frequency body slide, now turned down. Felt more than
// heard — for players who want a physical "settle" cue.
function synthDropThump(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const dur = 0.18 * jitter(0.15)
  const baseFreq = 78 + (Math.random() - 0.5) * 10
  const velocity = jitter(0.25)

  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(baseFreq * 1.7, now)
  osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, now + dur)

  const gain = c.createGain()
  gain.gain.setValueAtTime(0.0001, now)
  // Was 0.32 — toned down to 0.16 since this cue fires constantly during cascades.
  gain.gain.exponentialRampToValueAtTime(0.16 * velocity, now + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)

  const noise = makeNoiseBurst(c)
  const noiseGain = c.createGain()
  noiseGain.gain.setValueAtTime(0.05 * velocity, now)
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04)

  osc.connect(gain).connect(out(c))
  noise.connect(noiseGain).connect(out(c))
  osc.start(now)
  osc.stop(now + dur + 0.02)
  noise.start(now)
  noise.stop(now + 0.05)
}

// Clack: woody/percussive tap with almost no low body — closer to a wooden
// domino landing than a gem dropping into a slot. Bandpassed noise around
// 1.4 kHz (Q=4 keeps it tonal-woody, not hissy) plus a tiny low body sine
// for weight without committing to a thump.
function synthDropClack(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const pitchJ = jitter(0.18)
  const velocity = jitter(0.25)

  // The clack: short bandpassed noise burst. Q=4 narrows the band enough
  // to read as a defined "tac" rather than a wash of noise.
  const tacDur = 0.045
  const tac = makeNoiseBurst(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1400 * pitchJ
  bp.Q.value = 4
  const tg = c.createGain()
  tg.gain.setValueAtTime(0.0001, now)
  tg.gain.exponentialRampToValueAtTime(0.13 * velocity, now + 0.002)
  tg.gain.exponentialRampToValueAtTime(0.0001, now + tacDur)
  tac.connect(bp).connect(tg).connect(out(c))
  tac.start(now)
  tac.stop(now + tacDur + 0.02)

  // Light body: short sine ping at ~200 Hz. Almost subliminal — gives the
  // clack a hint of weight so it doesn't sound like only-treble.
  const body = c.createOscillator()
  body.type = 'sine'
  body.frequency.setValueAtTime(200 * pitchJ, now)
  body.frequency.exponentialRampToValueAtTime(150 * pitchJ, now + 0.04)
  const bg = c.createGain()
  bg.gain.setValueAtTime(0.0001, now)
  bg.gain.exponentialRampToValueAtTime(0.04 * velocity, now + 0.003)
  bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.05)
  body.connect(bg).connect(out(c))
  body.start(now)
  body.stop(now + 0.07)
}

// Tick: sharp/clicky high register — plastic-on-plastic click. Very short
// bandpassed noise at ~3 kHz with a high Q for a defined "snick". No body
// at all — this is the lightest variant, almost subliminal.
function synthDropTick(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const pitchJ = jitter(0.15)
  const velocity = jitter(0.3)

  const dur = 0.025
  const tick = makeNoiseBurst(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 3000 * pitchJ
  bp.Q.value = 5
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, now)
  g.gain.exponentialRampToValueAtTime(0.11 * velocity, now + 0.001)
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  tick.connect(bp).connect(g).connect(out(c))
  tick.start(now)
  tick.stop(now + dur + 0.02)
}

// Pebble: small stone landing on cloth. Lowpassed noise burst mid-range,
// pitch-jittered sine for the body. Sits between thump and clack — has
// a soft "plump" character without committing to either extreme.
function synthDropPebble(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const pitchJ = jitter(0.2)
  const velocity = jitter(0.25)

  // Lowpassed noise plump.
  const dur = 0.07
  const burst = makeNoiseBurst(c)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1200 * pitchJ
  lp.Q.value = 0.8
  const bg = c.createGain()
  bg.gain.setValueAtTime(0.0001, now)
  bg.gain.exponentialRampToValueAtTime(0.13 * velocity, now + 0.003)
  bg.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  burst.connect(lp).connect(bg).connect(out(c))
  burst.start(now)
  burst.stop(now + dur + 0.02)

  // Body weight — short sine in low-mid.
  const body = c.createOscillator()
  body.type = 'sine'
  body.frequency.setValueAtTime(180 * pitchJ, now)
  body.frequency.exponentialRampToValueAtTime(130 * pitchJ, now + 0.06)
  const og = c.createGain()
  og.gain.setValueAtTime(0.0001, now)
  og.gain.exponentialRampToValueAtTime(0.06 * velocity, now + 0.003)
  og.gain.exponentialRampToValueAtTime(0.0001, now + 0.08)
  body.connect(og).connect(out(c))
  body.start(now)
  body.stop(now + 0.1)
}

// Tap: bright glass/marble tap with a tonal hint. High bandpass + a brief
// sine ping at a related frequency. Reads as "ting" — small object on a
// hard surface. Cheery without being chimey.
function synthDropTap(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const pitchJ = jitter(0.15)
  const velocity = jitter(0.25)

  // Noise transient: bright, very short.
  const dur = 0.04
  const burst = makeNoiseBurst(c)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 2500 * pitchJ
  bp.Q.value = 3
  const bg = c.createGain()
  bg.gain.setValueAtTime(0.0001, now)
  bg.gain.exponentialRampToValueAtTime(0.1 * velocity, now + 0.001)
  bg.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  burst.connect(bp).connect(bg).connect(out(c))
  burst.start(now)
  burst.stop(now + dur + 0.02)

  // Tonal ping — quick sine at ~2.4 kHz with fast decay. Adds the "ting"
  // character; without it the burst alone reads as a hiss.
  const ping = c.createOscillator()
  ping.type = 'sine'
  ping.frequency.value = 2400 * pitchJ
  const pg = c.createGain()
  pg.gain.setValueAtTime(0.0001, now)
  pg.gain.exponentialRampToValueAtTime(0.05 * velocity, now + 0.002)
  pg.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
  ping.connect(pg).connect(out(c))
  ping.start(now)
  ping.stop(now + 0.08)
}

// --- Variant selection ---
// `playDropSfx` fires very frequently (once per cascade settle). The picker
// UI was removed once the user locked in 'clack', but the state machinery
// (variants list, localStorage persistence, dispatch switch) stays so a
// future UI — or a programmatic setDropVariant() call — can swap flavors
// without re-deriving them.

export const DROP_VARIANTS = [
  'clack',
  'thump',
  'tick',
  'pebble',
  'tap',
] as const
export type DropVariant = (typeof DROP_VARIANTS)[number]

const DROP_VARIANT_KEY = 'drop-variant'
const DEFAULT_DROP_VARIANT: DropVariant = 'clack'

function readDropVariant(): DropVariant {
  try {
    const v = localStorage.getItem(DROP_VARIANT_KEY) as DropVariant | null
    if (v && (DROP_VARIANTS as readonly string[]).includes(v)) return v
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_DROP_VARIANT
}

let dropVariant: DropVariant = readDropVariant()
const dropVariantListeners = new Set<(v: DropVariant) => void>()

export function getDropVariant(): DropVariant {
  return dropVariant
}

export function setDropVariant(v: DropVariant): void {
  dropVariant = v
  try {
    localStorage.setItem(DROP_VARIANT_KEY, v)
  } catch {
    // no-op
  }
  for (const l of dropVariantListeners) l(v)
}

export function subscribeDropVariant(
  listener: (v: DropVariant) => void,
): () => void {
  dropVariantListeners.add(listener)
  return () => {
    dropVariantListeners.delete(listener)
  }
}

function synthDropForVariant(v: DropVariant): void {
  switch (v) {
    case 'thump':
      return synthDropThump()
    case 'clack':
      return synthDropClack()
    case 'tick':
      return synthDropTick()
    case 'pebble':
      return synthDropPebble()
    case 'tap':
      return synthDropTap()
  }
}

export function playDropSfx(): void {
  if (isMuted()) return
  synthDropForVariant(dropVariant)
}

// Audition a variant without changing the persisted selection. Used by the
// settings popover so the user can compare options before committing. Note
// that this BYPASSES the mute check on purpose — if you're auditioning, you
// want to hear it. (We could honor mute, but then the picker would seem
// broken on mute; better to let the user audition silently-by-action by
// just not opening the picker.)
export function previewDropVariant(v: DropVariant): void {
  synthDropForVariant(v)
}
