import { useEffect, useRef } from 'react'

/** Cover cast-close delay + fade so synthetic mouse cannot reopen the tooltip. */
const SUPPRESS_MS = 520

/** Mobile browsers emit synthetic mouse events right after touch — ignore them. */
export function useIgnoreMouseAfterTouch(): () => boolean {
  const lastTouchAt = useRef(0)

  useEffect(() => {
    const mark = () => {
      lastTouchAt.current = Date.now()
    }
    document.addEventListener('touchstart', mark, true)
    document.addEventListener('touchend', mark, true)
    return () => {
      document.removeEventListener('touchstart', mark, true)
      document.removeEventListener('touchend', mark, true)
    }
  }, [])

  return () => Date.now() - lastTouchAt.current < SUPPRESS_MS
}
