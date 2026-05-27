import { useLayoutEffect, useState, type RefObject } from 'react'

const PARENT_TOOLTIP_SELECTOR = '.hover-tooltip, .intent-tooltip'

/** Whether a nested keyword anchor's parent tooltip shell is still shown. */
export function readParentTooltipOpen(anchor: HTMLElement | null): boolean {
  const parent = anchor?.closest(PARENT_TOOLTIP_SELECTOR)
  if (!parent) return false
  return parent.classList.contains('is-visible')
}

/**
 * Nested keyword tooltips (autoShow) track the parent shell's `is-visible`
 * class so they dismiss as soon as the parent starts fading, not when the
 * parent unmounts after TOOLTIP_FADE_MS.
 */
export function useParentTooltipOpen(
  anchorRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): boolean {
  const [open, setOpen] = useState(() => !enabled)
  const [prevEnabled, setPrevEnabled] = useState(enabled)

  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled)
    if (!enabled) setOpen(true)
  }

  useLayoutEffect(() => {
    if (!enabled) return

    const sync = () => setOpen(readParentTooltipOpen(anchorRef.current))

    const parent = anchorRef.current?.closest(PARENT_TOOLTIP_SELECTOR)
    const raf = requestAnimationFrame(sync)
    if (!parent) return () => cancelAnimationFrame(raf)

    const observer = new MutationObserver(sync)
    observer.observe(parent, {
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [anchorRef, enabled])

  return open
}
