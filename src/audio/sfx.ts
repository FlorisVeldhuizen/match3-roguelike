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

export function playDropSfx(): void {
  if (muted) return
  synthDrop()
}

export function playShuffleSfx(): void {
  if (muted) return
  synthShuffle()
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
