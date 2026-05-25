// AudioContext + mute + volume + gesture unlock.
//
// Every synth in this folder routes through getCtx()/out(), and skips
// playback when isMuted() is true. The context is created lazily on the
// user's first gesture (autoplay-policy gate); see unlockAudio for the
// iOS-specific silent-buffer kick.

// --- Mute state ---

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
// Master compressor — sits between the master gain and destination. Gives
// us light "auto-mastering": tames peaks across loud cues so the mix
// doesn't slam, without squashing the dynamic range of quieter cues. The
// settings (-14 dB threshold, 3:1 ratio, fast attack, medium release) are
// tuned to catch the hottest layered cues (attack, victory, layered turn
// chimes) by 2-4 dB while leaving solo plays of drop/match/cascade chime
// essentially untouched.
let masterCompressorNode: DynamicsCompressorNode | null = null
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

// --- AudioContext (lazy, gesture-gated) ---

let ctx: AudioContext | null = null
// Browsers (esp. on fresh domains without a Media Engagement Index) require a
// user gesture before an AudioContext can leave the "suspended" state. The
// board-intro animation fires drop SFX before the player has interacted, so
// without this gate the context would be created suspended and every sound
// scheduled into it — including the intro drops — would be silently dropped.
// Defer context creation until the first gesture so it's born "running".
let userInteracted = false

export function getCtx(): AudioContext | null {
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
    masterCompressorNode = ctx.createDynamicsCompressor()
    masterCompressorNode.threshold.value = -14
    masterCompressorNode.knee.value = 8
    masterCompressorNode.ratio.value = 3
    masterCompressorNode.attack.value = 0.004
    masterCompressorNode.release.value = 0.12
    masterGainNode.connect(masterCompressorNode).connect(ctx.destination)
    return ctx
  } catch {
    return null
  }
}

// Final output for all synths — routes through the master gain so volume
// scales every voice. Fallback to destination is defensive; getCtx always
// builds the gain.
export function out(c: AudioContext): AudioNode {
  return masterGainNode ?? c.destination
}

// Explicit unlock entry point. iOS Safari (and iOS Chrome, which wraps it)
// needs the AudioContext to be created AND an actual sound to play inside
// the same user-gesture event handler — `resume()` alone has been observed
// to fall short on some iOS versions, leaving the context silently
// "running" but with no audible output. The fix is the classic silent-
// buffer kick: play a 1-sample zero-amplitude buffer inside the gesture.
// Once that lands, every subsequent sound works normally.
//
// MUST be called synchronously from a touch/pointer/click handler.
// The window-level fallback below covers every entry path — it fires
// on the player's first pointerdown/keydown/touchstart anywhere on
// the page and self-removes after it succeeds.
export function unlockAudio(): void {
  userInteracted = true
  const c = getCtx()
  if (!c) return
  // Silent-buffer kick: 1 sample, zero amplitude, plays and disposes
  // immediately. This is what unblocks iOS even when resume() doesn't.
  try {
    const buf = c.createBuffer(1, 1, 22050)
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(c.destination)
    src.start(0)
  } catch {
    // Defensive — never block real audio if the kick fails.
  }
  if (c.state === 'suspended') void c.resume()
}

if (typeof window !== 'undefined') {
  // First-gesture audio unlock. iOS Safari and iOS Chrome require both
  // resume() and a silent-buffer kick to be issued inside a synchronous
  // user-gesture handler — we listen at the window so the player's first
  // tap/click/key anywhere on the page unblocks audio. Self-removing
  // once unlockAudio fires.
  const onFirstGesture = (): void => {
    unlockAudio()
    window.removeEventListener('pointerdown', onFirstGesture)
    window.removeEventListener('keydown', onFirstGesture)
    window.removeEventListener('touchstart', onFirstGesture)
  }
  window.addEventListener('pointerdown', onFirstGesture)
  window.addEventListener('keydown', onFirstGesture)
  window.addEventListener('touchstart', onFirstGesture)
}
