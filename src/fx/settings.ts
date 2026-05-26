export type FXKey = 'rgbSplit' | 'shockwave' | 'crt'

const STORAGE_KEY = 'fx-settings'

export type FXSettings = Record<FXKey, boolean>

const DEFAULTS: FXSettings = {
  rgbSplit: true,
  shockwave: true,
  crt: true,
}

function readSettings(): FXSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<FXSettings>
    return {
      rgbSplit:
        typeof parsed.rgbSplit === 'boolean'
          ? parsed.rgbSplit
          : DEFAULTS.rgbSplit,
      shockwave:
        typeof parsed.shockwave === 'boolean'
          ? parsed.shockwave
          : DEFAULTS.shockwave,
      crt: typeof parsed.crt === 'boolean' ? parsed.crt : DEFAULTS.crt,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

let settings: FXSettings = readSettings()
const listeners = new Set<(s: FXSettings) => void>()

export function getFXSettings(): FXSettings {
  return settings
}

export function setFX(key: FXKey, value: boolean): void {
  if (settings[key] === value) return
  settings = { ...settings, [key]: value }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // no-op: localStorage unavailable (private browsing)
  }
  for (const l of listeners) l(settings)
}

export function subscribeFXSettings(
  listener: (s: FXSettings) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
