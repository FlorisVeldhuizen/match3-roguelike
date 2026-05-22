import { useEffect, useRef, useState } from 'react'
import { subscribeGameEvents } from '../../core/events/emitter'
import type { CombatPhase } from '../../types'

type BannerStyle = 'player' | 'enemy' | 'victory' | 'defeat' | 'bonus'

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
  const idRef = useRef(0)
  const lastStyleRef = useRef<BannerStyle | null>(null)

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

  return (
    <div
      key={active.id}
      className={`phase-banner phase-banner-${active.style}`}
      role="status"
      aria-live="polite"
    >
      <span className="phase-banner-text">{active.label}</span>
    </div>
  )
}
