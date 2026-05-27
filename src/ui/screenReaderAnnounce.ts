type PoliteListener = (text: string) => void

const politeListeners = new Set<PoliteListener>()

export function subscribeScreenReaderPolite(listener: PoliteListener): () => void {
  politeListeners.add(listener)
  return () => politeListeners.delete(listener)
}

/** Queue a polite aria-live announcement (requires AriaLiveAnnouncer mounted). */
export function announceScreenReader(text: string): void {
  for (const listener of politeListeners) {
    listener(text)
  }
}
