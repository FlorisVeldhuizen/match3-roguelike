import { Howl } from 'howler'
import { subscribeGameEvents } from '../core/events/emitter'

export type SfxName = 'clear' | 'cascade' | 'damage' | 'victory'

const sounds: Record<SfxName, Howl> = {
  clear: new Howl({ src: ['/sfx/clear.wav'], volume: 0.35, preload: true }),
  cascade: new Howl({ src: ['/sfx/cascade.wav'], volume: 0.5, preload: true }),
  damage: new Howl({ src: ['/sfx/damage.wav'], volume: 0.55, preload: true }),
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

// Shield clang: inharmonic metal-bar partials at bell-ish ratios (1, 2.76,
// 5.40, 8.93 × f0), each with its own decay. Higher partials fade fastest
// so you hear a sharp "ting" that mellows into a hum — the unmistakable
// fingerprint of metal being struck.
function synthShieldThump(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime
  const f0 = 460 + (Math.random() - 0.5) * 30
  // (ratio, peakGain, decayMs)
  const partials: [number, number, number][] = [
    [1.0, 0.22, 320],
    [2.76, 0.16, 220],
    [5.4, 0.1, 150],
    [8.93, 0.05, 90],
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

  // Short bandpassed noise click at attack — the "contact" before the ring.
  const noise = makeNoiseBurst(c, 0.025)
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1800
  bp.Q.value = 1.2
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.18, now)
  ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.04)
  noise.connect(bp).connect(ng).connect(c.destination)
  noise.start(now)
  noise.stop(now + 0.06)
}

// Shield shatter: a sharp opening crash plus 4 staggered, highpassed noise
// "fragments" descending in pitch, with a high sine tinkle on top. Each
// fragment is a separate burst so you hear discrete shards instead of a
// single noise sweep — that's the cue that says "broken glass" rather than
// "wind whoosh".
function synthShieldCrack(): void {
  const c = getCtx()
  if (!c) return
  const now = c.currentTime

  // Opening crash: bright wideband noise burst, very short.
  const crash = makeNoiseBurst(c, 0.09)
  const crashHp = c.createBiquadFilter()
  crashHp.type = 'highpass'
  crashHp.frequency.value = 2200
  const crashGain = c.createGain()
  crashGain.gain.setValueAtTime(0.0001, now)
  crashGain.gain.exponentialRampToValueAtTime(0.34, now + 0.003)
  crashGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)
  crash.connect(crashHp).connect(crashGain).connect(c.destination)
  crash.start(now)
  crash.stop(now + 0.1)

  // 4 fragment tinkles staggered after the crash. Each is a narrow bandpass
  // burst — short, pitched, scattering downward like falling shards.
  const fragments: [number, number][] = [
    [0.03, 5200],
    [0.07, 4100],
    [0.13, 3300],
    [0.21, 2400],
  ]
  for (const [delay, freq] of fragments) {
    const t = now + delay + Math.random() * 0.015
    const burst = makeNoiseBurst(c, 0.07)
    const bp = c.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = freq + (Math.random() - 0.5) * 200
    bp.Q.value = 6
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06)
    burst.connect(bp).connect(g).connect(c.destination)
    burst.start(t)
    burst.stop(t + 0.08)
  }

  // High sine tinkle: a brief upper-octave ping that sells the "shimmer"
  // of glass, layered just after the crash.
  const tinkle = c.createOscillator()
  tinkle.type = 'sine'
  tinkle.frequency.setValueAtTime(2600, now + 0.04)
  tinkle.frequency.exponentialRampToValueAtTime(1900, now + 0.28)
  const tg = c.createGain()
  tg.gain.setValueAtTime(0.0001, now + 0.04)
  tg.gain.exponentialRampToValueAtTime(0.09, now + 0.05)
  tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
  tinkle.connect(tg).connect(c.destination)
  tinkle.start(now + 0.04)
  tinkle.stop(now + 0.32)
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

// Wire events → SFX. Idempotent — calling install() twice is safe.
let installed = false
export function installSfxBindings(): void {
  if (installed) return
  installed = true
  subscribeGameEvents((event) => {
    switch (event.kind) {
      case 'gems-cleared':
        if (event.cells.length > 0) playSfx('clear')
        return
      case 'gems-fell':
        // Once per cascade step, not per gem — otherwise a fully-cleared
        // row plays a stack of overlapping thunks.
        if (event.movements.length > 0) playDropSfx()
        return
      case 'cascade-start':
        // Skip the first cascade-start (level 0) — the clear SFX already
        // sells the initial match. Only the chain triggers the cascade chime.
        if (event.level >= 1) playSfx('cascade')
        return
      case 'damage-dealt':
        playSfx('damage')
        return
      case 'damage-taken':
        // Mirror of damage-dealt for the player side. Without this, enemy
        // hits on an unblocked player are silent — only the new shield
        // SFX fired for block scenarios, making no-block hits feel mute.
        playSfx('damage')
        return
      case 'block-absorbed':
        playShieldThumpSfx()
        return
      case 'block-broken':
        playShieldCrackSfx()
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
