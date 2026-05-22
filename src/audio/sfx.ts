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
      case 'cascade-start':
        // Skip the first cascade-start (level 0) — the clear SFX already
        // sells the initial match. Only the chain triggers the cascade chime.
        if (event.level >= 1) playSfx('cascade')
        return
      case 'damage-dealt':
        playSfx('damage')
        return
      case 'phase-changed':
        if (event.phase === 'victory') playSfx('victory')
        return
      default:
        return
    }
  })
}
