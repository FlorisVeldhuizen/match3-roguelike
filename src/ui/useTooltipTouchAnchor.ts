import { useEffect, type RefObject } from 'react'
import { SPELL_TRAY_SCROLL_GESTURE } from './spellTrayScrollGesture'

/** Horizontal spell tray — allow swipe-to-scroll instead of blocking touchstart. */
const HORIZONTAL_SCROLL_SELECTOR = '.spell-tray-scroll'
const TAP_MOVE_THRESHOLD_PX = 12

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

    const scrollRoot = el.closest(HORIZONTAL_SCROLL_SELECTOR)
    if (!scrollRoot) {
      const onTouchStart = (e: TouchEvent) => {
        if (open) return
        e.preventDefault()
        setOpen(true)
      }
      el.addEventListener('touchstart', onTouchStart, { passive: false })
      return () => el.removeEventListener('touchstart', onTouchStart)
    }

    let startX = 0
    let startY = 0
    let scrollGesture = false

    const onTrayScrollGesture = () => {
      scrollGesture = true
      setOpen(false)
    }

    const onTouchStart = (e: TouchEvent) => {
      scrollGesture = false
      if (open) return
      const t = e.touches[0]
      if (!t) return
      startX = t.clientX
      startY = t.clientY
    }

    const onTouchMove = (e: TouchEvent) => {
      if (open) return
      const t = e.touches[0]
      if (!t) return
      const dx = Math.abs(t.clientX - startX)
      const dy = Math.abs(t.clientY - startY)
      if (dx > TAP_MOVE_THRESHOLD_PX && dx >= dy) {
        scrollGesture = true
      }
    }

    const onTouchEnd = () => {
      if (scrollGesture || open) return
      setOpen(true)
    }

    scrollRoot.addEventListener(SPELL_TRAY_SCROLL_GESTURE, onTrayScrollGesture)
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      scrollRoot.removeEventListener(SPELL_TRAY_SCROLL_GESTURE, onTrayScrollGesture)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
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
    const scrollRoot = anchorRef.current?.closest(HORIZONTAL_SCROLL_SELECTOR)

    const onScrollOrResize = () => setOpen(false)
    const onTrayScrollGesture = () => setOpen(false)

    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    scrollRoot?.addEventListener('scroll', onScrollOrResize, { passive: true })
    scrollRoot?.addEventListener(SPELL_TRAY_SCROLL_GESTURE, onTrayScrollGesture)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      scrollRoot?.removeEventListener('scroll', onScrollOrResize)
      scrollRoot?.removeEventListener(SPELL_TRAY_SCROLL_GESTURE, onTrayScrollGesture)
    }
  }, [open, dismissOnOutside, anchorRef, tipRef, setOpen])
}
