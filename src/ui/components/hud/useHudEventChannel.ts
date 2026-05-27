import { useEffect, useRef, useState } from 'react'
import { useGameStore } from '../../../core/state/store'
import { subscribeGameEvents } from '../../../core/events/emitter'
import {
  applyStatusToList,
  statusKindFromDamageSource,
} from '../../../core/combat/statuses'
import { SPEND_TRAIL_ARRIVAL_MS, TRAIL_ARRIVAL_MS } from '../../../timing'
import { eventHudDelayMs } from '../../eventTiming'
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
const SPEND_PULSE_MS = 480

const STATUS_VIGNETTE_RGB: Record<StatusKind, string> = {
  burn: '255, 133, 64',
  vulnerable: '208, 130, 60',
  weak: '170, 184, 107',
  regen: '120, 200, 140',
  strength: '255, 200, 100',
}
const STATUS_VIGNETTE_MS = 540

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
  spendPulse: Record<GemColor, number>
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
  const [statusTickMarks, setStatusTickMarks] = useState<
    Partial<Record<StatusKind, number>>
  >({})
  const [statusCueMarks, setStatusCueMarks] = useState<
    Partial<Record<StatusKind, number>>
  >({})
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
  const [spendPulse, setSpendPulse] = useState<Record<GemColor, number>>({
    red: 0,
    blue: 0,
    green: 0,
    yellow: 0,
    purple: 0,
    gold: 0,
  })
  const bumpSpendPulse = (colors: GemColor[]) => {
    for (const color of colors) {
      setSpendPulse((prev) => ({ ...prev, [color]: prev[color] + 1 }))
      window.setTimeout(() => {
        setSpendPulse((prev) => ({
          ...prev,
          [color]: Math.max(0, prev[color] - 1),
        }))
      }, SPEND_PULSE_MS)
    }
  }
  const shakeTimerRef = useRef<number | null>(null)
  const triggerShake = (magnitude: number, durationMs: number) => {
    const el = document.querySelector('.game-scene') as HTMLElement | null
    if (!el) return
    if (shakeTimerRef.current !== null) {
      window.clearTimeout(shakeTimerRef.current)
    }
    el.style.setProperty('--shake-mag', String(magnitude))
    el.style.setProperty('--shake-dur', `${durationMs}ms`)
    // remove → reflow → add restarts keyframe even when shakes overlap
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
  const [hpBurnHit, setHpBurnHit] = useState(false)

  const [displayedHp, setDisplayedHp] = useState(player.hp)
  const [displayedMana, setDisplayedMana] = useState(player.mana)
  const displayedManaRef = useRef(player.mana)
  displayedManaRef.current = displayedMana
  const [displayedCharge, setDisplayedCharge] = useState(player.skillCharge)
  const [displayedGold, setDisplayedGold] = useState(player.gold)
  const [stagedBlue, setStagedBlue] = useState(player.block)
  const [blockCommitted, setBlockCommitted] = useState(player.block > 0)

  useEffect(() => {
    const unsub = subscribeGameEvents((event) => {
      if (event.kind === 'pool-gained') {
        const color = event.color
        const amount = event.amount
        window.setTimeout(() => {
          setPulse((prev) => ({ ...prev, [color]: prev[color] + 1 }))
          window.setTimeout(() => {
            setPulse((prev) => ({ ...prev, [color]: Math.max(0, prev[color] - 1) }))
          }, PULSE_MS)
          if (color === 'purple') setDisplayedCharge((c) => c + amount)
          else if (color === 'red' || color === 'blue' || color === 'green' || color === 'yellow') {
            setDisplayedMana((m) => ({
              ...m,
              [color]: Math.min(MANA_CAPS[color], m[color] + amount),
            }))
          } else if (color === 'gold') {
            setDisplayedGold((g) => g + amount)
          }
          if (color === 'blue') setStagedBlue((s) => s + amount)
        }, TRAIL_ARRIVAL_MS)
      } else if (event.kind === 'block-gained') {
        const delay = eventHudDelayMs(event, 0)
        const apply = () => {
          setStagedBlue(event.amount)
          setBlockCommitted(true)
        }
        if (delay > 0) window.setTimeout(apply, delay)
        else apply()
      } else if (event.kind === 'healed') {
        const amount = event.amount
        const delay = eventHudDelayMs(event, TRAIL_ARRIVAL_MS)
        window.setTimeout(() => {
          setDisplayedHp((h) =>
            Math.min(
              useGameStore.getState().fight.player.maxHp,
              h + amount,
            ),
          )
        }, delay)
      } else if (event.kind === 'damage-taken') {
        const proc = statusKindFromDamageSource(event.source)
        const isProc = proc !== null
        if (isProc && proc && (event.amount > 0 || event.blocked > 0)) {
          const procKind = proc
          setStatusCueMarks((prev) => ({
            ...prev,
            [procKind]: (prev[procKind] ?? 0) + 1,
          }))
        }
        const delay =
          isProc && (event.amount > 0 || event.blocked > 0)
            ? TRAIL_ARRIVAL_MS
            : 0
        const amount = event.amount
        const blocked = event.blocked
        const apply = () => {
          setDisplayedHp((h) => Math.max(0, h - amount))
          setStagedBlue((s) => Math.max(0, s - blocked))
          if (amount > 0) {
            if (isProc) {
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
              // Skip vignette-damage when a status rider fires its own vignette
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
        const spentColors = event.spentColors
        window.setTimeout(() => {
          bumpSpendPulse(spentColors)
          if (isUltimateId(event.spellId)) {
            const cost = getUltimate(event.spellId).chargeCost
            setDisplayedCharge((c) => Math.max(0, c - cost))
          } else {
            const cost = getSpell(event.spellId).cost
            setDisplayedMana((m) => consumeSpellCost(m, cost))
          }
        }, SPEND_TRAIL_ARRIVAL_MS)
      } else if (event.kind === 'phase-changed') {
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
        const dur = 280 + Math.round(Math.min(event.magnitude, 2) * 140)
        triggerShake(event.magnitude, dur)
      }
      if (event.kind === 'healed') {
        const glowDelay = eventHudDelayMs(event, 0)
        window.setTimeout(() => {
          setHpGlow(true)
          window.setTimeout(() => setHpGlow(false), 500)
        }, glowDelay)
      } else if (event.kind === 'block-gained') {
        const pulseDelay = eventHudDelayMs(event, 0)
        window.setTimeout(() => {
          setBlockPulse(true)
          window.setTimeout(() => setBlockPulse(false), 500)
        }, pulseDelay)
      } else if (event.kind === 'status-applied' && event.target === 'player') {
        const defaultDelay =
          event.source?.kind === 'board-cells' ? TRAIL_ARRIVAL_MS : 0
        const delay = eventHudDelayMs(event, defaultDelay)
        const apply = () => {
          setDisplayedStatuses((prev) => applyStatusToList(prev, event.status))
        }
        if (delay > 0) window.setTimeout(apply, delay)
        else apply()
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
            window.setTimeout(fire, eventHudDelayMs(event, TRAIL_ARRIVAL_MS))
          } else {
            fire()
          }
        }
      } else if (event.kind === 'status-ticked' && event.target === 'player') {
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
        const { statusKind } = event
        const FIZZLE_MS = 480
        const baseDelay = eventHudDelayMs(event, TRAIL_ARRIVAL_MS)
        window.setTimeout(() => {
          setExpiringStatusKinds((prev) => {
            if (prev.has(statusKind)) return prev
            const next = new Set(prev)
            next.add(statusKind)
            return next
          })
        }, baseDelay)
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
        }, baseDelay + FIZZLE_MS)
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    let prevRunPhase = useGameStore.getState().runPhase
    return useGameStore.subscribe((s) => {
      const phase = s.runPhase
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
    spendPulse,
    hpGlow,
    hpHit,
    hpBurnHit,
    blockPulse,
  }
}
