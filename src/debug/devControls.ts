import type { Pos } from '../types'

// Dev-only controls: time scale, step-by-step gate, and a debug-swap bus
// the DevTools panel uses to trigger swaps from outside the BoardScene.
// All state is module-level since these are global app-wide toggles, not
// per-component. Production callers should treat this module as inert —
// time scale defaults to 1, step mode defaults to off.
//
// Settings persist across page refreshes via localStorage. Read on
// module load, written on each setter. Guarded against storage failures
// (private mode, quota, disabled) so the dev tooling never throws.

const STORAGE_KEYS = {
  timeScale: 'dev-tools:time-scale',
  stepMode: 'dev-tools:step-mode',
  unlockAllSpells: 'dev-tools:unlock-all-spells',
} as const

function readStored<T>(key: string, parse: (raw: string) => T | null): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw == null) return null
    return parse(raw)
  } catch {
    return null
  }
}
function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Storage may throw on quota / privacy mode — dev tooling stays in-
    // memory in that case, just won't survive a refresh.
  }
}

// ─── Time scale ──────────────────────────────────────────────────────
//
// Multiplier for animation speed. 1 = normal, 0.5 = half speed, etc.
// AnimationController.wait() divides setTimeout durations by this value
// (so smaller scale = longer waits), and BoardScene applies it to
// Ticker.shared.speed + its app.ticker.speed (so Pixi tweens slow too).

// Allowed scale values — kept narrow so a corrupted storage value can't
// jam the game with a silly 0.001× scale. Defaults to 1 (normal speed).
const ALLOWED_SCALES = [1, 0.5, 0.25] as const
function parseScale(raw: string): number | null {
  const n = Number(raw)
  return ALLOWED_SCALES.includes(n as (typeof ALLOWED_SCALES)[number])
    ? n
    : null
}
let timeScale = readStored(STORAGE_KEYS.timeScale, parseScale) ?? 1
const timeScaleListeners = new Set<(value: number) => void>()

export function getTimeScale(): number {
  return timeScale
}

export function setTimeScale(value: number): void {
  if (value <= 0) return
  if (value === timeScale) return
  timeScale = value
  writeStored(STORAGE_KEYS.timeScale, String(value))
  for (const cb of timeScaleListeners) cb(value)
}

export function subscribeTimeScale(cb: (value: number) => void): () => void {
  timeScaleListeners.add(cb)
  return () => timeScaleListeners.delete(cb)
}

// ─── Step mode ───────────────────────────────────────────────────────
//
// When on, AnimationController.play() pauses between events and waits
// for advanceStep() — DevTools' "Step" button. When off, the gate is a
// no-op and events flow normally.

let stepModeOn =
  readStored(STORAGE_KEYS.stepMode, (raw) => raw === 'true') ?? false
let pendingStepResolve: (() => void) | null = null
const stepModeListeners = new Set<(on: boolean) => void>()

export function isStepMode(): boolean {
  return stepModeOn
}

export function setStepMode(on: boolean): void {
  if (on === stepModeOn) return
  stepModeOn = on
  writeStored(STORAGE_KEYS.stepMode, on ? 'true' : 'false')
  // If turning off while a gate is pending, release it so the AC queue
  // doesn't stall after the user disables step mode.
  if (!on && pendingStepResolve) {
    const resolve = pendingStepResolve
    pendingStepResolve = null
    resolve()
  }
  for (const cb of stepModeListeners) cb(on)
}

export function subscribeStepMode(cb: (on: boolean) => void): () => void {
  stepModeListeners.add(cb)
  return () => stepModeListeners.delete(cb)
}

// Called by AC.play() between events. Resolves immediately when step
// mode is off; otherwise returns a Promise that resolves on the next
// advanceStep() call.
export function awaitStep(): Promise<void> {
  if (!stepModeOn) return Promise.resolve()
  return new Promise<void>((resolve) => {
    pendingStepResolve = resolve
  })
}

export function advanceStep(): void {
  if (!pendingStepResolve) return
  const resolve = pendingStepResolve
  pendingStepResolve = null
  resolve()
}

// ─── Unlock all spells ───────────────────────────────────────────────
//
// When off (default), the spell tray shows only the class-baseline
// starter kit (`SpellDef.starter === true`). The rest are treated as
// "discoverable" until the reward/shop system can grant them. When on,
// the filter is bypassed so all registered spells appear — useful for
// regression testing and one-off experimentation. Persisted so the
// choice survives a refresh.

let unlockAllSpells =
  readStored(STORAGE_KEYS.unlockAllSpells, (raw) => raw === 'true') ?? false
const unlockAllSpellsListeners = new Set<(on: boolean) => void>()

export function isUnlockAllSpells(): boolean {
  return unlockAllSpells
}

export function setUnlockAllSpells(on: boolean): void {
  if (on === unlockAllSpells) return
  unlockAllSpells = on
  writeStored(STORAGE_KEYS.unlockAllSpells, on ? 'true' : 'false')
  for (const cb of unlockAllSpellsListeners) cb(on)
}

export function subscribeUnlockAllSpells(
  cb: (on: boolean) => void,
): () => void {
  unlockAllSpellsListeners.add(cb)
  return () => unlockAllSpellsListeners.delete(cb)
}

// ─── Debug swap bus ──────────────────────────────────────────────────
//
// DevTools dispatches a "swap this from→to" request; BoardScene listens
// and runs its performSwap path with full AC animation. Kept separate
// from the main game-events bus so the GameEvent union stays free of
// debug-only kinds.

type SwapRequest = { from: Pos; to: Pos }
const debugSwapListeners = new Set<(req: SwapRequest) => void>()

export function onDebugSwap(
  cb: (req: SwapRequest) => void,
): () => void {
  debugSwapListeners.add(cb)
  return () => debugSwapListeners.delete(cb)
}

export function emitDebugSwap(from: Pos, to: Pos): void {
  for (const cb of debugSwapListeners) cb({ from, to })
}
