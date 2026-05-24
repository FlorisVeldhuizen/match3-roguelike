import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useGameStore } from '../../core/state/store'
import { HoverTooltip } from './HoverTooltip'
import { subscribeGameEvents } from '../../core/events/emitter'
import {
  applyStatusToList,
  statusKindFromDamageSource,
} from '../../core/combat/statuses'
import { TRAIL_ARRIVAL_MS } from '../../timing'
import {
  MANA_CAPS,
  type GemColor,
  type StatusInstance,
  type StatusKind,
} from '../../types'
import { consumeSpellCost } from '../../core/combat/mana'
import { StatusBar } from './StatusBar'
import {
  getSpell,
  getUltimate,
  isUltimateId,
  listUltimates,
} from '../../core/combat/spellRegistry'

const PULSE_MS = 380

export function HUD() {
  const player = useGameStore((s) => s.fight.player)
  // Status icons are animation-timed (driven by status-applied /
  // status-ticked / status-expired events) so the chip lands when the
  // particles arrive, not at swap commit. Mirrors the
  // displayedHp/displayedBlock pattern below.
  const [displayedStatuses, setDisplayedStatuses] = useState<StatusInstance[]>(
    () => useGameStore.getState().fight.player.statuses,
  )
  // Bumps per status kind on every tick — used as a React key so the
  // chip's "-1" popup re-mounts and replays its keyframe animation.
  // Status kinds with no entry have never ticked on this chip.
  const [statusTickMarks, setStatusTickMarks] = useState<
    Partial<Record<StatusKind, number>>
  >({})
  // Parallel bumps that fire BEFORE the proc damage lands — drives the
  // chip's "winding up" ember pulse so the player sees the chip act
  // before the HP drain arrives.
  const [statusCueMarks, setStatusCueMarks] = useState<
    Partial<Record<StatusKind, number>>
  >({})
  // Kinds in their fizzle window — the chip remains in displayedStatuses
  // during this window so the goodbye flash + fade animation has
  // something to play on. Cleared once the fizzle finishes and the
  // chip is filtered out.
  const [expiringStatusKinds, setExpiringStatusKinds] = useState<
    Set<StatusKind>
  >(() => new Set())
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
  // Separate flag for burn-tick HP flashes so the bar can render an
  // ember pulse (`.burn-hit`) instead of the red `.hit` flash. Driven by
  // damage-taken events with source='burn' (proc path).
  const [hpBurnHit, setHpBurnHit] = useState(false)
  // "This attack carried fire" halo on the HUD frame — fires once at
  // the impact moment of an enemy attack whose onHitRider is burn. Sits
  // alongside the regular shake/vignette/red flash (the attack itself
  // is still a normal hit) and lingers a beat as the chip drops in.
  const [hudBurnImpact, setHudBurnImpact] = useState(false)

  // Displayed values mirror the canonical store but tick to animation time
  // (gem trail arrival), not store-commit time. Every channel that writes
  // to these is delta-based off `event.amount` / `event.blocked` so the
  // delayed pool-gained timeouts commute with the immediate damage/heal
  // events — no snap-from-store, no race.
  const [displayedHp, setDisplayedHp] = useState(player.hp)
  // H3: per-colour mana pools, mirrored on a particle-trail delay.
  // Replaced the single `displayedMana: number` field with a full
  // ManaPools object. Each pool-gained event for a colour writes to
  // the matching pool, capped at MANA_CAPS for that colour.
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
          // H3: every coloured match (R/B/G/Y) also accumulates into its
          // colour mana pool, capped at MANA_CAPS. Purple still feeds
          // skillCharge only. Block staging for blue is unchanged.
          if (color === 'purple') setDisplayedCharge((c) => c + amount)
          else if (color === 'red' || color === 'blue' || color === 'green' || color === 'yellow') {
            setDisplayedMana((m) => ({
              ...m,
              [color]: Math.min(MANA_CAPS[color], m[color] + amount),
            }))
          }
          if (color === 'blue') setStagedBlue((s) => s + amount)
          // Red and green still commit per-match via damage-dealt/healed
          // events; nothing accumulates on the block badge / HP bar for
          // those (those events drive HP / enemy HP directly).
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
        // Status-proc damage (Burn etc.) is delayed so the HP drain,
        // block-badge drop, and hit pulses all land with the chip→
        // bar particle trail's arrival. Everything else (enemy
        // attacks, etc.) is immediate.
        const proc = statusKindFromDamageSource(event.source)
        const isProc = proc !== null
        // Fire the chip "wind up" cue IMMEDIATELY (not delayed) so it
        // precedes the impact at +TRAIL_ARRIVAL_MS. The chip pulses
        // as its particles launch; the impact lands when they arrive.
        if (isProc && proc && (event.amount > 0 || event.blocked > 0)) {
          const procKind = proc
          setStatusCueMarks((prev) => ({
            ...prev,
            [procKind]: (prev[procKind] ?? 0) + 1,
          }))
        }
        // Delay HUD updates to trail arrival whenever the proc did ANY
        // damage (HP or block). Previously only `amount > 0` triggered
        // the delay, so a fully-blocked burn tick snapped the block
        // badge to its new value at t=0 while the chip→block particle
        // trail was still in flight — particles arrived 700ms later
        // at an already-updated badge.
        const delay =
          isProc && (event.amount > 0 || event.blocked > 0)
            ? TRAIL_ARRIVAL_MS
            : 0
        const amount = event.amount
        const blocked = event.blocked
        const apply = () => {
          // Delta-based so this commutes with any still-in-flight heal /
          // block trails. Engine has already absorbed `blocked` from the
          // block stat; mirror that locally without reading the store.
          setDisplayedHp((h) => Math.max(0, h - amount))
          setStagedBlue((s) => Math.max(0, s - blocked))
          if (amount > 0) {
            if (isProc) {
              // Burn-tick treatment: ember bar pulse + dim orange
              // vignette, no shake. A DoT shouldn't gut-punch the same
              // way a Smolder attack does — the chip→bar particle trail
              // already carries the "fire damage" story; piling on red
              // shake/vignette made the two events feel identical.
              setHpBurnHit(true)
              window.setTimeout(() => setHpBurnHit(false), 520)
              document.body.classList.add('vignette-burn')
              window.setTimeout(
                () => document.body.classList.remove('vignette-burn'),
                520,
              )
            } else {
              setHpHit(true)
              window.setTimeout(() => setHpHit(false), 420)
              triggerShake(amount >= 5 ? 1.3 : 1.0, amount >= 5 ? 420 : 280)
              document.body.classList.add('vignette-damage')
              window.setTimeout(
                () => document.body.classList.remove('vignette-damage'),
                500,
              )
              // Enemy attack with a status rider: pulse the "carrier"
              // halo on the HUD frame so the eye registers "this hit
              // brought something extra" before the chip arrives.
              if (event.onHitRider != null) {
                setHudBurnImpact(true)
                window.setTimeout(() => setHudBurnImpact(false), 640)
              }
            }
          }
        }
        if (delay > 0) window.setTimeout(apply, delay)
        else apply()
      } else if (event.kind === 'spell-cast') {
        // Mirror the store's cost deduction on the HUD's local mirror.
        // Spell-cast is a free action with no animated trail, so this
        // applies immediately rather than waiting for TRAIL_ARRIVAL_MS.
        if (isUltimateId(event.spellId)) {
          const cost = getUltimate(event.spellId).chargeCost
          setDisplayedCharge((c) => Math.max(0, c - cost))
        } else {
          const cost = getSpell(event.spellId).cost
          setDisplayedMana((m) => consumeSpellCost(m, cost))
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
      } else if (event.kind === 'status-applied' && event.target === 'player') {
        // Apply the chip change IMMEDIATELY at event time — no delay.
        // The previous behaviour delayed the chip update by
        // TRAIL_ARRIVAL_MS to sync with the particle trail, but that
        // delay let a follow-up status-ticked (next-phase begin within
        // the same synchronous event burst) race the apply at +700ms.
        // The intermediate value (e.g. "Burn 5") was visible for ~5ms
        // before being overwritten by the tick's `remaining` (e.g.
        // "Burn 4"), so the player saw chip 3 → 4 with a `−5` popup
        // and no visible "+2 applied" beat. Now the chip reflects the
        // new value at event time; the trail particles spawned by
        // AC.spawnStatusTrail are decorative confirmation flying
        // toward an already-updated chip.
        setDisplayedStatuses((prev) => applyStatusToList(prev, event.status))
      } else if (event.kind === 'status-ticked' && event.target === 'player') {
        // StS pattern: stacks is the chip number AND the turns counter,
        // and the tick decrements it. Delay the chip update by
        // TRAIL_ARRIVAL_MS so it lands AFTER the tick's particle-driven
        // HP drain — otherwise the chip ticks 3→2 while the hit-for-3 is
        // still in flight, inverting cause and effect.
        const { statusKind, remaining } = event
        window.setTimeout(() => {
          setDisplayedStatuses((prev) =>
            prev.map((s) =>
              s.kind === statusKind ? { ...s, stacks: remaining } : s,
            ),
          )
          setStatusTickMarks((prev) => ({
            ...prev,
            [statusKind]: (prev[statusKind] ?? 0) + 1,
          }))
        }, TRAIL_ARRIVAL_MS)
      } else if (event.kind === 'status-expired' && event.target === 'player') {
        // Goodbye flash + fade on the chip when its final tick lands.
        // Sequence:
        //   t = +TRAIL_ARRIVAL_MS         → mark chip as expiring; the
        //                                    `is-expiring` CSS class plays
        //                                    a ~480ms flash-and-fade.
        //   t = +TRAIL_ARRIVAL_MS + FIZZLE → filter the status out of
        //                                    displayedStatuses; chip
        //                                    unmounts after animation.
        // The chip stays mounted during the fizzle window so the
        // animation has something to play on. Without this beat the
        // chip would just vanish silently as the HP drain landed,
        // losing the "you survived that burn" feedback.
        const { statusKind } = event
        const FIZZLE_MS = 480
        window.setTimeout(() => {
          setExpiringStatusKinds((prev) => {
            if (prev.has(statusKind)) return prev
            const next = new Set(prev)
            next.add(statusKind)
            return next
          })
        }, TRAIL_ARRIVAL_MS)
        window.setTimeout(() => {
          setDisplayedStatuses((prev) =>
            prev.filter((s) => s.kind !== statusKind),
          )
          setExpiringStatusKinds((prev) => {
            if (!prev.has(statusKind)) return prev
            const next = new Set(prev)
            next.delete(statusKind)
            return next
          })
        }, TRAIL_ARRIVAL_MS + FIZZLE_MS)
      }
    })
    return unsub
  }, [])

  // Run reset (restart, accept-reward → next fight, skip-reward): hard-
  // resync to canonical state. Keyed on fightCounter so it fires for
  // both same-run new-fight transitions and full restarts (which also
  // bump the counter).
  useEffect(() => {
    let prevFightCounter = useGameStore.getState().fightCounter
    return useGameStore.subscribe((s) => {
      if (s.fightCounter === prevFightCounter) return
      prevFightCounter = s.fightCounter
      const p = s.fight.player
      setDisplayedHp(p.hp)
      setDisplayedMana(p.mana)
      setDisplayedCharge(p.skillCharge)
      setStagedBlue(p.block)
      setBlockCommitted(p.block > 0)
      setDisplayedStatuses(p.statuses)
      setStatusTickMarks({})
      setStatusCueMarks({})
      setExpiringStatusKinds(new Set())
    })
  }, [])

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
  // Per-colour mana pop animations. Each chip animates independently
  // when its own value changes (a yellow match doesn't pulse the red
  // chip, etc.).
  const redManaPop = usePopOnChange(displayedMana.red)
  const blueManaPop = usePopOnChange(displayedMana.blue)
  const greenManaPop = usePopOnChange(displayedMana.green)
  const yellowManaPop = usePopOnChange(displayedMana.yellow)
  const chargePop = usePopOnChange(displayedCharge)

  const hpPct = Math.max(0, (displayedHp / player.maxHp) * 100)
  // Low-HP urgency pulse, ≤30%, excluding 0 (game-over overlay handles that).
  const isLowHp = displayedHp > 0 && displayedHp / player.maxHp <= 0.3
  const badgeBlock = stagedBlue
  const blockHasPending = badgeBlock > 0 && !blockCommitted
  const blockActive = badgeBlock > 0 && blockCommitted

  return (
    <section
      className={`hud${hudBurnImpact ? ' burn-impact' : ''}`}
      aria-label="Player status"
      data-player-hud="true"
    >
      {/* H3-C v4: state + resources in ONE flat row — HP/block + statuses
          on the left, mana pips + charge on the right. Statuses are
          inline with HP because they're combat state (Burn ticks your
          HP, Vulnerable amplifies incoming damage). Inline means no
          separate row appearing/disappearing as statuses come and go —
          when there are none, the row just has less in it; when there
          are some, they sit next to the block badge. */}
      <div className="hud-row hud-stat-resource-row">
        <div className="hud-stat-cluster">
          <div
            className={`hp-bar ${hpGlow ? 'glow' : ''} ${hpHit ? 'hit' : ''} ${hpBurnHit ? 'burn-hit' : ''} ${isLowHp ? 'low' : ''} ${cls('green', '')}`}
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
          <StatusBar
            statuses={displayedStatuses}
            tickMarks={statusTickMarks}
            cueMarks={statusCueMarks}
            expiringKinds={expiringStatusKinds}
            className="player-statuses player-statuses-inline"
          />
        </div>
        <div className="hud-resource-cluster hud-mana-chips">
          <ManaChip
          color="red"
          value={displayedMana.red}
          cap={MANA_CAPS.red}
          pop={redManaPop}
          pulsing={pulse.red > 0}
          title="Red mana"
          body={
            <>
              <div>Earned from <strong>red gem matches</strong>. Spent on offensive spells like Bash and Volley.</div>
              <div className="hover-tooltip-aside">Caps at {MANA_CAPS.red}. Persists across fights.</div>
            </>
          }
        />
        <ManaChip
          color="blue"
          value={displayedMana.blue}
          cap={MANA_CAPS.blue}
          pop={blueManaPop}
          pulsing={pulse.blue > 0}
          title="Blue mana"
          body={
            <>
              <div>Earned from <strong>blue gem matches</strong>. Spent on defensive spells like Bulwark and Reinforce.</div>
              <div className="hover-tooltip-aside">Caps at {MANA_CAPS.blue}. Persists across fights.</div>
            </>
          }
        />
        <ManaChip
          color="green"
          value={displayedMana.green}
          cap={MANA_CAPS.green}
          pop={greenManaPop}
          pulsing={pulse.green > 0}
          title="Green mana"
          body={
            <>
              <div>Earned from <strong>green gem matches</strong>. Spent on healing and cleanse spells.</div>
              <div className="hover-tooltip-aside">Caps at {MANA_CAPS.green}. Persists across fights.</div>
            </>
          }
        />
        <ManaChip
          color="yellow"
          value={displayedMana.yellow}
          cap={MANA_CAPS.yellow}
          pop={yellowManaPop}
          pulsing={pulse.yellow > 0}
          wild
          title="Wild mana"
          body={
            <>
              <div>Earned from <strong>yellow gem matches</strong>. <strong>Substitutes for any colour's spell cost at 1:1</strong> — pays the shortfall when you're light on a specific colour.</div>
              <div className="hover-tooltip-aside">Caps at {MANA_CAPS.yellow}. Persists across fights.</div>
            </>
          }
        />
          <span className="hud-divider" aria-hidden />
          <ChargeChip
            value={displayedCharge}
            pop={chargePop}
            pulsing={pulse.purple > 0}
          />
        </div>
      </div>
      {/* Statuses now render inline with the stat cluster above (next
          to the block badge). No separate context row → no layout shift
          when statuses appear / disappear. */}
    </section>
  )
}

function ManaChip({
  color,
  value,
  cap,
  pop,
  pulsing,
  wild,
  title,
  body,
}: {
  color: GemColor
  value: number
  cap: number
  pop: PopState
  pulsing: boolean
  wild?: boolean
  title: string
  body: ReactNode
}) {
  // data-mana-target: the trail attractor for this colour's pool-gained
  // particles (H3 routing). data-pool-target stays on the immediate-effect
  // target (block badge for blue, HP bar for green, etc.) so the arrival
  // popup + heal/block FX still anchor to those. For yellow specifically,
  // the chip carries both attributes because yellow's popup IS the
  // mana popup — no other "effect" anchor exists for it.
  return (
    <HoverTooltip
      variant="mana"
      title={`${title} — ${value}/${cap}`}
      body={body}
      ariaLabel={`${title}: ${value} of ${cap}`}
    >
      <span
        className={`mana-chip mana-${color}${wild ? ' mana-wild' : ''}${pulsing ? ' pulsing' : ''}${value >= cap ? ' is-capped' : ''}`}
        data-mana-target={color}
        data-pool-target={color === 'yellow' ? 'yellow' : undefined}
      >
        <span className="mana-dot" data-color={color} aria-hidden />
        <span className="mana-value">
          <span key={pop.key} className={popClass(pop)}>{value}</span>
          <span className="mana-cap">/{cap}</span>
        </span>
      </span>
    </HoverTooltip>
  )
}

// Charge sits next to the mana row visually but is conceptually separate:
// it's not mana, it's the ultimate's fuel. Matches the mana-chip
// silhouette so the row reads coherently, with a faint divider before
// it (see .hud-divider) signalling "different resource class."
function ChargeChip({
  value,
  pop,
  pulsing,
}: {
  value: number
  pop: PopState
  pulsing: boolean
}) {
  // Threshold = the lowest-cost ultimate. Slice has one (Riposte) so this
  // is just its chargeCost. With multiple ultimates later, this becomes
  // "your cheapest available ultimate."
  const ult = listUltimates()[0]
  const threshold = ult?.chargeCost ?? 8
  const ready = value >= threshold
  // Display just the current value — there's no cap on charge, only a
  // *cost* to fire the ultimate. Previous "/8" misread as a cap (the
  // value can overflow 8 — confusing). The cost is shown on the spell
  // card itself; the chip just shows how much charge you've banked.
  return (
    <HoverTooltip
      variant="charge"
      title={`Skill charge — ${value}`}
      body={
        <>
          <div>Earned from <strong>purple gem matches</strong>. Powers your <strong>ultimate</strong> ability.</div>
          <div className="hover-tooltip-aside">
            {ready
              ? `Fully charged — ${ult?.name ?? 'your ultimate'} is ready to cast.`
              : `${threshold - value} more to unlock ${ult?.name ?? 'your ultimate'}.`}
          </div>
        </>
      }
      ariaLabel={`Skill charge: ${value}`}
    >
      <span
        className={`charge-chip${pulsing ? ' pulsing' : ''}${ready ? ' is-ready' : ''}`}
        data-pool-target="purple"
      >
        <span className="charge-icon" data-color="purple" aria-hidden />
        <span className="mana-value">
          <span key={pop.key} className={popClass(pop)}>{value}</span>
        </span>
      </span>
    </HoverTooltip>
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
