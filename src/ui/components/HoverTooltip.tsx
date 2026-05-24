import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

// Portal-rendered tooltip that auto-flips above/below the anchor and
// clamps to the viewport. Same look + behavior as the intent badge's
// tooltip in EnemyFrame.tsx; extracted so spell buttons (which may be
// disabled but still want hover help) and future controls can share it.
//
// Visibility: closes immediately on mouseleave/blur. The cursor is NOT
// expected to move into the tooltip itself — any "additional info that
// would have lived inside" goes into inline <Keyword> components which
// auto-show their definitions next to the parent (see autoShow below).
export function HoverTooltip({
  children,
  title,
  body,
  variant,
  className,
  ariaLabel,
  autoShow,
}: {
  // Anchor content (icon + label + cost, etc.). Wrapped in a span so
  // hover/focus events fire reliably even on aria-disabled controls
  // where the underlying <button> may not receive pointer events.
  children: ReactNode
  title: string
  body: ReactNode
  // Optional palette key — added as `tooltip-${variant}` for CSS.
  variant?: string
  className?: string
  ariaLabel?: string
  // When true, the tooltip is always visible whenever the anchor is
  // mounted — no hover required. Used by inline <Keyword> so the
  // sub-tooltip appears automatically as part of its parent tooltip.
  // Unmounts naturally when the anchor unmounts (parent tooltip closes
  // → keyword span removed → this sub-tooltip removed).
  autoShow?: boolean
}) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [anchorHovered, setAnchorHovered] = useState(false)
  const hovered = autoShow || anchorHovered
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!hovered) return
    const compute = () => {
      const a = anchorRef.current?.getBoundingClientRect()
      const t = tipRef.current?.getBoundingClientRect()
      if (!a || !t) return
      const margin = 8

      // Nested-tooltip placement: if this anchor sits inside another
      // tooltip (.hover-tooltip or .intent-tooltip), we dock against
      // that container's edge rather than the inline anchor. The
      // sub-tooltip is conceptually a panel attached to the parent.
      // Priority: dock right → dock left → stack below → stack above.
      // We NEVER fall through to anchor-relative placement here —
      // the inline anchor is inside the parent, so anchor-relative
      // would overlap the parent. On a narrow viewport (mobile)
      // stack-below ensures the two tooltips remain readable as
      // separate panels with no overlap.
      const container = anchorRef.current?.closest(
        '.hover-tooltip, .intent-tooltip',
      ) as HTMLElement | null
      if (container) {
        const c = container.getBoundingClientRect()
        const clampX = (x: number) =>
          Math.max(margin, Math.min(window.innerWidth - t.width - margin, x))
        const clampY = (y: number) =>
          Math.max(margin, Math.min(window.innerHeight - t.height - margin, y))

        // 1. Right of container
        if (c.right + margin + t.width + margin <= window.innerWidth) {
          setPos({ left: c.right + margin, top: clampY(c.top) })
          return
        }
        // 2. Left of container
        if (c.left - margin - t.width >= margin) {
          setPos({ left: c.left - margin - t.width, top: clampY(c.top) })
          return
        }
        // 3. Stack below the parent (centered horizontally over it).
        //    Used on narrow screens where neither horizontal side fits.
        const stackedLeft = clampX(c.left + c.width / 2 - t.width / 2)
        if (c.bottom + margin + t.height + margin <= window.innerHeight) {
          setPos({ left: stackedLeft, top: c.bottom + margin })
          return
        }
        // 4. Stack above the parent (centered horizontally).
        if (c.top - margin - t.height >= margin) {
          setPos({ left: stackedLeft, top: c.top - margin - t.height })
          return
        }
        // 5. Last resort: top of viewport, centered over the parent.
        //    Should only happen on viewports too short for either
        //    above/below placement — extremely rare.
        setPos({ left: stackedLeft, top: margin })
        return
      }

      // Default placement: above the anchor, flipping below if there's
      // no room above.
      const wantsBelow = a.top - margin - t.height < margin
      const top = wantsBelow ? a.bottom + margin : a.top - margin - t.height
      let left = a.left + a.width / 2 - t.width / 2
      left = Math.max(
        margin,
        Math.min(window.innerWidth - t.width - margin, left),
      )
      setPos({ left, top })
    }
    compute()
    // Nested tooltips: when this tooltip docks against a parent
    // tooltip, the child's useLayoutEffect fires before the parent's
    // (bottom-up). On the very first appearance the parent's pos is
    // still null → it lives at (0,0), so the child anchors to the
    // wrong rect. Re-measure on the next frame, by which point the
    // parent has set its own pos and the DOM reflects the real rect.
    const rafId = requestAnimationFrame(compute)
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [hovered])

  return (
    <>
      <span
        ref={anchorRef}
        className={`tooltip-anchor${className ? ` ${className}` : ''}`}
        onMouseEnter={() => setAnchorHovered(true)}
        onMouseLeave={() => setAnchorHovered(false)}
        onFocus={() => setAnchorHovered(true)}
        onBlur={() => setAnchorHovered(false)}
        onTouchStart={() => setAnchorHovered((v) => !v)}
        aria-label={ariaLabel}
      >
        {children}
      </span>
      {hovered &&
        createPortal(
          <div
            ref={tipRef}
            className={`hover-tooltip${variant ? ` tooltip-${variant}` : ''}`}
            role="tooltip"
            style={{
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              opacity: pos ? 1 : 0,
            }}
          >
            <div className="hover-tooltip-title">{title}</div>
            <div className="hover-tooltip-body">{body}</div>
          </div>,
          document.body,
        )}
    </>
  )
}
