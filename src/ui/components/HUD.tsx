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
  const rootSeed = useGameStore((s) => s.rootSeed)
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

  // ---- Event-driven displayed values --------------------------------
  // Canonical state finalises the whole turn (EOP → enemy attack →
  // beginPlayerPhase) inside `attemptSwap` before React ever sees it, so
  // intermediate values like committed block are invisible if we read
  // them straight from the store. These mirrors are driven by the same
  // animation event stream the canvas listens to, so the HUD ticks in
  // lockstep with the visible action: gain on trail-arrival, drain on
  // damage-taken, reset on the next player phase.
  const [displayedHp, setDisplayedHp] = useState(player.hp)
  const [displayedMana, setDisplayedMana] = useState(player.mana)
  const [displayedCharge, setDisplayedCharge] = useState(player.skillCharge)
  const [displayedBlock, setDisplayedBlock] = useState(player.block)
  // Block is the one remaining pooled resource — it has to snap into
  // place before the enemy attacks, so blue gems still accumulate
  // through the cascade and commit on `block-gained` at EOP. Red/green
  // commit per-match (plan B), so no pendingRed/pendingGreen here.
  const [pendingBlue, setPendingBlue] = useState(0)

  useEffect(() => {
    const unsub = subscribeGameEvents((event) => {
      if (event.kind === 'pool-gained') {
        const color = event.color
        const amount = event.amount
        // Delay the value bump until the particle trail visibly lands —
        // same window as the existing indicator pulse — so the "+N"
        // popup spawned at arrival reads as the cause.
        window.setTimeout(() => {
          setPulse((prev) => ({ ...prev, [color]: prev[color] + 1 }))
          window.setTimeout(() => {
            setPulse((prev) => ({ ...prev, [color]: Math.max(0, prev[color] - 1) }))
          }, PULSE_MS)
          if (color === 'yellow') setDisplayedMana((m) => m + amount)
          else if (color === 'purple') setDisplayedCharge((c) => c + amount)
          else if (color === 'blue') setPendingBlue((p) => p + amount)
          // Red and green commit per-match via damage-dealt/healed
          // events; nothing accumulates on the HUD for those.
        }, TRAIL_TRAVEL_MS)
      } else if (event.kind === 'block-gained') {
        // EOP committed the blue pool to the block stat. Move pending
        // into displayed — the badge stays the same number, just visually
        // shifts from "pending" styling to "active".
        setDisplayedBlock(event.amount)
        setPendingBlue(0)
      } else if (event.kind === 'healed') {
        // Per-match heal commit. Delay the bar fill to sync with the
        // green trail's arrival at the HP bar (matches the popup
        // timing in AnimationController.scheduleDelayedHealPopup).
        const amount = event.amount
        window.setTimeout(() => {
          setDisplayedHp((h) =>
            Math.min(
              useGameStore.getState().fight.player.maxHp,
              h + amount,
            ),
          )
        }, TRAIL_TRAVEL_MS)
      } else if (event.kind === 'damage-taken') {
        // Snap to post-absorption state so the bar drain matches what
        // the engine actually computed (block may have absorbed part).
        const s = useGameStore.getState().fight.player
        setDisplayedHp(s.hp)
        setDisplayedBlock(s.block)
        if (event.amount > 0) {
          setHpHit(true)
          window.setTimeout(() => setHpHit(false), 420)
          setShake(true)
          window.setTimeout(() => setShake(false), event.amount >= 5 ? 420 : 280)
          document.body.classList.add('vignette-damage')
          window.setTimeout(
            () => document.body.classList.remove('vignette-damage'),
            500,
          )
        }
      } else if (event.kind === 'phase-changed') {
        // Block is per-phase: it expires the moment the next player
        // phase begins. beginPlayerPhase already cleared it on the
        // store side; we mirror that here so the badge zeroes in
        // animation-time, not before the enemy hit is even shown.
        if (event.phase === 'player-acting') {
          setDisplayedBlock(0)
          setPendingBlue(0)
        }
      } else if (event.kind === 'damage-dealt' && event.amount >= 5) {
        setShake(true)
        window.setTimeout(() => setShake(false), 320)
      } else if (event.kind === 'screen-shake') {
        setShake(true)
        window.setTimeout(() => setShake(false), 320)
      }
      // Decorative pulses on commit events — these run independently of
      // the displayed-value updates above (which already handle the
      // healed/block-gained events for value changes).
      if (event.kind === 'healed') {
        setHpGlow(true)
        window.setTimeout(() => setHpGlow(false), 500)
      } else if (event.kind === 'block-gained') {
        setBlockPulse(true)
        window.setTimeout(() => setBlockPulse(false), 500)
      }
    })
    return unsub
  }, [])

  // Run reset (restart, new run): hard-resync to canonical state.
  // Subscribe to the store so the setState call happens in the
  // subscription callback rather than in the effect body — keeps it on
  // the "external system update" side of React's effect rules.
  useEffect(() => {
    let prevSeed = rootSeed
    return useGameStore.subscribe((s) => {
      if (s.rootSeed === prevSeed) return
      prevSeed = s.rootSeed
      const p = s.fight.player
      setDisplayedHp(p.hp)
      setDisplayedMana(p.mana)
      setDisplayedCharge(p.skillCharge)
      setDisplayedBlock(p.block)
      setPendingBlue(0)
    })
    // rootSeed intentionally captured once for initial baseline; the
    // subscription itself tracks subsequent transitions.
  }, [rootSeed])

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

  const hpPct = Math.max(0, (displayedHp / player.maxHp) * 100)
  const badgeBlock = displayedBlock + pendingBlue
  const blockHasPending = pendingBlue > 0
  const blockActive = badgeBlock > 0

  return (
    <section className="hud" aria-label="Player status" data-player-hud="true">
      <div className="hud-row">
        <span className="hud-phase">{PHASE_LABEL[phase]}</span>
      </div>
      <div className="hud-row">
        <div
          className={`hp-bar ${hpGlow ? 'glow' : ''} ${hpHit ? 'hit' : ''} ${cls('green', '')}`}
          role="img"
          aria-label={`HP ${displayedHp}/${player.maxHp}`}
          data-pool-target="green"
        >
          <div className="hp-fill" style={{ width: `${hpPct}%` }} />
          <span className="hp-text">
            {displayedHp} / {player.maxHp}
          </span>
        </div>
        <div
          className={`block-badge ${blockActive ? 'active' : ''} ${blockHasPending ? 'pending' : ''} ${blockPulse ? 'pulsing' : ''} ${cls('blue', '')}`}
          title={
            blockHasPending
              ? `Block ${displayedBlock} (+${pendingBlue} pending at phase end)`
              : 'Block'
          }
          data-pool-target="blue"
        >
          <span className="block-icon" aria-hidden>🛡</span>
          <span className="block-value">{badgeBlock}</span>
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
          <span className="resource-value">{displayedMana}</span>
        </div>
        <div
          className={cls('purple', 'resource resource-charge')}
          data-pool-target="purple"
          title="Skill charge — earned from purple gems; full bar unlocks your ultimate."
        >
          <span className="resource-dot" data-color="purple" aria-hidden />
          <span className="resource-label">Charge</span>
          <span className="resource-value">{displayedCharge}</span>
        </div>
      </div>
    </section>
  )
}
