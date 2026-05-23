import { useEffect, useRef, useState } from 'react'
import { subscribeGameEvents } from '../../core/events/emitter'
import type { CombatPhase } from '../../types'
import { BOARD_MOUNT_ID } from '../App'

type BannerStyle = 'player' | 'enemy' | 'victory' | 'defeat' | 'bonus' | 'staggered'

type BannerEntry = {
  id: number
  label: string
  style: BannerStyle
}

// Which phase transitions get a banner. enemy-acting and player-acting are
// the workhorse beats; victory/game-over also announce here so the overlay
// doesn't pop in cold.
function bannerFor(phase: CombatPhase): { label: string; style: BannerStyle } | null {
  switch (phase) {
    case 'player-acting':
      return { label: 'Your Turn', style: 'player' }
    case 'enemy-acting':
      return { label: 'Enemy Turn', style: 'enemy' }
    case 'victory':
      return { label: 'Victory', style: 'victory' }
    case 'game-over':
      return { label: 'Defeated', style: 'defeat' }
    default:
      return null
  }
}

export function PhaseBanner() {
  const [active, setActive] = useState<BannerEntry | null>(null)
  const [boardCenter, setBoardCenter] = useState<{ x: number; y: number } | null>(
    null,
  )
  const idRef = useRef(0)
  const lastStyleRef = useRef<BannerStyle | null>(null)

  // Track the board's vertical on-screen center so the banner sits over the
  // board, not over empty header space. Horizontal positioning is left to
  // CSS (left: 50%): the board is already horizontally centered by the
  // page layout, and overriding X here via getBoundingClientRect was
  // causing a slight sub-pixel offset on mobile through the canvas-scaling
  // chain. ResizeObserver catches the canvas appearing post-mount; window
  // resize covers layout shifts.
  useEffect(() => {
    const el = document.getElementById(BOARD_MOUNT_ID)
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      setBoardCenter({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'extra-turn-granted') {
        // Bonus turns don't change phase, but the player needs to know they
        // get to act again. Don't dedupe — they should always announce.
        idRef.current += 1
        setActive({ id: idRef.current, label: 'Bonus Turn', style: 'bonus' })
        // Reset the dedupe tracker so the eventual "Your Turn" (next real
        // phase change) wouldn't be suppressed by this bonus banner.
        lastStyleRef.current = null
        return
      }
      if (event.kind === 'enemy-staggered') {
        // The "Enemy Turn" banner has already fired by this point. Overlay
        // "Staggered" on top so the player understands why the enemy is
        // about to do nothing. Don't dedupe — re-stagger is rare but real.
        idRef.current += 1
        setActive({ id: idRef.current, label: 'Staggered', style: 'staggered' })
        lastStyleRef.current = null
        return
      }
      if (event.kind !== 'phase-changed') return
      const meta = bannerFor(event.phase)
      if (!meta) return
      // Don't re-announce the same phase back-to-back.
      if (lastStyleRef.current === meta.style) return
      lastStyleRef.current = meta.style
      idRef.current += 1
      setActive({ id: idRef.current, label: meta.label, style: meta.style })
    })
  }, [])

  // Auto-clear after the animation finishes so the banner doesn't linger
  // in the DOM during gameplay.
  useEffect(() => {
    if (!active) return
    const t = window.setTimeout(() => {
      setActive((current) => (current && current.id === active.id ? null : current))
    }, 1100)
    return () => window.clearTimeout(t)
  }, [active])

  if (!active) return null

  // Wrapper handles centering via flexbox (rock-solid across browsers),
  // banner inside is just inline-block content. Previously used position:
  // fixed + transform: translate(-50%) on the banner itself, but iOS
  // Chrome/Safari rendered that with a fractional rightward offset that
  // came from compositor-layer rounding interacting with the scale
  // animation. Flexbox layout sidesteps that math entirely.
  return (
    <div
      className="phase-banner-anchor"
      style={boardCenter ? { top: `${boardCenter.y}px` } : undefined}
    >
      <div
        key={active.id}
        className={`phase-banner phase-banner-${active.style}`}
        role="status"
        aria-live="polite"
      >
        <span className="phase-banner-text">{active.label}</span>
      </div>
    </div>
  )
}
