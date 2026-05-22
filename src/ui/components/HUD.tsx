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

  const pendingBlue = player.phasePools.blue
  const pendingGreen = player.phasePools.green
  // During the player phase, blue gems are flying to the shield; show the
  // pool on the badge so the running total is visible. `block` is the
  // committed value (built up at phase-end + carried from prior phases);
  // `pendingBlue` is what will fold into it at phase end. We display the
  // sum so the badge shows the value the player can plan around — the
  // `pending` class signals that part of it is still up for grabs (Bulwark
  // etc. can siphon the pool before it commits).
  const displayedBlock = player.block + pendingBlue
  const blockHasPending = pendingBlue > 0
  const blockActive = displayedBlock > 0

  return (
    <section className="hud" aria-label="Player status" data-player-hud="true">
      <div className="hud-row">
        <span className="hud-phase">{PHASE_LABEL[phase]}</span>
      </div>
      <div className="hud-row">
        <div
          className={`hp-bar ${hpGlow ? 'glow' : ''} ${hpHit ? 'hit' : ''} ${cls('green', '')}`}
          role="img"
          aria-label={`HP ${player.hp}/${player.maxHp}`}
          data-pool-target="green"
          title={
            pendingGreen > 0
              ? `Healing +${pendingGreen} at end of phase`
              : undefined
          }
        >
          <div className="hp-fill" style={{ width: `${hpPct}%` }} />
          <span className="hp-text">
            {player.hp} / {player.maxHp}
          </span>
          {pendingGreen > 0 && (
            <span className="hp-pending" aria-hidden>+{pendingGreen}</span>
          )}
        </div>
        <div
          className={`block-badge ${blockActive ? 'active' : ''} ${blockHasPending ? 'pending' : ''} ${blockPulse ? 'pulsing' : ''} ${cls('blue', '')}`}
          title={
            blockHasPending
              ? `Block ${player.block} (+${pendingBlue} pending at phase end)`
              : 'Block'
          }
          data-pool-target="blue"
        >
          <span className="block-icon" aria-hidden>🛡</span>
          <span className="block-value">{displayedBlock}</span>
        </div>
      </div>
      <div className="hud-row hud-resources">
        <div
          className={cls('yellow', 'resource resource-mana')}
          data-pool-target="yellow"
          title="Mana — earned from yellow stars; spent on spells. Persists across phases."
        >
          <span className="resource-dot" data-color="yellow" aria-hidden />
          <span className="resource-label">Mana</span>
          <span className="resource-value">{player.mana}</span>
        </div>
        <div
          className={cls('purple', 'resource resource-charge')}
          data-pool-target="purple"
          title="Skill charge — earned from purple gems; full bar unlocks your ultimate."
        >
          <span className="resource-dot" data-color="purple" aria-hidden />
          <span className="resource-label">Charge</span>
          <span className="resource-value">{player.skillCharge}</span>
        </div>
      </div>
    </section>
  )
}
