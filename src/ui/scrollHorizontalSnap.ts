const SNAP_EDGE_PX = 4

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth'
}

/** Scroll a horizontal snap container one snap target left or right. */
export function scrollHorizontalSnap(
  scrollEl: HTMLElement,
  direction: -1 | 1,
  opts?: { behavior?: ScrollBehavior },
): void {
  const behavior = opts?.behavior ?? scrollBehavior()
  const items = Array.from(
    scrollEl.querySelectorAll<HTMLElement>('.spell-tray > .tooltip-anchor'),
  )
  if (items.length === 0) return

  const { scrollLeft, clientWidth } = scrollEl
  const maxScroll = scrollEl.scrollWidth - clientWidth

  if (direction > 0) {
    const next = items.find((item) => item.offsetLeft > scrollLeft + SNAP_EDGE_PX)
    if (next) {
      next.scrollIntoView({ behavior, inline: 'start', block: 'nearest' })
      return
    }
    scrollEl.scrollTo({ left: maxScroll, behavior })
    return
  }

  let prev: HTMLElement | undefined
  for (const item of items) {
    if (item.offsetLeft < scrollLeft - SNAP_EDGE_PX) prev = item
    else break
  }
  if (prev) {
    prev.scrollIntoView({ behavior, inline: 'start', block: 'nearest' })
    return
  }
  scrollEl.scrollTo({ left: 0, behavior })
}
