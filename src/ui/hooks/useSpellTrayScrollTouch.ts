import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { SPELL_TRAY_SCROLL_GESTURE } from '../spellTrayScrollGesture'

const DRAG_THRESHOLD_PX = 12

/** Detect horizontal finger drags on the spell tray scroll strip. */
export function useSpellTrayScrollTouch(
  scrollRef: RefObject<HTMLDivElement | null>,
  onScrollGesture: () => void,
): { didDragRef: RefObject<boolean> } {
  const didDragRef = useRef(false)
  const onGestureRef = useRef(onScrollGesture)
  onGestureRef.current = onScrollGesture

  const fireGesture = useCallback(() => {
    onGestureRef.current()
    scrollRef.current?.dispatchEvent(
      new CustomEvent(SPELL_TRAY_SCROLL_GESTURE, { bubbles: true }),
    )
  }, [scrollRef])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    let startX = 0
    let startY = 0
    let gestureActive = false

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      didDragRef.current = false
      startX = t.clientX
      startY = t.clientY
      gestureActive = false
    }

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
      if (Math.abs(dx) < Math.abs(dy)) return
      if (!gestureActive) {
        gestureActive = true
        didDragRef.current = true
        fireGesture()
      }
    }

    const onTouchEnd = () => {
      gestureActive = false
      // Keep didDragRef through the synthetic click (same turn as touchend); cleared on next touchstart.
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true, capture: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true, capture: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart, true)
      el.removeEventListener('touchmove', onTouchMove, true)
      el.removeEventListener('touchend', onTouchEnd, true)
      el.removeEventListener('touchcancel', onTouchEnd, true)
    }
  }, [scrollRef, fireGesture])

  return { didDragRef }
}
