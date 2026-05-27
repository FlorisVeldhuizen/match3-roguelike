const SNAP_EDGE_PX = 4

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth'
}

function scrollPaddingInlineStart(scrollEl: HTMLElement): number {
  const style = getComputedStyle(scrollEl)
  const left = parseFloat(style.scrollPaddingLeft)
  if (!Number.isNaN(left) && left > 0) return left
  const inline = parseFloat(style.scrollPaddingInline)
  if (!Number.isNaN(inline) && inline > 0) return inline
  return 0
}

/** Left edge of the snap column inside the scrollport (after scroll-padding). */
function snapLeadingEdge(scrollEl: HTMLElement): number {
  return scrollEl.getBoundingClientRect().left + scrollPaddingInlineStart(scrollEl) + SNAP_EDGE_PX
}

function findNextSnapItem(items: HTMLElement[], scrollEl: HTMLElement): HTMLElement | undefined {
  const lead = snapLeadingEdge(scrollEl)
  return items.find((item) => item.getBoundingClientRect().left > lead)
}

function findPrevSnapItem(items: HTMLElement[], scrollEl: HTMLElement): HTMLElement | undefined {
  const lead = snapLeadingEdge(scrollEl)
  let prev: HTMLElement | undefined
  for (const item of items) {
    if (item.getBoundingClientRect().right <= lead) {
      prev = item
    } else {
      break
    }
  }
  return prev
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

  const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth

  if (direction > 0) {
    const next = findNextSnapItem(items, scrollEl)
    if (next) {
      next.scrollIntoView({ behavior, inline: 'start', block: 'nearest' })
      return
    }
    scrollEl.scrollTo({ left: maxScroll, behavior })
    return
  }

  const prev = findPrevSnapItem(items, scrollEl)
  if (prev) {
    prev.scrollIntoView({ behavior, inline: 'start', block: 'nearest' })
    return
  }
  scrollEl.scrollTo({ left: 0, behavior })
}
