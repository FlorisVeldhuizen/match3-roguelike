import { useCallback, useEffect, useLayoutEffect, useRef, type PointerEventHandler } from 'react'

const DEFAULT_HOLD_DELAY_MS = 400
const DEFAULT_REPEAT_MS = 320

type HoldRepeatHandlers = {
  onPointerDown: PointerEventHandler<HTMLButtonElement>
  onPointerUp: PointerEventHandler<HTMLButtonElement>
  onPointerCancel: PointerEventHandler<HTMLButtonElement>
  onLostPointerCapture: PointerEventHandler<HTMLButtonElement>
}

/** Tap once on release; hold past delay, then repeat `onRepeat` on an interval. */
export function useHoldRepeat(
  onTap: () => void,
  disabled: boolean,
  opts?: { onRepeat?: () => void; holdDelayMs?: number; repeatMs?: number },
): HoldRepeatHandlers {
  const tapRef = useRef(onTap)
  const repeatRef = useRef(opts?.onRepeat ?? onTap)
  useLayoutEffect(() => {
    tapRef.current = onTap
    repeatRef.current = opts?.onRepeat ?? onTap
  })

  const holdDelayMs = opts?.holdDelayMs ?? DEFAULT_HOLD_DELAY_MS
  const repeatMs = opts?.repeatMs ?? DEFAULT_REPEAT_MS

  const holdDelayIdRef = useRef<number | null>(null)
  const repeatIdRef = useRef<number | null>(null)
  const didRepeatRef = useRef(false)

  const clearTimers = useCallback(() => {
    if (holdDelayIdRef.current !== null) {
      window.clearTimeout(holdDelayIdRef.current)
      holdDelayIdRef.current = null
    }
    if (repeatIdRef.current !== null) {
      window.clearInterval(repeatIdRef.current)
      repeatIdRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    clearTimers()
    didRepeatRef.current = false
  }, [clearTimers])

  useEffect(() => () => stop(), [stop])

  const onPointerDown: PointerEventHandler<HTMLButtonElement> = useCallback(
    (e) => {
      if (disabled || e.button !== 0) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      stop()
      didRepeatRef.current = false

      holdDelayIdRef.current = window.setTimeout(() => {
        holdDelayIdRef.current = null
        didRepeatRef.current = true
        repeatRef.current()
        repeatIdRef.current = window.setInterval(() => repeatRef.current(), repeatMs)
      }, holdDelayMs)
    },
    [disabled, holdDelayMs, repeatMs, stop],
  )

  const finishPointer: PointerEventHandler<HTMLButtonElement> = useCallback(
    (e) => {
      if (disabled) return
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      const wasRepeat = didRepeatRef.current
      clearTimers()
      if (!wasRepeat) {
        tapRef.current()
      }
      didRepeatRef.current = false
    },
    [clearTimers, disabled],
  )

  return {
    onPointerDown,
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    onLostPointerCapture: stop,
  }
}
