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
export function HoverTooltip({
  children,
  title,
  body,
  variant,
  className,
  ariaLabel,
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
}) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!hovered) return
    const compute = () => {
      const a = anchorRef.current?.getBoundingClientRect()
      const t = tipRef.current?.getBoundingClientRect()
      if (!a || !t) return
      const margin = 8
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
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [hovered])

  return (
    <>
      <span
        ref={anchorRef}
        className={`tooltip-anchor${className ? ` ${className}` : ''}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onTouchStart={() => setHovered((v) => !v)}
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
