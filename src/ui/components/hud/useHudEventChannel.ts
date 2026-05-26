import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../../../core/state/store'
import { subscribeGameEvents } from '../../../core/events/emitter'
import {
  applyStatusToList,
  statusKindFromDamageSource,
} from '../../../core/combat/statuses'
import { TRAIL_ARRIVAL_MS } from '../../../timing'
import {
  MANA_CAPS,
  type GemColor,
  type ManaPools,
  type StatusInstance,
  type StatusKind,
} from '../../../types'
import { consumeSpellCost } from '../../../core/combat/mana'
import {
  getSpell,
  getUltimate,
  isUltimateId,
} from '../../../core/combat/spellRegistry'

const PULSE_MS = 380

// Per-status RGB triplets for the screen-edge vignette that fires on
// status-applied events targeting the player. Burn matches the existing
// vignette-burn hue so the apply + later tick reads as the same fire.
// Vulnerable sits a notch deeper amber to stay distinct from burn;
// Weak goes sickly yellow-green; buff hues exist for completeness but
// only ever fire if a non-player source ever applies them.
const STATUS_VIGNETTE_RGB: Record<StatusKind, string> = {
  burn: '255, 133, 64',
  vulnerable: '208, 130, 60',
  weak: '170, 184, 107',
  regen: '120, 200, 140',
  strength: '255, 200, 100',
}
const STATUS_VIGNETTE_MS = 540

// Animation-timed mirror of the player's HUD state. Subscribes to the
// game-event stream once and routes each event to the right local
// channel — displayed values tick with the particle trail arrivals,
// not with store commits. Returns a packed snapshot the HUD renders
// from. Owns the shake handler (DOM side-effect) and cleans it up on
// unmount.
//
// Every channel that writes here is delta-based off `event.amount` /
// `event.blocked` so the delayed pool-gained timeouts commute with the
// immediate damage/heal events — no snap-from-store, no race.
export type HudEventChannel = {
  displayedHp: number
  displayedMana: ManaPools
  displayedCharge: number
  displayedGold: number
  stagedBlue: number
  blockCommitted: boolean
  displayedStatuses: StatusInstance[]
  statusTickMarks: Partial<Record<StatusKind, number>>
  statusCueMarks: Partial<Record<StatusKind, number>>
  expiringStatusKinds: Set<StatusKind>
  pulse: Record<GemColor, number>
  hpGlow: boolean
  hpHit: boolean
  hpBurnHit: boolean
  blockPulse: boolean
}

export function useHudEventChannel(): HudEventChannel {
  const player = useGameStore((s) => s.fight.player)
  const [displayedStatuses, setDisplayedStatuses] = useState<StatusInstance[]>(
    () => useGameStore.getState().fight.player.statuses,
  )
  // Bumps per status kind on every tick — used as a React key so the
  // chip's "-1" popup re-mounts and replays its keyframe animation.
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
  // something to play on.
  const [expiringStatusKinds, setExpiringStatusKinds] = useState<
    Set<StatusKind>
  >(() => new Set())
  const [pulse, setPulse] = useState<Record<GemColor, number>>({
    red: 0,
    blue: 0,
    green: 0,
    yellow: 0,
    purple: 0,
    gold: 0,
  })
  const shakeTimerRef = useRef<number | null>(null)
  const triggerShake = (magnitude: number, durationMs: number) => {
    // Target .game-scene (enemies + board) so the shake doesn't drag
    // the HUD / spell tray / modals around. The scene wrapper sits
    // inside .game and only contains the combat visuals — that's
    // what should react to impact.
    const el = document.querySelector('.game-scene') as HTMLElement | null
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

  // Displayed values mirror the canonical store but tick to animation time
  // (gem trail arrival), not store-commit time.
  const [displayedHp, setDisplayedHp] = useState(player.hp)
  // H3: per-colour mana pools, mirrored on a particle-trail delay.
  const [displayedMana, setDisplayedMana] = useState(player.mana)
  const [displayedCharge, setDisplayedCharge] = useState(player.skillCharge)
  // Phase I: run-persistent gold. Same trail-arrival delay as the mana
  // chips so the "+N" popup syncs with the value bump.
  const [displayedGold, setDisplayedGold] = useState(player.gold)
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
          } else if (color === 'gold') {
            // No cap on gold; the chip just climbs. Spending at shops
            // decrements the store; the gold-source-of-truth effect
            // below picks that up.
            setDisplayedGold((g) => g + amount)
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
              // Suppress the red screen-edge vignette when the hit
              // carries a status rider — the per-status orange (or
              // future hue) vignette fires from the follow-up
              // status-applied event and owns the screen tint for
              // those hits. Without this gate, both `vignette-damage`
              // and `vignette-status-apply` would target body::before
              // in the same beat and clash on the CSS cascade.
              if (event.onHitRider == null) {
                document.body.classList.add('vignette-damage')
                window.setTimeout(
                  () => document.body.classList.remove('vignette-damage'),
                  500,
                )
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
        // The intermediate value (e.g. "5 Burn") was visible for ~5ms
        // before being overwritten by the tick's `remaining` (e.g.
        // "4 Burn"), so the player saw chip 3 → 4 with a `−5` popup
        // and no visible "+2 applied" beat. Now the chip reflects the
        // new value at event time; the trail particles spawned by
        // AC.spawnStatusTrail are decorative confirmation flying
        // toward an already-updated chip.
        setDisplayedStatuses((prev) => applyStatusToList(prev, event.status))
        // Per-status screen-edge tint. Fires on every player-targeted
        // status apply EXCEPT self-cast (player initiated, no need to
        // signal "something happened to me"). The schedule mirrors the
        // audio path in bindings.ts: enemy-source applies have no trail
        // (AC suppresses), so the vignette fires at event time and
        // syncs with the damage impact; every other source has a trail
        // in flight, so the vignette rides TRAIL_ARRIVAL_MS and lands
        // with the particles on the chip.
        const applySource = event.source
        if (applySource?.kind !== 'player') {
          const fire = () => {
            document.body.style.setProperty(
              '--vignette-rgb',
              STATUS_VIGNETTE_RGB[event.status.kind],
            )
            document.body.classList.add('vignette-status-apply')
            window.setTimeout(
              () => document.body.classList.remove('vignette-status-apply'),
              STATUS_VIGNETTE_MS,
            )
          }
          if (applySource && applySource.kind !== 'enemy') {
            window.setTimeout(fire, TRAIL_ARRIVAL_MS)
          } else {
            fire()
          }
        }
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
  // bump it).
  // Snap displayedGold whenever the store-side total changes outside
  // the in-fight cascade pathway — reward-pick / shop spending happen
  // off the animation stream, so without this the chip would lag until
  // the next fight starts and fightCounter resyncs the rest of the
  // HUD. In-fight pool-gained events are still animation-driven via
  // the subscriber above; the cascade processor's synchronous
  // player.gold update lands a few frames before the trail arrives,
  // but the bump function below uses a (g) => g + amount closure so
  // it commutes with this snap.
  useEffect(() => {
    let prevRunPhase = useGameStore.getState().runPhase
    return useGameStore.subscribe((s) => {
      const phase = s.runPhase
      // Snap on runPhase transitions (covers reward-pick / shop exit)
      // even when the gold delta is zero — keeps the chip honest.
      if (phase !== prevRunPhase && phase !== 'fight') {
        setDisplayedGold(s.fight.player.gold)
      }
      prevRunPhase = phase
    })
  }, [])

  useEffect(() => {
    let prevFightCounter = useGameStore.getState().fightCounter
    return useGameStore.subscribe((s) => {
      if (s.fightCounter === prevFightCounter) return
      prevFightCounter = s.fightCounter
      const p = s.fight.player
      setDisplayedHp(p.hp)
      setDisplayedMana(p.mana)
      setDisplayedCharge(p.skillCharge)
      setDisplayedGold(p.gold)
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
      const el = document.querySelector('.game-scene')
      el?.classList.remove('shake')
    }
  }, [])

  return {
    displayedHp,
    displayedMana,
    displayedCharge,
    displayedGold,
    stagedBlue,
    blockCommitted,
    displayedStatuses,
    statusTickMarks,
    statusCueMarks,
    expiringStatusKinds,
    pulse,
    hpGlow,
    hpHit,
    hpBurnHit,
    blockPulse,
  }
}
