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
    // localStorage unavailable (private browsing)
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
// Tames peaks across layered cues without squashing quiet ones.
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
// Defer creation until first gesture so the context is born "running" (autoplay policy).
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

export function out(c: AudioContext): AudioNode {
  return masterGainNode ?? c.destination
}

// iOS Safari needs a silent-buffer kick inside the first gesture handler;
// resume() alone can leave the context audibly dead on some iOS versions.
export function unlockAudio(): void {
  userInteracted = true
  const c = getCtx()
  if (!c) return
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
