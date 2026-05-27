export type Rect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export function rectFromBox(
  left: number,
  top: number,
  width: number,
  height: number,
): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return !(
    a.right + gap <= b.left ||
    a.left - gap >= b.right ||
    a.bottom + gap <= b.top ||
    a.top - gap >= b.bottom
  )
}

export function fitsViewport(
  rect: Rect,
  margin: number,
  vw = window.innerWidth,
  vh = window.innerHeight,
): boolean {
  return (
    rect.left >= margin &&
    rect.top >= margin &&
    rect.right <= vw - margin &&
    rect.bottom <= vh - margin
  )
}

/** Spell buttons, HUD chips, intent badges — never cover these with keyword sub-tooltips. */
export function getTriggerAvoidRects(parentTooltip: HTMLElement): Rect[] {
  const rects: Rect[] = []
  const selectors = ['.tooltip-anchor:not(.kw)', '.enemy-intent']
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      if (parentTooltip.contains(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) continue
      rects.push(rectFromBox(r.left, r.top, r.width, r.height))
    }
  }
  return rects
}

export function placeNestedTooltip(
  parent: Rect,
  tip: { width: number; height: number },
  avoid: Rect[],
  margin = 8,
  viewport?: { width: number; height: number },
  options?: { stackedBelowBeforeAbove?: boolean },
): { left: number; top: number } {
  const vw = viewport?.width ?? window.innerWidth
  const vh = viewport?.height ?? window.innerHeight
  const clampX = (x: number) =>
    Math.max(margin, Math.min(vw - tip.width - margin, x))
  const clampY = (y: number) =>
    Math.max(margin, Math.min(vh - tip.height - margin, y))
  const stackedLeft = clampX(parent.left + parent.width / 2 - tip.width / 2)
  const stackedAbove = {
    left: stackedLeft,
    top: parent.top - margin - tip.height,
  }
  const stackedBelow = {
    left: stackedLeft,
    top: parent.bottom + margin,
  }

  const candidates: { left: number; top: number }[] = [
    { left: parent.right + margin, top: clampY(parent.top) },
    { left: parent.left - margin - tip.width, top: clampY(parent.top) },
    ...(options?.stackedBelowBeforeAbove
      ? [stackedBelow, stackedAbove]
      : [stackedAbove, stackedBelow]),
  ]

  for (const { left, top } of candidates) {
    const rect = rectFromBox(left, top, tip.width, tip.height)
    if (!fitsViewport(rect, margin, vw, vh)) continue
    if (avoid.some((a) => rectsOverlap(rect, a, margin))) continue
    return { left, top }
  }

  const fallback = options?.stackedBelowBeforeAbove ? stackedAbove : stackedBelow
  return {
    left: fallback.left,
    top: clampY(fallback.top),
  }
}
