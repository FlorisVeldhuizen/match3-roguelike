import { subscribeGameEvents } from '../core/events/emitter'
import { scheduleAtTrailArrival } from '../timing'
import { statusKindFromDamageSource } from '../core/combat/statuses'

const MUTE_KEY = 'sfx-muted'

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === 'true'
  } catch {
    return false
  }
}

let muted = readMuted()
const mutedListeners = new Set<(value: boolean) => void>()

export function isMuted(): boolean {
  return muted
}

export function setMuted(value: boolean): void {
  muted = value
  try {
    localStorage.setItem(MUTE_KEY, String(value))
  } catch {
    // no-op: localStorage unavailable (private browsing)
  }
  for (const l of mutedListeners) l(value)
}

export function subscribeMuted(listener: (value: boolean) => void): () => void {
  mutedListeners.add(listener)
  return () => {
    mutedListeners.delete(listener)
  }
}

// --- Master volume ---
// 0..1 multiplier persisted in localStorage; applied via a single GainNode
// (built lazily with the AudioContext) all synths route through.

const VOLUME_KEY = 'sfx-volume'
const DEFAULT_VOLUME = 0.7

function readVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_KEY)
    if (raw == null) return DEFAULT_VOLUME
    const n = Number(raw)
    if (!Number.isFinite(n)) return DEFAULT_VOLUME
    return Math.min(1, Math.max(0, n))
  } catch {
    return DEFAULT_VOLUME
  }
}

let volume = readVolume()
let masterGainNode: GainNode | null = null
const volumeListeners = new Set<(v: number) => void>()

export function getVolume(): number {
  return volume
}

export function setVolume(value: number): void {
  const next = Math.min(1, Math.max(0, value))
  volume = next
  try {
    localStorage.setItem(VOLUME_KEY, String(next))
  } catch {
    // localStorage unavailable
  }
  if (masterGainNode) {
    // 30ms ramp so dragging the slider doesn't click.
    const c = masterGainNode.context
    masterGainNode.gain.cancelScheduledValues(c.currentTime)
    masterGainNode.gain.linearRampToValueAtTime(next, c.currentTime + 0.03)
  }
  for (const l of volumeListeners) l(next)
}

export function subscribeVolume(listener: (v: number) => void): () => void {
  volumeListeners.add(listener)
  return () => {
    volumeListeners.delete(listener)
  }
}

// --- WebAudio synthesis ---
//
// We don't ship wav assets for the "drop" thunk or "shuffle" whoosh. Both are
// short percussive cues that synthesize cleanly from a couple of oscillators
// plus an envelope, so we generate them on the fly instead of loading files.
// Lazy-init the AudioContext so we don't unlock audio before the user has
// interacted with the page (autoplay policy).

// Multiplicative jitter helper: returns a value in [1 - pct/2, 1 + pct/2].
// Use for pitch / gain / time scaling so a single number describes the spread.
// e.g. freq * jitter(0.06) gives ±3% pitch wobble.
function jitter(pct: number): number {
  return 1 + (Math.random() - 0.5) * pct
}

// Map an event amount (damage, heal, armor gained, cluster size...) into a
// multiplier that controls "perceived impact" — peak gain, sub-pitch weight,
// and decay. Log curve so a 6-armor gain feels weightier than 3, but a 30-
// damage hit doesn't blow the speakers vs a 3-damage hit. Capped at 1.7 so
// the scaling stays within "tasteful" range.
//
//   amount 1 → 1.00 (baseline)
//   amount 2 → 1.30
//   amount 3 → 1.48
//   amount 4 → 1.60
//   amount 6 → 1.70 (cap)
function intensity(amount: number): number {
  const a = Math.max(1, amount)
  return Math.min(1.7, 1 + 0.3 * Math.log2(a))
}

let ctx: AudioContext | null = null
// Browsers (esp. on fresh domains without a Media Engagement Index) require a
// user gesture before an AudioContext can leave the "suspended" state. The
// board-intro animation fires drop SFX before the player has interacted, so
// without this gate the context would be created suspended and every sound
// scheduled into it — including the intro drops — would be silently dropped.
// Defer context creation until the first gesture so it's born "running".
let userInteracted = false
function getCtx(): AudioContext | null {
  if (ctx) return ctx
  if (!userInteracted) return null
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctx) return null
    ctx = new Ctx()
    masterGainNode = ctx.createGain()
    masterGainNode.gain.value = volume
    masterGainNode.connect(ctx.destination)
    return ctx
  } catch {
    return null
  }
}

if (typeof window !== 'undefined') {
  const onFirstGesture = (): void => {
    userInteracted = true
    const c = getCtx()
    // If the browser still created it suspended (some Safari paths), resume.
    if (c && c.state === 'suspended') void c.resume()
    window.removeEventListener('pointerdown', onFirstGesture)
    window.removeEventListener('keydown', onFirstGesture)
    window.removeEventListener('touchstart', onFirstGesture)
  }
  window.addEventListener('pointerdown', onFirstGesture)
  window.addEventListener('keydown', onFirstGesture)
  window.addEventListener('touchstart', onFirstGesture)
}

// Final output for all synths — routes through the master gain so volume
// scales every voice. Fallback to destination is defensive; getCtx always
// builds the gain.
function out(c: AudioContext): AudioNode {
  return masterGainNode ?? c.destination
}

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

// Sweeping whoosh + low rumble for the "board reshuffled" cue. Longer than
// the drop, more atmospheric — signals "something big happened, look up."
function synthShuffle(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  // Per-call jitter — shuffle is a notable event, so when it fires twice in
  // close succession it really shouldn't sound identical.
  const dur = 0.55 * jitter(0.12)
  const peakFreq = 2200 * jitter(0.16) // sweep apex
  const startFreq = 600 * jitter(0.12)
  const endFreq = 500 * jitter(0.12)
  const apexTime = dur * (0.45 + (Math.random() - 0.5) * 0.1)
  const velocity = jitter(0.2)

  // Filtered noise sweep: bandpass slides upward then back, giving a
  // whooshy "cards shuffling" texture without sounding like a hiss. Pulls
  // from the shared noise pool — shuffle fires only on reshuffle events
  // (rare) but routing through the same pool keeps the allocation path
  // unified.
  const noise = makeNoiseBurst(c)

  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.4 * jitter(0.2)
  filter.frequency.setValueAtTime(startFreq, now)
  filter.frequency.exponentialRampToValueAtTime(peakFreq, now + apexTime)
  filter.frequency.exponentialRampToValueAtTime(endFreq, now + dur)

  const gain = c.createGain()
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.22 * velocity, now + 0.08)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)

  noise.connect(filter).connect(gain).connect(out(c))
  noise.start(now)
  noise.stop(now + dur + 0.02)
}

// Shared white-noise buffer pool. Each synth burst used to allocate its
// own buffer; routing through 4 pre-built 1s buffers (picked at random)
// gives variety without the per-call alloc. `dur` is kept as a callsite
// hint; the buffer outlasts any reasonable cue and callers stop the
// source at their own envelope tail.
const NOISE_POOL_SIZE = 4
const NOISE_POOL_DURATION_S = 1.0
let noisePool: AudioBuffer[] | null = null

function ensureNoisePool(c: AudioContext): void {
  if (noisePool) return
  const pool: AudioBuffer[] = []
  const len = Math.floor(NOISE_POOL_DURATION_S * c.sampleRate)
  for (let n = 0; n < NOISE_POOL_SIZE; n++) {
    const buf = c.createBuffer(1, len, c.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    pool.push(buf)
  }
  noisePool = pool
}

function makeNoiseBurst(c: AudioContext): AudioBufferSourceNode {
  ensureNoisePool(c)
  const pool = noisePool!
  const buf = pool[Math.floor(Math.random() * pool.length)] ?? pool[0]
  const src = c.createBufferSource()
  if (buf) src.buffer = buf
  return src
}

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

// Shared sine-with-envelope partial used by the chime/arpeggio/swell/sparkle/
// chord heal variants. Scheduled at absolute AudioContext time `t`.
function schedRingPartial(
  c: AudioContext,
  t: number,
  freq: number,
  peak: number,
  decay: number,
  attack: number,
): void {
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = freq
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
  osc.connect(g).connect(out(c))
  osc.start(t)
  osc.stop(t + decay + 0.02)
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

// --- Heal-variant selection (parallel to armor variant machinery). ---

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
  if (muted) return
  synthHealForVariant(healVariant, amount)
}

// Audition a heal variant — bypasses mute on purpose, matching previewDropVariant.
export function previewHealVariant(v: HealVariant): void {
  synthHealForVariant(v, 1)
}

// Cascade chime — fires on each chain link (level >= 1). Mellow music-box
// / soft-marimba character: harmonic sine partials (no inharmonic bell
// metalness), gentle attack, no contact click. The base note climbs a
// pentatonic scale per cascade level so a long chain audibly ascends
// rather than repeating.
function synthCascadeChime(level: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime

  // Pentatonic ascent in semitones above the base. Caps at the top step
  // so 8+ chains don't drift into harsh territory.
  const STEPS = [0, 2, 4, 7, 9, 12, 14, 16]
  const step = STEPS[Math.min(level - 1, STEPS.length - 1)] ?? 0
  // Base lowered from A5 (880Hz) to E5 (660Hz) so high cascade levels stay
  // out of the 2–3kHz "sensitive ear" band where things start to feel harsh.
  const baseFreq = 660 * Math.pow(2, step / 12)

  // Per-level loudness ramp: level 1 is often the *only* chime (the chain
  // ended right there), so it shouldn't announce itself like a long chain
  // is starting. Volume builds from ~45% at level 1 to full by level 4 —
  // the chain audibly grows as it extends, not just climbs in pitch.
  const loudness = Math.min(1, 0.45 + 0.18 * (level - 1))

  // Harmonic partials (ratio, peakGain, decayMs). Pure 1:2:4 is the music-
  // box / marimba structure — no inharmonicity means no metallic bell
  // edge. The 4× partial sits very quietly on top for a hint of sparkle
  // without harshness; remove it and it'd read as flute.
  const partials: [number, number, number][] = [
    [1.0, 0.075, 460],
    [2.0, 0.025, 260],
    [4.0, 0.008, 140],
  ]
  // Per-call attack jitter — small mallet-strike timing variation so back-to-
  // back chimes feel struck, not retriggered. Pitch stays locked to the scale.
  const attackTime = 0.018 * jitter(0.3)
  for (const [ratio, peak, decay] of partials) {
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = baseFreq * ratio
    // Per-partial timbre jitter: each partial gets its own ±15% gain and
    // ±12% decay. Independent per partial means the mix between fundamental
    // and overtones shifts each call — same instrument, different "strike".
    const peakJ = peak * jitter(0.3)
    const decayS = (decay / 1000) * jitter(0.24)
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, now)
    // ~18ms attack — soft mallet onset. Slow enough to lose any percussive
    // "click" edge, fast enough not to read as a blown/flute attack.
    g.gain.exponentialRampToValueAtTime(peakJ * loudness, now + attackTime)
    g.gain.exponentialRampToValueAtTime(0.0001, now + decayS)
    osc.connect(g).connect(out(c))
    osc.start(now)
    osc.stop(now + decayS + 0.02)
  }
}

export function playCascadeChimeSfx(level: number): void {
  if (muted) return
  synthCascadeChime(level)
}

// Celebration flourish after a good chain finishes. Plays a rising
// arpeggio in the same music-box voice as the per-step chime, so it reads
// as the chain "resolving" on a high note instead of a new instrument
// barging in. The arpeggio grows with chain depth: 3-chain = 3 notes,
// 6+ chain = 6 notes climbing two octaves, with the final note ringing
// out longer the longer the chain. Very long chains also get a quiet
// upper-octave sparkle layer.
function synthCascadeCelebration(levels: number): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime

  // Sit a couple of semitones above the last per-step chime so the
  // flourish lands on a "lifted" register rather than repeating the last
  // chime's pitch. Caps so very long chains don't drift above ~2 kHz.
  const headStep = Math.min(levels + 2, 12)
  const headFreq = 660 * Math.pow(2, headStep / 12)

  // Ascending arpeggio steps. Index in is read by `noteCount`, so a 3-chain
  // plays the first 3 notes (root → fifth → octave), 4-chain extends to
  // the 11th (oct + fourth), and so on up to two full octaves at 6+.
  // Ratios are exact semitone powers so each step lands cleanly on the
  // chord tone above the last.
  const ARPEGGIO_RATIOS = [
    1.0, // root
    Math.pow(2, 7 / 12), // perfect fifth
    2.0, // octave
    Math.pow(2, 17 / 12), // octave + perfect fourth (~2.378)
    Math.pow(2, 19 / 12), // octave + fifth (~2.997)
    4.0, // two octaves
  ]
  const noteCount = Math.min(ARPEGGIO_RATIOS.length, Math.max(3, levels))

  // Stagger expands slightly with longer chains so a 6-note flourish
  // doesn't feel rushed. 70ms at 3 notes, 95ms at 6.
  const stagger = 0.07 + 0.005 * (noteCount - 3)

  // Loudness scales with chain depth — a barely-qualifying 3-chain stays
  // modest; deeper chains land with more presence.
  const depthScale = Math.min(1, 0.55 + 0.12 * (levels - 3))

  for (let i = 0; i < noteCount; i++) {
    const pitchRatio = ARPEGGIO_RATIOS[i]
    if (pitchRatio === undefined) continue
    // Stagger micro-jitter: ±15ms wobble around the nominal slot so the
    // arpeggio feels played, not sequenced. Caps tight enough to preserve
    // the ascent's rhythm. First note is not jittered (locks the downbeat).
    const staggerJ = i === 0 ? 0 : (Math.random() - 0.5) * 0.03
    const startT = now + stagger * i + staggerJ
    const isLast = i === noteCount - 1
    // Final note rings out progressively longer the longer the chain.
    // Mid notes stay short so the arpeggio reads as a climb, not a chord.
    const decayMul = isLast ? 1.4 + 0.25 * (noteCount - 3) : 1.0
    const partials: [number, number, number][] = [
      [1.0, 0.075, 540 * decayMul],
      [2.0, 0.025, 300 * decayMul],
      [4.0, 0.008, 160 * decayMul],
    ]
    // Per-note attack jitter — small variation in mallet-strike timing.
    const attackTime = 0.018 * jitter(0.3)
    for (const [ratio, peak, decay] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = headFreq * pitchRatio * ratio
      // Per-partial timbre jitter — same shift-the-overtone-mix trick used
      // in the per-step chime, so consecutive flourishes don't sound copy-
      // pasted across runs.
      const peakJ = peak * jitter(0.25)
      const decayS = (decay / 1000) * jitter(0.2)
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, startT)
      g.gain.exponentialRampToValueAtTime(
        peakJ * depthScale,
        startT + attackTime,
      )
      g.gain.exponentialRampToValueAtTime(0.0001, startT + decayS)
      osc.connect(g).connect(out(c))
      osc.start(startT)
      osc.stop(startT + decayS + 0.02)
    }
  }

  // Sparkle layer on long chains (5+): a few high pinged sines scattered
  // through the arpeggio for a "fairy dust" shimmer. Quiet enough to sit
  // on top of the main flourish without overpowering it.
  if (levels >= 5) {
    const sparkleCount = Math.min(5, levels - 3)
    const arpeggioDur = stagger * (noteCount - 1) + 0.4
    for (let i = 0; i < sparkleCount; i++) {
      const t = now + 0.05 + Math.random() * arpeggioDur
      const freq = headFreq * (4 + Math.random() * 3)
      if (freq > 5200) continue // skip if it'd land above the harshness band
      const ping = c.createOscillator()
      ping.type = 'sine'
      ping.frequency.value = freq
      const pg = c.createGain()
      pg.gain.setValueAtTime(0.0001, t)
      pg.gain.exponentialRampToValueAtTime(0.022 * depthScale, t + 0.008)
      pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
      ping.connect(pg).connect(out(c))
      ping.start(t)
      ping.stop(t + 0.18)
    }
  }
}

export function playCascadeCelebrationSfx(levels: number): void {
  if (muted) return
  synthCascadeCelebration(levels)
}

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
// Brighter register than doorbell, faster (~12ms) attack so it reads as
// "alert" instead of "lullaby". The unmistakable triadic ascent gives
// clarity without volume. Picker UI removed; setTurnStartVariant() still
// reaches the alternatives if we want to re-audition.
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
      [1.0, 0.07, 380 * decayMul],
      [2.0, 0.025, 220 * decayMul],
      [4.0, 0.008, 110 * decayMul],
    ]
    const attackTime = 0.012 * jitter(0.25)
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
  if (muted) return
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
      [1.0, 0.09, 340],
      [2.0, 0.025, 200],
    ]
    const attackTime = 0.018 * jitter(0.2)
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
    dg.gain.exponentialRampToValueAtTime(0.015, t + 0.02)
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
  sg.gain.exponentialRampToValueAtTime(0.12 * jitter(0.18), now + 0.005)
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
  if (muted) return
  synthEnemyTurnForVariant(enemyTurnVariant)
}

export function previewEnemyTurnVariant(v: EnemyTurnVariant): void {
  synthEnemyTurnForVariant(v)
}

// Extra-turn chime — a 4-note ascending major arpeggio (root → 3rd → 5th →
// octave) in the same music-box voice, brighter and more confident than the
// turn-start doorbell because it's a reward. Sparkle layer on top for the
// "fairy dust" feel that signals "free turn!". Sits a fourth above the
// cascade chime base (G5 root) so it doesn't collide with the cascade band.
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
      [1.0, 0.08, 480 * decayMul],
      [2.0, 0.028, 280 * decayMul],
      [4.0, 0.01, 150 * decayMul],
    ]
    const attackTime = 0.016 * jitter(0.25)
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
    pg.gain.exponentialRampToValueAtTime(0.022, t + 0.008)
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    ping.connect(pg).connect(out(c))
    ping.start(t)
    ping.stop(t + 0.2)
  }
}

export function playExtraTurnSfx(): void {
  if (muted) return
  synthExtraTurn()
}

// 7-note C-major arpeggio climbing two octaves (~770ms) + sustained C3
// bass + sparkle shower. Final note rings ~2s so the cue lands rather
// than beeps.
function synthVictory(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  // C5 base, ascending triad doubled across two octaves on pure 5/4/3/2
  // ratios so the climb lands on chord tones.
  const baseFreq = 523.25
  const RATIOS = [1, 5 / 4, 3 / 2, 2, 5 / 2, 3, 4]
  const noteCount = RATIOS.length
  const stagger = 0.11
  for (let i = 0; i < noteCount; i++) {
    const ratio = RATIOS[i]
    if (ratio === undefined) continue
    // First note locks the downbeat; rest humanise with small jitter.
    const staggerJ = i === 0 ? 0 : (Math.random() - 0.5) * 0.025
    const t = now + stagger * i + staggerJ
    const isLast = i === noteCount - 1
    // Final note rings ~3.5× longer — turns the arpeggio into a chord
    // landing instead of a 7-note trill.
    const decayMul = isLast ? 3.6 : 1.0
    const partials: [number, number, number][] = [
      [1.0, 0.1, 600 * decayMul],
      [2.0, 0.04, 360 * decayMul],
      [4.0, 0.014, 180 * decayMul],
    ]
    const attackTime = 0.014 * jitter(0.2)
    for (const [pRatio, peak, decay] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = baseFreq * ratio * pRatio
      const peakJ = peak * jitter(0.15)
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
  // C3 bass thrum — center of gravity under the arpeggio.
  const arpEnd = now + stagger * (noteCount - 1)
  const bass = c.createOscillator()
  bass.type = 'sine'
  bass.frequency.value = 130.81
  const bg = c.createGain()
  bg.gain.setValueAtTime(0.0001, now)
  bg.gain.exponentialRampToValueAtTime(0.09, now + 0.1)
  bg.gain.setValueAtTime(0.09, arpEnd)
  bg.gain.exponentialRampToValueAtTime(0.0001, arpEnd + 1.5)
  bass.connect(bg).connect(out(c))
  bass.start(now)
  bass.stop(arpEnd + 1.6)
  // 8 high pings scattered through the arpeggio for shimmer.
  const arpDur = stagger * (noteCount - 1) + 1.0
  for (let i = 0; i < 8; i++) {
    const t = now + 0.08 + Math.random() * arpDur
    const freq = baseFreq * (4 + Math.random() * 3)
    if (freq > 5500) continue
    const ping = c.createOscillator()
    ping.type = 'sine'
    ping.frequency.value = freq
    const pg = c.createGain()
    pg.gain.setValueAtTime(0.0001, t)
    pg.gain.exponentialRampToValueAtTime(0.025, t + 0.008)
    pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2)
    ping.connect(pg).connect(out(c))
    ping.start(t)
    ping.stop(t + 0.22)
  }
}

export function playVictorySfx(): void {
  if (muted) return
  synthVictory()
}

// Staggered — the enemy's shield broke and they're dazed, skipping their
// turn. Three descending sine notes, each bending slightly downward, give
// a "stumble / off-balance" feel. Same music-box sine voice as turn-start
// and extra-turn so it reads as part of the same family, but the descent
// inverts the "triumphant" character — this is the *enemy* reeling, not
// the player being rewarded directly. Lands shortly after the shield-crack
// SFX (which fired on player attack) so it shouldn't double up on impact.
function synthStaggered(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  // Minor-flavored descent (roughly E5 → C#5 → A4). Pitch jitter per call
  // so chained stagger events on multi-enemy boards don't sample-loop.
  const detune = jitter(0.03)
  const FREQS = [660, 555, 440]
  const gap = 0.085 + (Math.random() - 0.5) * 0.012
  for (let i = 0; i < FREQS.length; i++) {
    const freq = FREQS[i]
    if (freq === undefined) continue
    const t = now + gap * i
    // Each note bends down ~6% over its decay — the "wobble" of a dazed
    // enemy. Subtle, but enough that the cue doesn't read as pure-tone.
    const decay = 0.22
    const partials: [number, number][] = [
      [1.0, 0.09],
      [2.0, 0.022],
    ]
    const attack = 0.02 * jitter(0.25)
    for (const [ratio, peak] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      const startF = freq * ratio * detune
      osc.frequency.setValueAtTime(startF, t)
      osc.frequency.exponentialRampToValueAtTime(startF * 0.94, t + decay)
      const g = c.createGain()
      const peakJ = peak * jitter(0.2)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(peakJ, t + attack)
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
      osc.connect(g).connect(out(c))
      osc.start(t)
      osc.stop(t + decay + 0.02)
    }
  }
}

export function playStaggeredSfx(): void {
  if (muted) return
  synthStaggered()
}

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
  if (muted) return
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
  if (muted) return
  synthMatchForVariant(matchVariant, clusterSize)
}

// Audition a match variant at a representative cluster size. Mirrors
// previewDropVariant — bypasses mute so the picker isn't silent on mute.
export function previewMatchVariant(v: MatchVariant): void {
  synthMatchForVariant(v, 3)
}

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
  if (muted) return
  synthAttack(amount)
}

// --- Drop sound variant selection ---
//
// `playDropSfx` fires very frequently (once per cascade settle). The picker
// UI was removed once the user locked in 'clack', but the state machinery
// (variants list, localStorage persistence, dispatch switch) stays so a
// future UI — or a programmatic setDropVariant() call — can swap flavors
// without re-deriving them. See the synthDrop* functions above for the
// per-variant character.

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
  if (muted) return
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

export function playShuffleSfx(): void {
  if (muted) return
  synthShuffle()
}

export function playShieldThumpSfx(amount = 1): void {
  if (muted) return
  synthShieldThump(amount)
}

export function playShieldCrackSfx(amount = 1): void {
  if (muted) return
  synthShieldCrack(amount)
}

// Armor cue (blue particle landing on the block badge) shares the shield-
// thump sound with the enemy's block-absorbed event. Intentional reuse —
// both are "armor doing its job".
export function playShieldParticleTickSfx(amount = 1): void {
  if (muted) return
  synthShieldThump(amount)
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
  if (muted) return
  synthBurnIgnite(count)
}

export function playBurnBurstSfx(): void {
  if (muted) return
  synthBurnBurst()
}

export function playBurnApplySfx(): void {
  if (muted) return
  synthBurnApply()
}

export function playBurnFizzleSfx(count = 1): void {
  if (muted) return
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
  if (muted) return
  synthBurnImpact(amount)
}

// Wire events → SFX. Idempotent — calling install() twice is safe.
let installed = false
export function installSfxBindings(): void {
  if (installed) return
  installed = true
  // `block-absorbed`/`block-broken` don't carry the blocked amount, but they
  // fire immediately after their paired damage event. For enemy attacks on
  // the player that's `damage-taken` (enemyTurn.ts); for player attacks on
  // an enemy that's `damage-dealt` with source='player-attack' (store.ts).
  // Stash each side separately so a player breaking an enemy shield doesn't
  // scale from stale values left over from the previous enemy turn.
  let lastPlayerBlocked = 1
  let lastPlayerUnblocked = 1
  let lastEnemyBlocked = 1
  let lastEnemyUnblocked = 1
  // Tracks when the enemy-turn cue last fired so we can suppress the
  // immediately-following player-turn cue when the enemy gets staggered
  // (or otherwise skips). performance.now() is monotonic; -Infinity means
  // "never fired", so the first player-turn cue is never suppressed.
  let lastEnemyTurnCueAt = -Infinity
  const FALL_MIN_MS = 150
  const FALL_PER_CELL_MS = 80
  const scheduleDrop = (maxDist: number) => {
    const fallMs = Math.max(FALL_MIN_MS, FALL_PER_CELL_MS * maxDist)
    window.setTimeout(playDropSfx, fallMs)
  }
  subscribeGameEvents((event) => {
    switch (event.kind) {
      case 'gems-cleared':
        if (event.cells.length > 0) playClackSfx(event.cells.length)
        return
      case 'gems-fell':
        // One thunk per event, not per gem — otherwise a fully-cleared row
        // plays a stack of overlapping thunks. Delay matches the longest
        // gem's fall duration so the thump lands when the gems visibly hit
        // the board, not when the event fires at the start of the animation.
        if (event.movements.length > 0) {
          let maxDist = 0
          for (const m of event.movements) {
            const d = Math.abs(m.to.y - m.from.y)
            if (d > maxDist) maxDist = d
          }
          scheduleDrop(maxDist)
        }
        return
      case 'board-intro-landed':
        // Level-start intro emits one of these per column, already scheduled
        // by the animator to fire at that column's visual touchdown. Just
        // play the thunk — no extra timing math.
        playDropSfx()
        return
      case 'gems-spawned':
        // Spawned gems fall in alongside gems-fell (AnimationController runs
        // animateFall and animateSpawn in parallel), so this thunk fires near
        // the fall thunk. Spawn fall distance is usually larger (gems enter
        // from above the board), so the spawn thunk still lands slightly
        // later. Spawn at y starts (y+1) cells above the board.
        if (event.spawns.length > 0) {
          let maxDist = 0
          for (const s of event.spawns) {
            const d = s.at.y + 1
            if (d > maxDist) maxDist = d
          }
          scheduleDrop(maxDist)
        }
        return
      case 'cascade-start':
        // Skip the first cascade-start (level 0) — the clear SFX already
        // sells the initial match. Only the chain triggers the cascade chime.
        // Pitch climbs per level so a long chain audibly ascends.
        if (event.level >= 1) playCascadeChimeSfx(event.level)
        return
      case 'cascade-complete':
        // Celebration flourish after a "good" chain. Threshold of 3 means
        // the player got at least two chained cascades on top of the
        // initial match — a clearly intentional combo, worth rewarding.
        // Delay slightly so it lands cleanly after the last per-step chime.
        if (event.levels >= 3) {
          const lv = event.levels
          window.setTimeout(() => playCascadeCelebrationSfx(lv), 220)
        }
        return
      case 'damage-dealt': {
        // Player-attack damage commits per-match during the cascade, but the
        // visual hit lands later when the red gem trail reaches the enemy.
        // Delay the SFX to match — the AnimationController applies the same
        // offset to the damage popup. Other damage sources don't have
        // travel time, so play immediately. Pass the amount so big hits
        // sound heavier than small ones.
        //
        // Also stash blocked/amount so the block-absorbed/block-broken event
        // that follows (for enemy targets) can scale itself correctly.
        const amt = event.amount
        // Status proc on an enemy (Burn etc.): per-status whoosh on
        // spawn + per-status impact at trail arrival. Keeps the cue
        // family coherent — burn damage sounds like burn, not a
        // generic attack.
        const procKind = statusKindFromDamageSource(event.source)
        if (procKind && amt > 0) {
          if (procKind === 'burn') {
            playBurnApplySfx()
            scheduleAtTrailArrival(() => playBurnImpactSfx(amt))
          }
          return
        }
        if (event.source === 'player-attack') {
          lastEnemyBlocked = event.blocked
          lastEnemyUnblocked = event.amount
          if (amt > 0) scheduleAtTrailArrival(() => playAttackSfx(amt))
        } else if (amt > 0) {
          playAttackSfx(amt)
        }
        return
      }
      case 'healed': {
        // Delay so the cue lands when the green trail visibly hits the HP
        // bar, not at gem-match time. Bigger heals → louder, fizzier.
        const amt = event.amount
        scheduleAtTrailArrival(() => playHealSfx(amt))
        return
      }
      case 'pool-gained': {
        // Blue particles land on the block badge — play a "tink" on arrival.
        // Scale with the amount: 6-armor lands chunkier than 1-armor.
        if (event.color === 'blue') {
          const amt = event.amount
          scheduleAtTrailArrival(() => playShieldParticleTickSfx(amt))
        }
        return
      }
      case 'damage-taken': {
        // Status proc on the player (Burn etc.): play the whoosh on
        // spawn, the burn impact at trail arrival.
        // AnimationController.spawnStatusProcTrail fires particles
        // chip → HP at the same beat.
        const procKind = statusKindFromDamageSource(event.source)
        if (procKind && event.amount > 0) {
          if (procKind === 'burn') {
            playBurnApplySfx()
            scheduleAtTrailArrival(() => playBurnImpactSfx(event.amount))
          }
          return
        }
        // Regular enemy-attack damage. Without this, unblocked hits on
        // the player would be silent — the shield SFX only fires when
        // block is in play. Stash both amounts so the upcoming
        // block-absorbed/broken event can scale itself.
        lastPlayerBlocked = event.blocked
        lastPlayerUnblocked = event.amount
        if (event.amount > 0) playAttackSfx(event.amount)
        return
      }
      case 'block-absorbed': {
        // Player target (enemy attacking): the shield-block visual fires
        // synchronously and the damage-taken SFX also plays immediately,
        // so play the thump now too — lands with the visual, ahead of any
        // leaked damage SFX. Enemy target (player attacking): the red gem
        // trail arrives at +TRAIL_ARRIVAL_MS, so delay both to land with
        // the attack rather than at gem-match time.
        if (event.targetId === 'player') {
          playShieldThumpSfx(lastPlayerBlocked)
        } else {
          const amt = lastEnemyBlocked
          scheduleAtTrailArrival(() => playShieldThumpSfx(amt))
        }
        return
      }
      case 'block-broken': {
        // Same target-split timing as block-absorbed. Scale by total
        // incoming damage so a shield breaking under a 6-damage hit cracks
        // harder than one breaking under a 1-damage finisher.
        if (event.targetId === 'player') {
          playShieldCrackSfx(lastPlayerBlocked + lastPlayerUnblocked)
        } else {
          const amt = lastEnemyBlocked + lastEnemyUnblocked
          scheduleAtTrailArrival(() => playShieldCrackSfx(amt))
        }
        return
      }
      case 'enemy-staggered':
        // Plays alongside the "Staggered" banner. Lands after the shield-
        // crack already cued the break — this is the follow-up "reeling"
        // beat, not the impact itself.
        playStaggeredSfx()
        return
      case 'enemy-block-gained':
        // Shield going up on the enemy. Reuses the impact thump for now —
        // a dedicated "raise" cue would read more accurately, but the thump
        // is close enough in palette to sell "shield" without a new synth.
        // Scale by the amount of block gained.
        playShieldThumpSfx(event.amount)
        return
      case 'board-shuffled':
        playShuffleSfx()
        return
      case 'tile-burn-placed': {
        // Smolder lights cells. Particles fly enemy → cells and the
        // flame appears at arrival, so the ignite cue lands then too.
        const ct = event.cells.length
        scheduleAtTrailArrival(() => playBurnIgniteSfx(ct))
        return
      }
      case 'tile-burn-triggered':
        // Each burning cell cleared in a match → one burst. Stagger by
        // a few ms so multi-cell clears don't sample-loop into a single
        // unsatisfying thwack.
        for (let i = 0; i < event.cells.length; i++) {
          window.setTimeout(playBurnBurstSfx, i * 35)
        }
        return
      case 'cell-flag-ticked':
        // Soft "fizzle out" cue when a burning tile's countdown reached
        // 0 unmatched. One cue per tick regardless of how many cells
        // expired (the visual already shows N puffs); a single hiss
        // scaled by count keeps the audio bed clean at end-of-turn.
        if (event.flag === 'burning' && event.expired.length > 0) {
          playBurnFizzleSfx(event.expired.length)
        }
        return
      case 'status-applied':
        // Burn arrival cue — short flame whoosh. Delayed via the same
        // trail-arrival schedule so the sound lands with the particle
        // hand-off and the status chip, not at swap commit.
        // (Vulnerable/Weak applications are silent for now; can get
        // their own timbres later.)
        if (event.status.kind === 'burn') {
          if (
            event.source?.kind === 'enemy' ||
            event.source?.kind === 'board-cells'
          ) {
            scheduleAtTrailArrival(playBurnApplySfx)
          } else {
            playBurnApplySfx()
          }
        }
        return
      case 'extra-turn-granted':
        // Plays alongside the "+1 TURN" callout. Brighter than turn-start
        // because it's a reward; sparkle layer reinforces "this was a treat".
        playExtraTurnSfx()
        return
      case 'phase-changed':
        if (event.phase === 'victory') playVictorySfx()
        else if (event.phase === 'enemy-acting') {
          playEnemyTurnSfx()
          lastEnemyTurnCueAt = performance.now()
        }
        // Begin-of-turn cue on every transition back to player-acting. The
        // very first turn of a fight is set up without emitting a phase-
        // changed event (initial state is constructed directly), so the cue
        // first fires from turn 2 onward — fine, since the player already
        // has visual context that the fight started.
        //
        // Suppress when the enemy cue just fired (stagger / instant-skip
        // turns): playing two opposite cues in <600ms is audibly awkward,
        // and the "Staggered" banner already tells the story. Player gets
        // their turn back silently in that case.
        else if (event.phase === 'player-acting') {
          const sinceEnemy = performance.now() - lastEnemyTurnCueAt
          if (sinceEnemy > 700) playTurnStartSfx()
        }
        return
      default:
        return
    }
  })
}
