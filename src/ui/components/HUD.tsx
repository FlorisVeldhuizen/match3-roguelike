import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import type { CombatPhase, GemColor } from '../../types'

const PHASE_LABEL: Record<CombatPhase, string> = {
  'player-acting': 'Your turn',
  resolving: 'Resolving…',
  'player-phase-end': 'Resolving…',
  'enemy-acting': 'Enemy turn',
  'enemy-end': 'Enemy turn',
  victory: 'Victory',
  'game-over': 'Defeated',
}

const POOL_COLORS: { color: GemColor; label: string; key: 'red' | 'blue' | 'green' }[] = [
  { color: 'red', label: 'R', key: 'red' },
  { color: 'blue', label: 'B', key: 'blue' },
  { color: 'green', label: 'G', key: 'green' },
]

// Particle trail travels ~700ms; pulse the indicator on arrival.
const TRAIL_TRAVEL_MS = 700
const PULSE_MS = 380

export function HUD() {
  const player = useGameStore((s) => s.fight.player)
  const phase = useGameStore((s) => s.fight.phase)
  const hpPct = Math.max(0, (player.hp / player.maxHp) * 100)
  const [pulse, setPulse] = useState<Record<GemColor, number>>({
    red: 0,
    blue: 0,
    green: 0,
    yellow: 0,
    purple: 0,
  })
  const [shake, setShake] = useState(false)
  const [hpGlow, setHpGlow] = useState(false)
  const [blockPulse, setBlockPulse] = useState(false)
  const [hpHit, setHpHit] = useState(false)

  useEffect(() => {
    const unsub = subscribeGameEvents((event) => {
      if (event.kind === 'pool-gained') {
        const color = event.color
        window.setTimeout(() => {
          setPulse((prev) => ({ ...prev, [color]: prev[color] + 1 }))
          window.setTimeout(() => {
            setPulse((prev) => ({ ...prev, [color]: Math.max(0, prev[color] - 1) }))
          }, PULSE_MS)
        }, TRAIL_TRAVEL_MS)
      } else if (event.kind === 'damage-dealt' && event.amount >= 5) {
        setShake(true)
        window.setTimeout(() => setShake(false), 320)
      } else if (event.kind === 'screen-shake') {
        setShake(true)
        window.setTimeout(() => setShake(false), 320)
      } else if (event.kind === 'healed') {
        setHpGlow(true)
        window.setTimeout(() => setHpGlow(false), 500)
      } else if (event.kind === 'block-gained') {
        setBlockPulse(true)
        window.setTimeout(() => setBlockPulse(false), 500)
      } else if (event.kind === 'damage-taken') {
        if (event.amount > 0) {
          setHpHit(true)
          window.setTimeout(() => setHpHit(false), 420)
          // Shake on every HP hit, harder on big ones.
          setShake(true)
          window.setTimeout(() => setShake(false), event.amount >= 5 ? 420 : 280)
          // Vignette flash on the whole frame.
          document.body.classList.add('vignette-damage')
          window.setTimeout(
            () => document.body.classList.remove('vignette-damage'),
            500,
          )
        }
      }
    })
    return unsub
  }, [])

  // Apply screenshake to .game (the wrapper around HUD + Pixi canvas) rather
  // than body. position:fixed elements outside .game (the phase banner) stay
  // pinned to the viewport because their tree has no transformed ancestor.
  useEffect(() => {
    const el = document.querySelector('.game')
    if (!el) return
    el.classList.toggle('shake', shake)
    return () => el.classList.remove('shake')
  }, [shake])

  const cls = (color: GemColor, base: string) =>
    pulse[color] > 0 ? `${base} pulsing` : base

  return (
    <section className="hud" aria-label="Player status" data-player-hud="true">
      <div className="hud-row">
        <span className="hud-phase">{PHASE_LABEL[phase]}</span>
      </div>
      <div className="hud-row">
        <div
          className={`hp-bar ${hpGlow ? 'glow' : ''} ${hpHit ? 'hit' : ''}`}
          role="img"
          aria-label={`HP ${player.hp}/${player.maxHp}`}
        >
          <div className="hp-fill" style={{ width: `${hpPct}%` }} />
          <span className="hp-text">
            {player.hp} / {player.maxHp}
          </span>
        </div>
        <div
          className={`block-badge ${player.block > 0 ? 'active' : ''} ${blockPulse ? 'pulsing' : ''}`}
          title="Block"
        >
          <span className="block-icon" aria-hidden>🛡</span>
          <span className="block-value">{player.block}</span>
        </div>
      </div>
      <div className="hud-row hud-resources">
        <div
          className={cls('yellow', 'resource resource-mana')}
          data-pool-target="yellow"
          title="Mana (yellow, persistent)"
        >
          <span className="resource-dot" data-color="yellow" aria-hidden />
          <span className="resource-label">Mana</span>
          <span className="resource-value">{player.mana}</span>
        </div>
        <div
          className={cls('purple', 'resource resource-charge')}
          data-pool-target="purple"
          title="Skill charge (purple, persistent)"
        >
          <span className="resource-dot" data-color="purple" aria-hidden />
          <span className="resource-label">Charge</span>
          <span className="resource-value">{player.skillCharge}</span>
        </div>
      </div>
      <div className="hud-row hud-pools" aria-label="This phase's pools">
        <span className="hud-pools-label">Phase pools</span>
        {POOL_COLORS.map(({ color, label, key }) => (
          <div
            key={color}
            className={cls(color, 'pool')}
            data-pool-target={color}
            title={`${color} pool (resolves at end of phase)`}
          >
            <span className="pool-dot" data-color={color} aria-hidden>{label}</span>
            <span className="pool-value">{player.phasePools[key]}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
