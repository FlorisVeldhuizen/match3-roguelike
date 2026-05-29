import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type PointerEventHandler,
  type RefObject,
} from 'react'

const DEFAULT_HOLD_DELAY_MS = 180
const DEFAULT_START_SPEED = 120
const DEFAULT_MAX_SPEED = 3000
const DEFAULT_RAMP_MS = 850

type Handlers = {
  onPointerDown: PointerEventHandler<HTMLButtonElement>
  onPointerUp: PointerEventHandler<HTMLButtonElement>
  onPointerCancel: PointerEventHandler<HTMLButtonElement>
  onLostPointerCapture: PointerEventHandler<HTMLButtonElement>
}

/**
 * Tap once on release; hold past `holdDelayMs` and a requestAnimationFrame loop
 * scrolls continuously, easing velocity from `startSpeed` up to `maxSpeed`
 * (px/s) over `rampMs`. Direction is fixed per-button.
 *
 * While the rAF loop runs, CSS scroll-snap is suspended on the target element —
 * snap containers otherwise pull programmatic `scrollLeft` updates back to the
 * nearest snap point each frame.
 */
export function useHoldSmoothScroll(
  scrollElRef: RefObject<HTMLElement | null>,
  direction: -1 | 1,
  onTap: () => void,
  disabled: boolean,
  opts?: {
    holdDelayMs?: number
    startSpeed?: number
    maxSpeed?: number
    rampMs?: number
    onHoldEnd?: () => void
  },
): Handlers {
  const tapRef = useRef(onTap)
  const onHoldEndRef = useRef(opts?.onHoldEnd)
  useLayoutEffect(() => {
    tapRef.current = onTap
    onHoldEndRef.current = opts?.onHoldEnd
  })

  const holdDelayMs = opts?.holdDelayMs ?? DEFAULT_HOLD_DELAY_MS
  const startSpeed = opts?.startSpeed ?? DEFAULT_START_SPEED
  const maxSpeed = opts?.maxSpeed ?? DEFAULT_MAX_SPEED
  const rampMs = opts?.rampMs ?? DEFAULT_RAMP_MS

  const holdTimeoutRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const didHoldRef = useRef(false)
  const scrollStylesSuspendedRef = useRef(false)
  const prevSnapTypeRef = useRef('')
  const prevScrollBehaviorRef = useRef('')

  const restoreScrollStyles = useCallback(() => {
    if (!scrollStylesSuspendedRef.current) return
    const el = scrollElRef.current
    if (el) {
      el.style.scrollSnapType = prevSnapTypeRef.current
      el.style.scrollBehavior = prevScrollBehaviorRef.current
    }
    scrollStylesSuspendedRef.current = false
  }, [scrollElRef])

  const stop = useCallback(() => {
    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current)
      holdTimeoutRef.current = null
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    restoreScrollStyles()
  }, [restoreScrollStyles])

  useEffect(() => () => stop(), [stop])

  useEffect(() => {
    if (disabled) stop()
  }, [disabled, stop])

  const onPointerDown: PointerEventHandler<HTMLButtonElement> = useCallback(
    (e) => {
      if (disabled || e.button !== 0) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      stop()
      didHoldRef.current = false

      holdTimeoutRef.current = window.setTimeout(() => {
        holdTimeoutRef.current = null
        didHoldRef.current = true
        const el = scrollElRef.current
        if (!el) return
        // Suspend snap (otherwise scrollLeft gets yanked to the nearest snap
        // point each frame) and smooth scroll-behavior (otherwise each frame's
        // assignment animates against the previous one — stuttery + slow).
        prevSnapTypeRef.current = el.style.scrollSnapType
        prevScrollBehaviorRef.current = el.style.scrollBehavior
        el.style.scrollSnapType = 'none'
        el.style.scrollBehavior = 'auto'
        scrollStylesSuspendedRef.current = true
        let t0 = 0
        let lastT = 0
        const tick = (now: number) => {
          if (t0 === 0) {
            // First callback: establish the timing baseline. rAF can fire
            // anywhere from <1ms to ~16ms after scheduling, so using that
            // as the first dt causes a visible stutter on start.
            t0 = now
            lastT = now
            rafRef.current = requestAnimationFrame(tick)
            return
          }
          const dt = Math.min(0.05, (now - lastT) / 1000)
          lastT = now
          const t = Math.min(1, (now - t0) / rampMs)
          // Smoothstep: derivative is 0 at both ends, so the velocity lifts
          // off gently from `startSpeed` and settles softly into `maxSpeed`
          // instead of jolting in (ease-out-cubic had a 3× kick at t=0).
          const eased = t * t * (3 - 2 * t)
          const speed = startSpeed + (maxSpeed - startSpeed) * eased
          el.scrollLeft += speed * dt * direction
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      }, holdDelayMs)
    },
    [disabled, holdDelayMs, startSpeed, maxSpeed, rampMs, direction, stop, scrollElRef],
  )

  const finishPointer: PointerEventHandler<HTMLButtonElement> = useCallback(
    (e) => {
      if (disabled) return
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      const wasHold = didHoldRef.current
      stop()
      if (wasHold) onHoldEndRef.current?.()
      else tapRef.current()
      didHoldRef.current = false
    },
    [disabled, stop],
  )

  return {
    onPointerDown,
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    onLostPointerCapture: stop,
  }
}
