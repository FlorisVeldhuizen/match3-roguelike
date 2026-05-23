import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { TRAIL_ARRIVAL_MS } from '../../timing'
import type { CombatPhase, GemColor } from '../../types'

const PHASE_LABEL: Record<CombatPhase, string> = {
  'player-acting': 'Your turn',
  'enemy-acting': 'Enemy turn',
  victory: 'Victory',
  'game-over': 'Defeated',
}

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
  const shakeTimerRef = useRef<number | null>(null)
  const triggerShake = (magnitude: number, durationMs: number) => {
    const el = document.querySelector('.game') as HTMLElement | null
    if (!el) return
    if (shakeTimerRef.current !== null) {
      window.clearTimeout(shakeTimerRef.current)
    }
    el.style.setProperty('--shake-mag', String(magnitude))
    el.style.setProperty('--shake-dur', `${durationMs}ms`)
    // Toggling the class via remove → reflow → add restarts the keyframe
    // animation even when shakes fire faster than they finish (streaks).
    el.classList.remove('shake')
    void el.offsetWidth
    el.classList.add('shake')
    shakeTimerRef.current = window.setTimeout(() => {
      el.classList.remove('shake')
      shakeTimerRef.current = null
    }, durationMs)
  }
  const [hpGlow, setHpGlow] = useState(false)
  const [blockPulse, setBlockPulse] = useState(false)
  const [hpHit, setHpHit] = useState(false)

  // Displayed values mirror the canonical store but tick to animation time
  // (gem trail arrival), not store-commit time. Every channel that writes
  // to these is delta-based off `event.amount` / `event.blocked` so the
  // delayed pool-gained timeouts commute with the immediate damage/heal
  // events — no snap-from-store, no race.
  const [displayedHp, setDisplayedHp] = useState(player.hp)
  const [displayedMana, setDisplayedMana] = useState(player.mana)
  const [displayedCharge, setDisplayedCharge] = useState(player.skillCharge)
  // Single source of truth for the block badge. Climbs as blue trails
  // land; `block-gained` doesn't snap it — engine guarantees the trail
  // sum equals the committed amount, so late trails land into a now-
  // committed badge and naturally complete the climb.
  const [stagedBlue, setStagedBlue] = useState(player.block)
  const [blockCommitted, setBlockCommitted] = useState(player.block > 0)

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
          else if (color === 'blue') setStagedBlue((s) => s + amount)
          // Red and green commit per-match via damage-dealt/healed
          // events; nothing accumulates on the HUD for those.
        }, TRAIL_ARRIVAL_MS)
      } else if (event.kind === 'block-gained') {
        // Just flip styling to "committed". The number itself keeps
        // climbing via late pool-gained timeouts; engine guarantees
        // their sum equals event.amount.
        setBlockCommitted(true)
      } else if (event.kind === 'healed') {
        // Delay the bar fill to sync with the green trail's arrival at
        // the HP bar (matches the popup timing in
        // AnimationController.scheduleDelayedHealPopup).
        const amount = event.amount
        window.setTimeout(() => {
          setDisplayedHp((h) =>
            Math.min(
              useGameStore.getState().fight.player.maxHp,
              h + amount,
            ),
          )
        }, TRAIL_ARRIVAL_MS)
      } else if (event.kind === 'damage-taken') {
        // Delta-based so this commutes with any still-in-flight heal /
        // block trails. Engine has already absorbed `blocked` from the
        // block stat; mirror that locally without reading the store.
        setDisplayedHp((h) => Math.max(0, h - event.amount))
        setStagedBlue((s) => Math.max(0, s - event.blocked))
        if (event.amount > 0) {
          setHpHit(true)
          window.setTimeout(() => setHpHit(false), 420)
          triggerShake(event.amount >= 5 ? 1.3 : 1.0, event.amount >= 5 ? 420 : 280)
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
          setStagedBlue(0)
          setBlockCommitted(false)
        }
      } else if (
        event.kind === 'damage-dealt' &&
        event.amount + event.blocked >= 5
      ) {
        triggerShake(1.0, 320)
      } else if (event.kind === 'screen-shake') {
        // Longer ride for bigger streak shakes so the heavy ones don't
        // feel as snappy as the small ones.
        const dur = 280 + Math.round(Math.min(event.magnitude, 2) * 140)
        triggerShake(event.magnitude, dur)
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
      setStagedBlue(p.block)
      setBlockCommitted(p.block > 0)
    })
    // rootSeed intentionally captured once for initial baseline; the
    // subscription itself tracks subsequent transitions.
  }, [rootSeed])

  // Clean up the shake timer on unmount so a late timeout doesn't poke
  // the DOM. The .game element is the wrapper around HUD + Pixi canvas;
  // position:fixed elements outside it (the phase banner) stay pinned
  // to the viewport because their tree has no transformed ancestor.
  useEffect(() => {
    return () => {
      if (shakeTimerRef.current !== null) {
        window.clearTimeout(shakeTimerRef.current)
      }
      const el = document.querySelector('.game')
      el?.classList.remove('shake')
    }
  }, [])

  const cls = (color: GemColor, base: string) =>
    pulse[color] > 0 ? `${base} pulsing` : base

  const hpPop = usePopOnChange(displayedHp)
  const blockPop = usePopOnChange(stagedBlue)
  const manaPop = usePopOnChange(displayedMana)
  const chargePop = usePopOnChange(displayedCharge)

  const hpPct = Math.max(0, (displayedHp / player.maxHp) * 100)
  // Low-HP urgency pulse, ≤30%, excluding 0 (game-over overlay handles that).
  const isLowHp = displayedHp > 0 && displayedHp / player.maxHp <= 0.3
  const badgeBlock = stagedBlue
  const blockHasPending = badgeBlock > 0 && !blockCommitted
  const blockActive = badgeBlock > 0 && blockCommitted

  return (
    <section className="hud" aria-label="Player status" data-player-hud="true">
      <div className="hud-row">
        <span className="hud-phase">{PHASE_LABEL[phase]}</span>
      </div>
      <div className="hud-row">
        <div
          className={`hp-bar ${hpGlow ? 'glow' : ''} ${hpHit ? 'hit' : ''} ${isLowHp ? 'low' : ''} ${cls('green', '')}`}
          role="img"
          aria-label={`HP ${displayedHp}/${player.maxHp}`}
          data-pool-target="green"
        >
          <div className="hp-fill" style={{ width: `${hpPct}%` }} />
          <span className="hp-text">
            <span key={hpPop.key} className={popClass(hpPop)}>
              {displayedHp}
            </span>{' '}
            / {player.maxHp}
          </span>
        </div>
        <div
          className={`block-badge ${blockActive ? 'active' : ''} ${blockHasPending ? 'pending' : ''} ${blockPulse ? 'pulsing' : ''} ${cls('blue', '')}`}
          title={
            blockHasPending
              ? `Block ${badgeBlock} (pending — commits at phase end)`
              : 'Block'
          }
          data-pool-target="blue"
        >
          <span className="block-icon" aria-hidden>🛡</span>
          <span className="block-value">
            <span key={blockPop.key} className={popClass(blockPop)}>
              {badgeBlock}
            </span>
          </span>
        </div>
      </div>
      <div className="hud-row hud-resources">
        <div
          className={cls('yellow', 'resource')}
          data-pool-target="yellow"
          title="Mana — earned from yellow stars; spent on spells. Persists across phases."
        >
          <span className="resource-dot" data-color="yellow" aria-hidden />
          <span className="resource-label">Mana</span>
          <span className="resource-value">
            <span key={manaPop.key} className={popClass(manaPop)}>
              {displayedMana}
            </span>
          </span>
        </div>
        <div
          className={cls('purple', 'resource')}
          data-pool-target="purple"
          title="Skill charge — earned from purple gems; full bar unlocks your ultimate."
        >
          <span className="resource-dot" data-color="purple" aria-hidden />
          <span className="resource-label">Charge</span>
          <span className="resource-value">
            <span key={chargePop.key} className={popClass(chargePop)}>
              {displayedCharge}
            </span>
          </span>
        </div>
      </div>
    </section>
  )
}

type PopState = { key: number; dir: -1 | 0 | 1 }

function usePopOnChange(value: number): PopState {
  const [state, setState] = useState<PopState>({ key: 0, dir: 0 })
  const prev = useRef(value)
  useEffect(() => {
    if (prev.current === value) return
    const dir: -1 | 1 = value > prev.current ? 1 : -1
    prev.current = value
    setState((s) => ({ key: s.key + 1, dir }))
  }, [value])
  return state
}

function popClass(p: PopState) {
  if (p.key === 0) return 'value-pop'
  return p.dir > 0 ? 'value-pop value-pop-up' : 'value-pop value-pop-down'
}
