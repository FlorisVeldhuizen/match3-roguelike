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
  const [boardCenter, setBoardCenter] = useState<{ x: number; y: number } | null>(null)
  const idRef = useRef(0)
  const lastStyleRef = useRef<BannerStyle | null>(null)

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
        idRef.current += 1
        setActive({ id: idRef.current, label: 'Bonus Turn', style: 'bonus' })
        lastStyleRef.current = null
        return
      }
      if (event.kind === 'enemy-staggered') {
        idRef.current += 1
        setActive({ id: idRef.current, label: 'Staggered', style: 'staggered' })
        lastStyleRef.current = null
        return
      }
      if (event.kind !== 'phase-changed') return
      const meta = bannerFor(event.phase)
      if (!meta) return
      if (lastStyleRef.current === meta.style) return
      lastStyleRef.current = meta.style
      idRef.current += 1
      setActive({ id: idRef.current, label: meta.label, style: meta.style })
    })
  }, [])

  useEffect(() => {
    if (!active) return
    const t = window.setTimeout(() => {
      setActive((current) => (current && current.id === active.id ? null : current))
    }, 1100)
    return () => window.clearTimeout(t)
  }, [active])

  if (!active) return null

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
