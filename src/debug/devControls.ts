import type { Pos } from '../types'

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
    // Storage may throw in private browsing / quota exceeded.
  }
}

const ALLOWED_SCALES = [1, 0.5, 0.25] as const
function parseScale(raw: string): number | null {
  const n = Number(raw)
  return ALLOWED_SCALES.includes(n as (typeof ALLOWED_SCALES)[number]) ? n : null
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

let stepModeOn = readStored(STORAGE_KEYS.stepMode, (raw) => raw === 'true') ?? false
let pendingStepResolve: (() => void) | null = null
const stepModeListeners = new Set<(on: boolean) => void>()

export function isStepMode(): boolean {
  return stepModeOn
}

export function setStepMode(on: boolean): void {
  if (on === stepModeOn) return
  stepModeOn = on
  writeStored(STORAGE_KEYS.stepMode, on ? 'true' : 'false')
  // Release pending gate so AC queue doesn't stall.
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

let unlockAllSpells = readStored(STORAGE_KEYS.unlockAllSpells, (raw) => raw === 'true') ?? false
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

export function subscribeUnlockAllSpells(cb: (on: boolean) => void): () => void {
  unlockAllSpellsListeners.add(cb)
  return () => unlockAllSpellsListeners.delete(cb)
}

type SwapRequest = { from: Pos; to: Pos }
const debugSwapListeners = new Set<(req: SwapRequest) => void>()

export function onDebugSwap(cb: (req: SwapRequest) => void): () => void {
  debugSwapListeners.add(cb)
  return () => debugSwapListeners.delete(cb)
}

export function emitDebugSwap(from: Pos, to: Pos): void {
  for (const cb of debugSwapListeners) cb({ from, to })
}
