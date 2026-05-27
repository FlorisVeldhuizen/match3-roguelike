import { useEffect, useState } from 'react'

/** Shared fade duration for hover / intent / map tooltips (see tooltip.css). */
export const TOOLTIP_FADE_MS = 160

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
}

export function useTooltipFade(open: boolean): {
  mounted: boolean
  visible: boolean
} {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      if (prefersReducedMotion()) {
        setVisible(true)
        return
      }
      let innerRaf = 0
      const outerRaf = requestAnimationFrame(() => {
        innerRaf = requestAnimationFrame(() => setVisible(true))
      })
      return () => {
        cancelAnimationFrame(outerRaf)
        cancelAnimationFrame(innerRaf)
      }
    }
    setVisible(false)
    const fadeMs = prefersReducedMotion() ? 0 : TOOLTIP_FADE_MS
    const id = window.setTimeout(() => setMounted(false), fadeMs)
    return () => window.clearTimeout(id)
  }, [open])

  return { mounted, visible }
}
