import { Howl } from 'howler'
import { subscribeGameEvents } from '../core/events/emitter'

export type SfxName = 'victory'

const sounds: Record<SfxName, Howl> = {
  victory: new Howl({ src: ['/sfx/victory.wav'], volume: 0.55, preload: true }),
}

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

export function playSfx(name: SfxName): void {
  if (muted) return
  sounds[name].play()
}

// --- WebAudio synthesis ---
//
// We don't ship wav assets for the "drop" thunk or "shuffle" whoosh. Both are
// short percussive cues that synthesize cleanly from a couple of oscillators
// plus an envelope, so we generate them on the fly instead of loading files.
// Lazy-init the AudioContext so we don't unlock audio before the user has
// interacted with the page (autoplay policy).

let ctx: AudioContext | null = null
function getCtx(): AudioContext | null {
  if (ctx) return ctx
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctx) return null
    ctx = new Ctx()
    return ctx
  } catch {
    return null
  }
}

// Short low-frequency thunk: ~80→55 Hz pitch slide with a fast exponential
// decay and a touch of click at the head. Reads as a gem dropping into a
// slot — felt more than heard. Pitch jitter on each call so repeated drops
// don't feel sample-loopy.
function synthDrop(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const dur = 0.18
  const baseFreq = 78 + (Math.random() - 0.5) * 10

  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(baseFreq * 1.7, now)
  osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, now + dur)

  const gain = c.createGain()
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.32, now + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)

  // Tiny noise transient at the head adds a "tick" of contact.
  const noiseBuf = c.createBuffer(1, 0.02 * c.sampleRate, c.sampleRate)
  const data = noiseBuf.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  }
  const noise = c.createBufferSource()
  noise.buffer = noiseBuf
  const noiseGain = c.createGain()
  noiseGain.gain.setValueAtTime(0.08, now)
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04)

  osc.connect(gain).connect(c.destination)
  noise.connect(noiseGain).connect(c.destination)
  osc.start(now)
  osc.stop(now + dur + 0.02)
  noise.start(now)
  noise.stop(now + 0.05)
}

// Sweeping whoosh + low rumble for the "board reshuffled" cue. Longer than
// the drop, more atmospheric — signals "something big happened, look up."
function synthShuffle(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const dur = 0.55

  // Filtered noise sweep: bandpass slides upward then back, giving a
  // whooshy "cards shuffling" texture without sounding like a hiss.
  const bufSize = Math.floor(dur * c.sampleRate)
  const noiseBuf = c.createBuffer(1, bufSize, c.sampleRate)
  const data = noiseBuf.getChannelData(0)
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1
  const noise = c.createBufferSource()
  noise.buffer = noiseBuf

  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.Q.value = 1.4
  filter.frequency.setValueAtTime(600, now)
  filter.frequency.exponentialRampToValueAtTime(2200, now + dur * 0.45)
  filter.frequency.exponentialRampToValueAtTime(500, now + dur)

  const gain = c.createGain()
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.08)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)

  noise.connect(filter).connect(gain).connect(c.destination)
  noise.start(now)
  noise.stop(now + dur + 0.02)
}

// Helper: short noise burst that decays from full to zero across `dur`.
// Used as the impact transient for shield-block and as fragment hits for
// shield-break. Returns the BufferSource so the caller can attach filters.
function makeNoiseBurst(c: AudioContext, dur: number): AudioBufferSourceNode {
  const len = Math.max(1, Math.floor(dur * c.sampleRate))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / len)
  }
  const src = c.createBufferSource()
  src.buffer = buf
  return src
}

// Heavy shield hit: low thud with a brief inharmonic body. Sub-thud anchors
// the weight, two low partials give it a metallic-but-dense character (a
// thick plate, not a bell), and a lowpassed noise impact provides the
// "smack" of contact. Short decays — heavy shields don't ring out, they
// absorb the blow and dampen fast.
function synthShieldThump(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime

  // Sub-thud: the body weight of the strike.
  const sub = c.createOscillator()
  sub.type = 'sine'
  sub.frequency.setValueAtTime(90, now)
  sub.frequency.exponentialRampToValueAtTime(55, now + 0.12)
  const subGain = c.createGain()
  subGain.gain.setValueAtTime(0.0001, now)
  subGain.gain.exponentialRampToValueAtTime(0.4, now + 0.004)
  subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
  sub.connect(subGain).connect(c.destination)
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
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(peak, now + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay / 1000)
    osc.connect(g).connect(c.destination)
    osc.start(now)
    osc.stop(now + decay / 1000 + 0.02)
  }

  // Impact smack: lowpassed noise burst — the "contact" of weapon on plate.
  // Lowpass keeps it dull/heavy instead of bright/tinny.
  const noise = makeNoiseBurst(c, 0.05)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 700
  lp.Q.value = 1
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.32, now + 0.003)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
  noise.connect(lp).connect(ng).connect(c.destination)
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
function synthShieldCrack(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime

  // Sub-thud: anchor, not centerpiece. Peak cut from 0.5 → 0.32 and decay
  // shortened so the cue doesn't lead with a heavy bass drop — that
  // dominated the previous version and gave it the "thumpy" character.
  const thud = c.createOscillator()
  thud.type = 'sine'
  thud.frequency.setValueAtTime(150, now)
  thud.frequency.exponentialRampToValueAtTime(55, now + 0.14)
  const thudGain = c.createGain()
  thudGain.gain.setValueAtTime(0.0001, now)
  thudGain.gain.exponentialRampToValueAtTime(0.32, now + 0.005)
  thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
  thud.connect(thudGain).connect(c.destination)
  thud.start(now)
  thud.stop(now + 0.18)

  // Structural snap: filtered noise standing in for the previous sawtooth
  // sweep. A bandpass at ~1.4 kHz with Q=1 widens the previous resonance
  // into a soft band, and a lowpass cutoff sweep from 4 kHz down to 1 kHz
  // (slightly brighter than before) gives the "settling crrk" with a touch
  // more shatter character.
  const snapDur = 0.12
  const snap = makeNoiseBurst(c, snapDur)
  const snapBp = c.createBiquadFilter()
  snapBp.type = 'bandpass'
  snapBp.frequency.value = 1600
  snapBp.Q.value = 1
  const snapLp = c.createBiquadFilter()
  snapLp.type = 'lowpass'
  snapLp.frequency.setValueAtTime(4000, now)
  snapLp.frequency.exponentialRampToValueAtTime(1000, now + snapDur)
  snapLp.Q.value = 0.6
  const snapGain = c.createGain()
  snapGain.gain.setValueAtTime(0.0001, now)
  snapGain.gain.exponentialRampToValueAtTime(0.34, now + 0.004)
  snapGain.gain.exponentialRampToValueAtTime(0.0001, now + snapDur)
  snap
    .connect(snapBp)
    .connect(snapLp)
    .connect(snapGain)
    .connect(c.destination)
  snap.start(now)
  snap.stop(now + snapDur + 0.02)

  // Fracture crunch: lowpassed noise burst — the wideband "crack" of the
  // material giving way. Brighter start (3 kHz → 800 Hz sweep) so the
  // initial crack has shatter bite, not just dull thud.
  const crunch = makeNoiseBurst(c, 0.14)
  const crunchLp = c.createBiquadFilter()
  crunchLp.type = 'lowpass'
  crunchLp.frequency.setValueAtTime(3000, now)
  crunchLp.frequency.exponentialRampToValueAtTime(800, now + 0.14)
  crunchLp.Q.value = 1
  const crunchGain = c.createGain()
  crunchGain.gain.setValueAtTime(0.0001, now)
  crunchGain.gain.exponentialRampToValueAtTime(0.36, now + 0.004)
  crunchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
  crunch.connect(crunchLp).connect(crunchGain).connect(c.destination)
  crunch.start(now)
  crunch.stop(now + 0.18)

  // Metal ring: three sine partials at inharmonic ratios (1820, 2470,
  // 3540 Hz — neither octave-stacked nor harmonic), each brief and quiet,
  // start times staggered by ~12ms so they enter as a sequence rather
  // than a single chord. The stagger is what prevents the squeak — a
  // single sustained sine in this band registers as a pure tone, but
  // three brief overlapping ones merge into "metallic shimmer".
  const ringPartials: [number, number, number][] = [
    // freq, startOffset(s), decay(s)
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
    osc.connect(g).connect(c.destination)
    osc.start(t)
    osc.stop(t + decay + 0.02)
  }

  // Debris: 3 short bandpassed noise bursts, slightly brighter range than
  // before (400–1700 Hz vs the previous 250–1150). Brighter bursts read as
  // metallic chunks rather than wood/stone tumbling.
  for (let i = 0; i < 3; i++) {
    const t = now + 0.06 + Math.random() * 0.2
    const burst = makeNoiseBurst(c, 0.08)
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 400 + Math.random() * 1300
    bp.Q.value = 1.2
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
    burst.connect(bp).connect(g).connect(c.destination)
    burst.start(t)
    burst.stop(t + 0.1)
  }
}

// Health-potion bleep. Two-note arcade pickup (root → perfect fifth) on a
// square wave for the classic 8-bit pickup character, with a bandpassed
// noise sprinkle threaded behind it so the cue reads as "fizzy" / "rustly"
// rather than a clean tone. Tiny pitch jitter per call so chained heals
// don't sound like a tape loop.
function synthHeal(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const jitter = 1 + (Math.random() - 0.5) * 0.03

  // Two-note bleep: 80ms on the root, then 110ms on the fifth above.
  // Square gives the arcade timbre; a hair of lowpass keeps it from biting.
  const notes: [number, number, number][] = [
    [660 * jitter, 0, 0.08], // root, t-offset, duration
    [990 * jitter, 0.07, 0.11], // perfect fifth, slight overlap
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
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(lp).connect(g).connect(c.destination)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  }

  // Fizz: short bandpassed noise burst riding under the bleep — the
  // "rustle" of potion bubbling/sparkling. Bandpass keeps it from hissing.
  const fizzDur = 0.22
  const noise = makeNoiseBurst(c, fizzDur)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(2400, now)
  bp.frequency.exponentialRampToValueAtTime(3600, now + fizzDur)
  bp.Q.value = 2.5
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.06, now + 0.01)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + fizzDur)
  noise.connect(bp).connect(ng).connect(c.destination)
  noise.start(now)
  noise.stop(now + fizzDur + 0.02)
}

export function playHealSfx(): void {
  if (muted) return
  synthHeal()
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
  for (const [ratio, peak, decay] of partials) {
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = baseFreq * ratio
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, now)
    // ~18ms attack — soft mallet onset. Slow enough to lose any percussive
    // "click" edge, fast enough not to read as a blown/flute attack.
    g.gain.exponentialRampToValueAtTime(peak * loudness, now + 0.018)
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay / 1000)
    osc.connect(g).connect(c.destination)
    osc.start(now)
    osc.stop(now + decay / 1000 + 0.02)
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
    const startT = now + stagger * i
    const isLast = i === noteCount - 1
    // Final note rings out progressively longer the longer the chain.
    // Mid notes stay short so the arpeggio reads as a climb, not a chord.
    const decayMul = isLast ? 1.4 + 0.25 * (noteCount - 3) : 1.0
    const partials: [number, number, number][] = [
      [1.0, 0.075, 540 * decayMul],
      [2.0, 0.025, 300 * decayMul],
      [4.0, 0.008, 160 * decayMul],
    ]
    for (const [ratio, peak, decay] of partials) {
      const osc = c.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = headFreq * pitchRatio * ratio
      const g = c.createGain()
      g.gain.setValueAtTime(0.0001, startT)
      g.gain.exponentialRampToValueAtTime(peak * depthScale, startT + 0.018)
      g.gain.exponentialRampToValueAtTime(0.0001, startT + decay / 1000)
      osc.connect(g).connect(c.destination)
      osc.start(startT)
      osc.stop(startT + decay / 1000 + 0.02)
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
      ping.connect(pg).connect(c.destination)
      ping.start(t)
      ping.stop(t + 0.18)
    }
  }
}

export function playCascadeCelebrationSfx(levels: number): void {
  if (muted) return
  synthCascadeCelebration(levels)
}

// Subtle wooden clack for gem clears. Pitched bandpassed noise burst in the
// mid-range gives the "tac" of contact, layered with a short low sine for
// body weight. Pitch jitter per call so chained clears don't sound like a
// sample loop. Kept quiet — this fires on every cascade step and shouldn't
// fight the chime or damage cues.
function synthClack(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const jitter = 1 + (Math.random() - 0.5) * 0.2

  // Wooden "tac": bandpassed noise around 1.8 kHz. Q=3 keeps it tonal-ish
  // (woody) rather than bright/hissy. ~55ms total so it doesn't smear into
  // the next event in a fast cascade.
  const tacDur = 0.055
  const tac = makeNoiseBurst(c, tacDur)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1800 * jitter
  bp.Q.value = 3
  const tg = c.createGain()
  tg.gain.setValueAtTime(0.0001, now)
  tg.gain.exponentialRampToValueAtTime(0.18, now + 0.002)
  tg.gain.exponentialRampToValueAtTime(0.0001, now + tacDur)
  tac.connect(bp).connect(tg).connect(c.destination)
  tac.start(now)
  tac.stop(now + tacDur + 0.02)

  // Body thump: short sine at ~280 Hz with fast decay — gives the clack a
  // bit of weight so it doesn't sound thin/papery. Inaudible on its own but
  // matters when stacked.
  const body = c.createOscillator()
  body.type = 'sine'
  body.frequency.setValueAtTime(280 * jitter, now)
  body.frequency.exponentialRampToValueAtTime(200 * jitter, now + 0.05)
  const bg = c.createGain()
  bg.gain.setValueAtTime(0.0001, now)
  bg.gain.exponentialRampToValueAtTime(0.1, now + 0.003)
  bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
  body.connect(bg).connect(c.destination)
  body.start(now)
  body.stop(now + 0.08)
}

export function playClackSfx(): void {
  if (muted) return
  synthClack()
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
function synthAttack(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const jitter = 1 + (Math.random() - 0.5) * 0.08

  // Low tail: anchor, not punch. Cut hard from its earlier strength — too
  // much sustain in this band reads as "kick drum" rather than "weapon
  // hit". Higher start freq, modest peak, short decay.
  const kick = c.createOscillator()
  kick.type = 'sine'
  kick.frequency.setValueAtTime(170 * jitter, now)
  kick.frequency.exponentialRampToValueAtTime(60, now + 0.06)
  const kickGain = c.createGain()
  kickGain.gain.setValueAtTime(0.0001, now)
  kickGain.gain.exponentialRampToValueAtTime(0.22, now + 0.003)
  kickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08)
  kick.connect(kickGain).connect(c.destination)
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
  const swoosh = makeNoiseBurst(c, swooshDur)
  const swooshHp = c.createBiquadFilter()
  swooshHp.type = 'highpass'
  swooshHp.frequency.value = 800
  swooshHp.Q.value = 0.5
  const swooshLp = c.createBiquadFilter()
  swooshLp.type = 'lowpass'
  swooshLp.frequency.setValueAtTime(6000 * jitter, now)
  swooshLp.frequency.exponentialRampToValueAtTime(1400, now + swooshDur)
  swooshLp.Q.value = 0.5
  const swooshGain = c.createGain()
  swooshGain.gain.setValueAtTime(0.0001, now)
  swooshGain.gain.exponentialRampToValueAtTime(0.22, now + 0.008)
  swooshGain.gain.exponentialRampToValueAtTime(0.0001, now + swooshDur)
  swoosh
    .connect(swooshHp)
    .connect(swooshLp)
    .connect(swooshGain)
    .connect(c.destination)
  swoosh.start(now)
  swoosh.stop(now + swooshDur + 0.02)

  // Crack: short bandpassed noise at ~2.4 kHz with a 1ms attack — the
  // defined contact transient. Pulled down from earlier "shink" territory
  // into the upper-mid band so it sits closer to the snap/ring and reads
  // as part of the impact body rather than a separate high layer.
  const shink = makeNoiseBurst(c, 0.018)
  const shinkBp = c.createBiquadFilter()
  shinkBp.type = 'bandpass'
  shinkBp.frequency.value = 2400 * jitter
  shinkBp.Q.value = 1.6
  const shinkGain = c.createGain()
  shinkGain.gain.setValueAtTime(0.0001, now)
  shinkGain.gain.exponentialRampToValueAtTime(0.2, now + 0.001)
  shinkGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018)
  shink.connect(shinkBp).connect(shinkGain).connect(c.destination)
  shink.start(now)
  shink.stop(now + 0.025)

  // Bright snap: the cutting bite at the moment of contact. Bandpass at
  // 3 kHz with Q=2 keeps it tonal-cracky rather than hissy. Pushed a touch
  // hotter than before so it bridges the shink into the mid crunch.
  const snap = makeNoiseBurst(c, 0.04)
  const snapBp = c.createBiquadFilter()
  snapBp.type = 'bandpass'
  snapBp.frequency.value = 3000 * jitter
  snapBp.Q.value = 2
  const snapGain = c.createGain()
  snapGain.gain.setValueAtTime(0.0001, now)
  snapGain.gain.exponentialRampToValueAtTime(0.28, now + 0.002)
  snapGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045)
  snap.connect(snapBp).connect(snapGain).connect(c.destination)
  snap.start(now)
  snap.stop(now + 0.06)

  // Mid crunch: the meat. Bandpass at ~1.1 kHz, slightly downward sweep so
  // the impact "settles" rather than holding steady.
  const crunch = makeNoiseBurst(c, 0.09)
  const crunchBp = c.createBiquadFilter()
  crunchBp.type = 'bandpass'
  crunchBp.frequency.setValueAtTime(1200 * jitter, now)
  crunchBp.frequency.exponentialRampToValueAtTime(700, now + 0.09)
  crunchBp.Q.value = 1.4
  const crunchGain = c.createGain()
  crunchGain.gain.setValueAtTime(0.0001, now)
  crunchGain.gain.exponentialRampToValueAtTime(0.28, now + 0.003)
  crunchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1)
  crunch.connect(crunchBp).connect(crunchGain).connect(c.destination)
  crunch.start(now)
  crunch.stop(now + 0.12)
}

export function playAttackSfx(): void {
  if (muted) return
  synthAttack()
}

export function playDropSfx(): void {
  if (muted) return
  synthDrop()
}

export function playShuffleSfx(): void {
  if (muted) return
  synthShuffle()
}

export function playShieldThumpSfx(): void {
  if (muted) return
  synthShieldThump()
}

export function playShieldCrackSfx(): void {
  if (muted) return
  synthShieldCrack()
}

// Thump of a blue particle landing on the block badge. Same family as
// synthShieldThump (low sine pop + lowpassed noise impact) but shorter and
// brighter so it sits at the same perceived loudness as the other per-match
// cues (clack, heal, attack). Previously all content sat below 600 Hz —
// sub-bass alone doesn't cut through small speakers, which made the cue
// feel weak relative to its siblings. Lifting the lowpass to 1.2 kHz gives
// the contact a bit of presence without losing the "small thud against a
// big shield" character.
function synthShieldParticleTick(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime

  // Low sine pop: the body weight of the contact. Pitch jitter per call
  // keeps chained particle hits from sounding identical.
  const baseFreq = 110 + (Math.random() - 0.5) * 16
  const thud = c.createOscillator()
  thud.type = 'sine'
  thud.frequency.setValueAtTime(baseFreq, now)
  thud.frequency.exponentialRampToValueAtTime(baseFreq * 0.62, now + 0.09)
  const thudGain = c.createGain()
  thudGain.gain.setValueAtTime(0.0001, now)
  thudGain.gain.exponentialRampToValueAtTime(0.34, now + 0.004)
  thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11)
  thud.connect(thudGain).connect(c.destination)
  thud.start(now)
  thud.stop(now + 0.13)

  // Lowpassed noise impact: the "smack" of contact. Lowpass raised from
  // 600 → 1200 Hz so a bit of low-mid bite comes through — the previous
  // setting was almost entirely sub-bass and got lost behind other cues.
  const noise = makeNoiseBurst(c, 0.05)
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 1200
  lp.Q.value = 1
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.0001, now)
  ng.gain.exponentialRampToValueAtTime(0.24, now + 0.003)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
  noise.connect(lp).connect(ng).connect(c.destination)
  noise.start(now)
  noise.stop(now + 0.07)
}

export function playShieldParticleTickSfx(): void {
  if (muted) return
  synthShieldParticleTick()
}

// Delay between a pool-gained/healed event firing in the engine and the
// trail particles visibly landing on their target (HP bar / block badge /
// enemy). Mirrors TRAIL_TRAVEL_MS in HUD.tsx and TRAIL_ARRIVAL_MS in the
// AnimationController. Keep in sync if any of them changes.
const TRAIL_ARRIVAL_MS = 700

// Wire events → SFX. Idempotent — calling install() twice is safe.
let installed = false
export function installSfxBindings(): void {
  if (installed) return
  installed = true
  subscribeGameEvents((event) => {
    switch (event.kind) {
      case 'gems-cleared':
        if (event.cells.length > 0) playClackSfx()
        return
      case 'gems-fell':
        // Once per cascade step, not per gem — otherwise a fully-cleared
        // row plays a stack of overlapping thunks. Delay matches the longest
        // gem's fall duration (mirror of AnimationController's
        // `max(DROP_MIN_MS, DROP_PER_CELL_MS * distance)`) so the thump
        // lands when the gems visibly hit the board, not when the event
        // fires at the start of the animation.
        if (event.movements.length > 0) {
          let maxDist = 0
          for (const m of event.movements) {
            const d = Math.abs(m.to.y - m.from.y)
            if (d > maxDist) maxDist = d
          }
          const FALL_MIN_MS = 150
          const FALL_PER_CELL_MS = 80
          const fallMs = Math.max(FALL_MIN_MS, FALL_PER_CELL_MS * maxDist)
          window.setTimeout(playDropSfx, fallMs)
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
      case 'damage-dealt':
        // Player-attack damage commits per-match during the cascade, but the
        // visual hit lands later when the red gem trail reaches the enemy.
        // Delay the SFX to match — the AnimationController applies the same
        // offset to the damage popup. Other damage sources (currently none,
        // but future enemy reflect damage etc.) don't have travel time, so
        // play immediately.
        if (event.source === 'player-attack') {
          window.setTimeout(playAttackSfx, TRAIL_ARRIVAL_MS)
        } else {
          playAttackSfx()
        }
        return
      case 'healed':
        // Delay so the cue lands when the green trail visibly hits the HP
        // bar, not at gem-match time.
        window.setTimeout(playHealSfx, TRAIL_ARRIVAL_MS)
        return
      case 'pool-gained':
        // Blue particles land on the block badge — play a light "tink" on
        // arrival. Other colors get their own arrival cues elsewhere (or
        // are covered by healed/damage-dealt events).
        if (event.color === 'blue') {
          window.setTimeout(playShieldParticleTickSfx, TRAIL_ARRIVAL_MS)
        }
        return
      case 'damage-taken':
        // Mirror of damage-dealt for the player side. Without this, enemy
        // hits on an unblocked player are silent — only the new shield
        // SFX fired for block scenarios, making no-block hits feel mute.
        playAttackSfx()
        return
      case 'block-absorbed':
        // The shield-block visual (spawnShieldEffect in AnimationController)
        // fires synchronously with the event, NOT delayed to trail-arrival.
        // SFX matches that — play immediately so it lands with the visual,
        // ahead of the +700ms attack SFX. This naturally gives the sequence
        // "shield reacts → blow follows through".
        playShieldThumpSfx()
        return
      case 'block-broken':
        playShieldCrackSfx()
        return
      case 'enemy-block-gained':
        // Shield going up on the enemy. Reuses the impact thump for now —
        // a dedicated "raise" cue would read more accurately, but the thump
        // is close enough in palette to sell "shield" without a new synth.
        playShieldThumpSfx()
        return
      case 'board-shuffled':
        playShuffleSfx()
        return
      case 'phase-changed':
        if (event.phase === 'victory') playSfx('victory')
        return
      default:
        return
    }
  })
}
