import { useEffect, useState } from 'react'

/**
 * Defer the visible class one frame after layout so opacity/transform
 * transitions run on mobile WebKit (same paint must not set pos + visible).
 */
export function useTooltipReveal(
  positioned: boolean,
  fadeVisible: boolean,
): boolean {
  const active = positioned && fadeVisible
  const [revealed, setRevealed] = useState(false)
  const [prevActive, setPrevActive] = useState(active)

  if (active !== prevActive) {
    setPrevActive(active)
    if (!active) setRevealed(false)
  }

  useEffect(() => {
    if (!active) return
    const raf = requestAnimationFrame(() => setRevealed(true))
    return () => cancelAnimationFrame(raf)
  }, [active])

  return revealed
}
