import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useTooltipFade } from '../useTooltipFade'
import { useTooltipReveal } from '../useTooltipReveal'
import { useTooltipTouchAnchor } from '../useTooltipTouchAnchor'
import { getTriggerAvoidRects, placeNestedTooltip, rectFromBox } from '../tooltipPosition'
import { useCoarsePointer } from '../useCoarsePointer'
import { useHoverCapable } from '../useHoverCapable'
import { useIgnoreMouseAfterTouch } from '../useIgnoreMouseAfterTouch'
import { useParentTooltipOpen } from '../useParentTooltipOpen'
import { announceScreenReader } from '../screenReaderAnnounce'

/** Nested keyword tooltips inside an open parent (Hearthstone-like). */
export const KEYWORD_SUBTOOLTIP_DELAY_MS = 400
/** Brief pause after casting before the spell tooltip fades out. */
export const CAST_TOOLTIP_CLOSE_DELAY_MS = 280

export function HoverTooltip({
  children,
  title,
  body,
  variant,
  className,
  ariaLabel,
  autoShow,
  autoShowDelayMs = 0,
  queued,
  closeTick = 0,
  touchActionHint,
  touchOpenAnnounce,
}: {
  children: ReactNode
  title: string
  body: ReactNode
  variant?: string
  className?: string
  ariaLabel?: string
  autoShow?: boolean
  /** When set with `autoShow`, wait before showing (keywords inside a parent tooltip). */
  autoShowDelayMs?: number
  /** When this flips false→true, dismiss an open tooltip (spell was just cast / armed). */
  queued?: boolean
  /** Increment to force-dismiss (e.g. spell cast onClick, before synthetic mouse events). */
  closeTick?: number
  /** Shown in the tooltip footer on touch while pinned open (e.g. "Tap again to cast"). */
  touchActionHint?: string
  /** Polite aria-live line when the tooltip opens from touch on a coarse pointer. */
  touchOpenAnnounce?: string
}) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [anchorHovered, setAnchorHovered] = useState(false)
  const [autoShown, setAutoShown] = useState(() => Boolean(autoShow) && autoShowDelayMs <= 0)
  const [prevAuto, setPrevAuto] = useState({ autoShow, autoShowDelayMs })

  const wasQueuedRef = useRef(queued ?? false)
  const wasTouchOpenRef = useRef(false)
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Tooltip open at touchstart — survives React flushing state before the synthetic click. */
  const anchorOpenRef = useRef(false)
  const touchWasOpenRef = useRef(false)
  const pendingTouchClickRef = useRef(false)
  const coarsePointer = useCoarsePointer()
  const hoverCapable = useHoverCapable()
  const ignoreMouseAfterTouch = useIgnoreMouseAfterTouch()

  const dismiss = () => {
    setAnchorHovered(false)
    setAutoShown(false)
  }

  const scheduleDismiss = useCallback(() => {
    if (dismissTimeoutRef.current) {
      window.clearTimeout(dismissTimeoutRef.current)
    }
    const delay =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
        ? 0
        : CAST_TOOLTIP_CLOSE_DELAY_MS
    dismissTimeoutRef.current = window.setTimeout(() => {
      dismissTimeoutRef.current = null
      dismiss()
    }, delay)
  }, [])

  const canOpenFromMouse = () => hoverCapable && !ignoreMouseAfterTouch()

  useEffect(() => {
    return () => {
      if (dismissTimeoutRef.current) {
        window.clearTimeout(dismissTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!closeTick) return
    scheduleDismiss()
  }, [closeTick, scheduleDismiss])

  useEffect(() => {
    if (queued === undefined) return
    if (!wasQueuedRef.current && queued) {
      scheduleDismiss()
    }
    wasQueuedRef.current = queued
  }, [queued, scheduleDismiss])

  if (autoShow !== prevAuto.autoShow || autoShowDelayMs !== prevAuto.autoShowDelayMs) {
    setPrevAuto({ autoShow, autoShowDelayMs })
    if (!autoShow) {
      setAutoShown(false)
    } else if (autoShowDelayMs <= 0) {
      setAutoShown(true)
    } else {
      setAutoShown(false)
    }
  }

  useEffect(() => {
    if (!autoShow || autoShowDelayMs <= 0) return
    const id = window.setTimeout(() => setAutoShown(true), autoShowDelayMs)
    return () => window.clearTimeout(id)
  }, [autoShow, autoShowDelayMs])

  const parentOpen = useParentTooltipOpen(anchorRef, Boolean(autoShow))
  const hovered = autoShow ? parentOpen && (autoShown || anchorHovered) : anchorHovered
  const touchPinnedOpen = coarsePointer && anchorHovered && !autoShow
  const showTouchActionHint = touchPinnedOpen && Boolean(touchActionHint)
  const { mounted: tipMounted, visible: tipVisible } = useTooltipFade(hovered)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const displayPos = tipMounted ? pos : null
  const tipRevealed = useTooltipReveal(displayPos !== null, tipVisible)

  anchorOpenRef.current = anchorHovered

  useTooltipTouchAnchor(anchorHovered, setAnchorHovered, anchorRef, tipRef, {
    dismissOnOutside: !autoShow,
  })

  useEffect(() => {
    if (touchPinnedOpen && !wasTouchOpenRef.current && touchOpenAnnounce) {
      announceScreenReader(touchOpenAnnounce)
    }
    wasTouchOpenRef.current = touchPinnedOpen
  }, [touchPinnedOpen, touchOpenAnnounce])

  const touchGateCast = Boolean(touchActionHint) && !autoShow

  useEffect(() => {
    if (!touchGateCast) return
    const el = anchorRef.current
    if (!el) return
    const onTouchStart = () => {
      touchWasOpenRef.current = anchorOpenRef.current
      pendingTouchClickRef.current = true
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    return () => el.removeEventListener('touchstart', onTouchStart)
  }, [touchGateCast])

  let trigger: ReactNode = children
  if (touchGateCast) {
    const only = Children.toArray(children)
    const child = only.length === 1 && isValidElement(only[0]) ? only[0] : null
    if (child) {
      trigger = cloneElement(child, {
        onClick: (e: MouseEvent<HTMLElement>) => {
          const orig = child.props.onClick as ((e: MouseEvent<HTMLElement>) => void) | undefined
          if (pendingTouchClickRef.current) {
            pendingTouchClickRef.current = false
            // First touch: touchend opens tooltip; synthetic click must not cast.
            if (!touchWasOpenRef.current) return
          }
          orig?.(e)
        },
      })
    }
  }

  useLayoutEffect(() => {
    if (!tipMounted) return
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
        const parent = rectFromBox(c.left, c.top, c.width, c.height)
        const coarse = window.matchMedia('(pointer: coarse), (hover: none)').matches
        const avoid = coarse ? getTriggerAvoidRects(container) : []
        setPos(
          placeNestedTooltip(
            parent,
            { width: t.width, height: t.height },
            avoid,
            margin,
            undefined,
            { stackedBelowBeforeAbove: coarse },
          ),
        )
        return
      }

      const wantsBelow = a.top - margin - t.height < margin
      const top = wantsBelow ? a.bottom + margin : a.top - margin - t.height
      let left = a.left + a.width / 2 - t.width / 2
      left = Math.max(margin, Math.min(window.innerWidth - t.width - margin, left))
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
  }, [tipMounted])

  return (
    <>
      <span
        ref={anchorRef}
        className={`tooltip-anchor${touchPinnedOpen ? ' is-touch-open' : ''}${className ? ` ${className}` : ''}`}
        onMouseEnter={() => {
          if (canOpenFromMouse()) setAnchorHovered(true)
        }}
        onMouseLeave={() => {
          if (canOpenFromMouse()) setAnchorHovered(false)
        }}
        onFocus={() => {
          if (canOpenFromMouse()) setAnchorHovered(true)
        }}
        onBlur={() => {
          if (canOpenFromMouse()) setAnchorHovered(false)
        }}
        aria-label={ariaLabel}
      >
        {trigger}
      </span>
      {tipMounted &&
        createPortal(
          <div
            ref={tipRef}
            className={`hover-tooltip${variant ? ` tooltip-${variant}` : ''}${tipRevealed ? ' is-visible' : ''}`}
            role="tooltip"
            style={{
              left: displayPos?.left ?? 0,
              top: displayPos?.top ?? 0,
            }}
          >
            <div className="hover-tooltip-title">{title}</div>
            <div className="hover-tooltip-body">{body}</div>
            {showTouchActionHint && (
              <div className="hover-tooltip-action">{touchActionHint}</div>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
