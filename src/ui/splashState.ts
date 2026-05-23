// Splash-screen "started" flag. Lives outside the game store on purpose: it's
// session-UI state (was the splash dismissed yet?), not game state. Stays
// `true` for the lifetime of the page — restart-after-death doesn't re-show
// the splash. Pattern mirrors the muted/volume module state in audio/sfx.ts.

let started = false
const listeners = new Set<(value: boolean) => void>()

export function isStarted(): boolean {
  return started
}

export function markStarted(): void {
  if (started) return
  started = true
  for (const l of listeners) l(true)
}

export function subscribeStarted(listener: (value: boolean) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
