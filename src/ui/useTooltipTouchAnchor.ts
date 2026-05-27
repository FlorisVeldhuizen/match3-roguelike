import { useEffect, type RefObject } from 'react'

/** Tap-to-open and tap-outside-to-close for portalled tooltips on touch devices. */
export function useTooltipTouchAnchor(
  open: boolean,
  setOpen: (open: boolean) => void,
  anchorRef: RefObject<HTMLElement | null>,
  tipRef: RefObject<HTMLElement | null>,
  options?: { dismissOnOutside?: boolean },
): void {
  const dismissOnOutside = options?.dismissOnOutside ?? true

  useEffect(() => {
    const el = anchorRef.current
    if (!el) return
    const onTouchStart = (e: TouchEvent) => {
      if (open) return
      e.preventDefault()
      setOpen(true)
    }
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    return () => el.removeEventListener('touchstart', onTouchStart)
  }, [anchorRef, open, setOpen])

  useEffect(() => {
    if (!open || !dismissOnOutside) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (anchorRef.current?.contains(target)) return
      if (tipRef.current?.contains(target)) return
      setOpen(false)
    }
    const onScrollOrResize = () => setOpen(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [open, dismissOnOutside, anchorRef, tipRef, setOpen])
}
