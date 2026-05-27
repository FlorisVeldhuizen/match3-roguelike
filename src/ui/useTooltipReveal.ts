import { useEffect, useState } from 'react'

/**
 * Defer the visible class one frame after layout so opacity/transform
 * transitions run on mobile WebKit (same paint must not set pos + visible).
 */
export function useTooltipReveal(
  positioned: boolean,
  fadeVisible: boolean,
): boolean {
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!positioned || !fadeVisible) {
      setRevealed(false)
      return
    }
    const raf = requestAnimationFrame(() => setRevealed(true))
    return () => cancelAnimationFrame(raf)
  }, [positioned, fadeVisible])

  return revealed
}
