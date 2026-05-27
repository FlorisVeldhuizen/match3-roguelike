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
  const [holdMount, setHoldMount] = useState(false)
  const [visible, setVisible] = useState(
    () => open && prefersReducedMotion(),
  )
  const [prevOpen, setPrevOpen] = useState(open)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setHoldMount(false)
      setVisible(prefersReducedMotion())
    } else {
      setHoldMount(true)
      setVisible(false)
    }
  }

  const mounted = open || holdMount

  useEffect(() => {
    if (!open || prefersReducedMotion()) return
    let innerRaf = 0
    const outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => setVisible(true))
    })
    return () => {
      cancelAnimationFrame(outerRaf)
      cancelAnimationFrame(innerRaf)
    }
  }, [open])

  useEffect(() => {
    if (!holdMount) return
    const fadeMs = prefersReducedMotion() ? 0 : TOOLTIP_FADE_MS
    const id = window.setTimeout(() => setHoldMount(false), fadeMs)
    return () => window.clearTimeout(id)
  }, [holdMount])

  return { mounted, visible }
}
