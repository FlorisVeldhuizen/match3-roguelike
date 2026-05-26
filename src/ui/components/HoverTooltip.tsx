import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

export function HoverTooltip({
  children,
  title,
  body,
  variant,
  className,
  ariaLabel,
  autoShow,
}: {
  children: ReactNode
  title: string
  body: ReactNode
  variant?: string
  className?: string
  ariaLabel?: string
  autoShow?: boolean
}) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [anchorHovered, setAnchorHovered] = useState(false)
  const hovered = autoShow || anchorHovered
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!anchorHovered || autoShow) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (anchorRef.current?.contains(target)) return
      if (tipRef.current?.contains(target)) return
      setAnchorHovered(false)
    }
    const onScrollOrResize = () => setAnchorHovered(false)
    // capture so we run before any handler that calls stopPropagation
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [anchorHovered, autoShow])

  useLayoutEffect(() => {
    if (!hovered) return
    const compute = () => {
      const a = anchorRef.current?.getBoundingClientRect()
      const t = tipRef.current?.getBoundingClientRect()
      if (!a || !t) return
      const margin = 8

      // Nested: dock against parent tooltip edge to avoid overlap
      const container = anchorRef.current?.closest(
        '.hover-tooltip, .intent-tooltip',
      ) as HTMLElement | null
      if (container) {
        const c = container.getBoundingClientRect()
        const clampX = (x: number) =>
          Math.max(margin, Math.min(window.innerWidth - t.width - margin, x))
        const clampY = (y: number) =>
          Math.max(margin, Math.min(window.innerHeight - t.height - margin, y))

        if (c.right + margin + t.width + margin <= window.innerWidth) {
          setPos({ left: c.right + margin, top: clampY(c.top) })
          return
        }
        if (c.left - margin - t.width >= margin) {
          setPos({ left: c.left - margin - t.width, top: clampY(c.top) })
          return
        }
        const stackedLeft = clampX(c.left + c.width / 2 - t.width / 2)
        if (c.bottom + margin + t.height + margin <= window.innerHeight) {
          setPos({ left: stackedLeft, top: c.bottom + margin })
          return
        }
        if (c.top - margin - t.height >= margin) {
          setPos({ left: stackedLeft, top: c.top - margin - t.height })
          return
        }
        setPos({ left: stackedLeft, top: margin })
        return
      }

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
    // Re-measure next frame so nested tooltips anchor to real parent rect
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
        onTouchStart={(e) => {
          if (!anchorHovered) {
            e.preventDefault()
            setAnchorHovered(true)
          }
        }}
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
