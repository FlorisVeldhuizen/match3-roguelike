import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { scrollHorizontalSnap } from '../scrollHorizontalSnap'

const SCROLL_EDGE_PX = 2

export type HorizontalScrollHints = {
  ref: RefObject<HTMLDivElement | null>
  canScrollStart: boolean
  canScrollEnd: boolean
  hasOverflow: boolean
  scrollByDirection: (direction: -1 | 1, opts?: { behavior?: ScrollBehavior }) => void
}

/** Tracks horizontal overflow and scroll position for fade / rivet affordances. */
export function useHorizontalScrollHints(deps: readonly unknown[] = []): HorizontalScrollHints {
  const ref = useRef<HTMLDivElement | null>(null)
  const [hints, setHints] = useState({
    canScrollStart: false,
    canScrollEnd: false,
    hasOverflow: false,
  })

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    const hasOverflow = maxScroll > SCROLL_EDGE_PX
    const left = el.scrollLeft
    setHints({
      hasOverflow,
      canScrollStart: hasOverflow && left > SCROLL_EDGE_PX,
      canScrollEnd: hasOverflow && left < maxScroll - SCROLL_EDGE_PX,
    })
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [update, ...deps])

  useEffect(() => {
    const id = requestAnimationFrame(update)
    return () => cancelAnimationFrame(id)
  }, [update, ...deps])

  const scrollByDirection = useCallback((direction: -1 | 1, opts?: { behavior?: ScrollBehavior }) => {
    const el = ref.current
    if (!el) return
    scrollHorizontalSnap(el, direction, opts)
  }, [])

  return { ref, scrollByDirection, ...hints }
}
