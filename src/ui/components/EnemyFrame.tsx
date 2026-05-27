import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { createPortal } from 'react-dom'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { useAnimatedPhase } from '../hooks/useAnimatedPhase'
import { TRAIL_ARRIVAL_MS, scheduleAfterMs } from '../../timing'
import { readSpellVisualBeat } from '../../core/combat/spellVisual'
import { subscribeTrailScheduled } from '../../trails/sync'
import type { Enemy, Intent, StatusInstance, StatusKind } from '../../types'
import { applyStatusToList, statusKindFromDamageSource } from '../../core/combat/statuses'
import { getStatusDef } from '../../content/statuses'
import { intentDisplay, LIFESTEAL_RIDER_ICON } from '../../content/intentDisplays'
import { enemyPassiveTraitHint } from '../../content/enemyTraits'
import { getArchetype } from '../../core/combat/archetypeRegistry'
import { Keyword } from './Keyword'
import { StatusBar } from './StatusBar'
import { setHoveredEnemy } from '../state/hoveredEnemy'
import { getHoveredCell, subscribeHoveredCell } from '../../core/state/hoveredCell'
import { shoveHueFor } from '../../core/combat/shoveHues'
import { useTooltipFade } from '../useTooltipFade'
import { useTooltipReveal } from '../useTooltipReveal'
import { useTooltipTouchAnchor } from '../useTooltipTouchAnchor'

const HIT_FLASH_MS = 280
// Must match the longest .firing-* animation in index.css
const INTENT_FIRE_MS = 460
const KILL_PULSE_MS = 720
const HEAL_PULSE_MS = 520

/** Enrage badge tracks displayed HP, not store HP (store commits before trail/particle FX). */
function showsEnragedBadge(enemy: Enemy, shownHp: number): boolean {
  if (!enemy.enraged || shownHp <= 0) return false
  const def = getArchetype(enemy.archetype)
  if (!def.enragePattern) return false
  const threshold = def.enrageThreshold ?? 0.5
  return shownHp / enemy.maxHp <= threshold
}

export function EnemyFrame() {
  const enemies = useGameStore((s) => s.fight.enemies)
  const targetId = useGameStore((s) => s.fight.targetEnemyId)
  const setTargetEnemy = useGameStore((s) => s.setTargetEnemy)
  const fightPhase = useGameStore((s) => s.fight.phase)
  const fightCounter = useGameStore((s) => s.fightCounter)
  const isElite = useGameStore((s) => s.fight.isElite === true)
  const playerHp = useGameStore((s) => s.fight.player.hp)
  const playerBlock = useGameStore((s) => s.fight.player.block)
  const animatedPhase = useAnimatedPhase()
  const hoveredCell = useSyncExternalStore(subscribeHoveredCell, getHoveredCell)

  const [displayedHp, setDisplayedHp] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {}
    for (const e of enemies) out[e.id] = e.hp
    return out
  })
  const [firedIntent, setFiredIntent] = useState<Record<string, boolean>>({})

  const [displayedIntent, setDisplayedIntent] = useState<Record<string, Intent>>(() => {
    const out: Record<string, Intent> = {}
    for (const e of enemies) out[e.id] = e.currentIntent
    return out
  })

  const [displayedBlock, setDisplayedBlock] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {}
    for (const e of enemies) out[e.id] = e.block
    return out
  })

  const [displayedStatuses, setDisplayedStatuses] = useState<Record<string, StatusInstance[]>>(
    () => {
      const out: Record<string, StatusInstance[]> = {}
      for (const e of enemies) out[e.id] = e.statuses
      return out
    },
  )
  const [statusTickMarks, setStatusTickMarks] = useState<
    Record<string, Partial<Record<StatusKind, number>>>
  >({})
  const [statusCueMarks, setStatusCueMarks] = useState<
    Record<string, Partial<Record<StatusKind, number>>>
  >({})
  const [expiringStatusKinds, setExpiringStatusKinds] = useState<Record<string, Set<StatusKind>>>(
    {},
  )

  const [flashing, setFlashing] = useState<Record<string, number>>({})
  const [trailPulse, setTrailPulse] = useState<Record<string, number>>({})
  const [killedPulse, setKilledPulse] = useState<Record<string, number>>({})
  const [staggered, setStaggered] = useState<Record<string, number>>({})
  const [healing, setHealing] = useState<Record<string, number>>({})
  const [intentFiring, setIntentFiring] = useState<
    Record<string, { count: number; kind: 'attack' | 'block' }>
  >({})
  const [intentTick, setIntentTick] = useState<Record<string, number>>({})

  const pendingEnemyDamageRef = useRef<
    Record<string, { amount: number; blocked: number; isProc: boolean } | undefined>
  >({})
  const pendingEnemyTickRef = useRef<
    Record<string, { statusKind: StatusKind; remaining: number } | undefined>
  >({})
  const pendingEnemyStatusApplyRef = useRef<Record<string, StatusInstance | undefined>>({})

  const applyEnemyHeal = (id: string, amount: number) => {
    if (amount <= 0) return
    const storeEnemy = useGameStore.getState().fight.enemies.find((e) => e.id === id)
    if (storeEnemy) {
      setDisplayedHp((prev) => ({ ...prev, [id]: storeEnemy.hp }))
    }
    setHealing((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
    window.setTimeout(() => {
      setHealing((prev) => ({
        ...prev,
        [id]: Math.max(0, (prev[id] ?? 0) - 1),
      }))
    }, HEAL_PULSE_MS)
  }

  const applyEnemyDamage = (id: string, amount: number, blocked: number) => {
    setDisplayedHp((prev) => {
      const before = prev[id] ?? 0
      const after = Math.max(0, before - amount)
      if (before > 0 && after === 0) {
        setKilledPulse((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }))
        window.setTimeout(() => {
          setKilledPulse((p) => ({
            ...p,
            [id]: Math.max(0, (p[id] ?? 0) - 1),
          }))
        }, KILL_PULSE_MS)
      }
      return { ...prev, [id]: after }
    })
    setFlashing((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
    window.setTimeout(() => {
      setFlashing((prev) => ({
        ...prev,
        [id]: Math.max(0, (prev[id] ?? 0) - 1),
      }))
    }, HIT_FLASH_MS)
    if (blocked > 0) {
      setDisplayedBlock((prev) => ({
        ...prev,
        [id]: Math.max(0, (prev[id] ?? 0) - blocked),
      }))
    }
  }

  useEffect(() => {
    const unsubTrail = subscribeTrailScheduled((trail) => {
      if (
        trail.purpose === 'pool-earn' &&
        trail.color === 'red' &&
        (trail.earnDest === 'effect' || trail.earnDest === undefined)
      ) {
        const id = useGameStore.getState().fight.targetEnemyId
        if (!id) return
        scheduleAfterMs(() => {
          setTrailPulse((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
          window.setTimeout(() => {
            setTrailPulse((prev) => ({
              ...prev,
              [id]: Math.max(0, (prev[id] ?? 0) - 1),
            }))
          }, 380)
        }, trail.arrivalMs)
        return
      }
      if (
        trail.purpose === 'status-proc' &&
        trail.target &&
        trail.target !== 'player' &&
        trail.procFacet === 'damage'
      ) {
        const id = trail.target
        scheduleAfterMs(() => {
          const pending = pendingEnemyDamageRef.current[id]
          if (pending) {
            delete pendingEnemyDamageRef.current[id]
            applyEnemyDamage(id, pending.amount, pending.blocked)
          }
          const tick = pendingEnemyTickRef.current[id]
          if (tick) {
            delete pendingEnemyTickRef.current[id]
            setDisplayedStatuses((prev) => ({
              ...prev,
              [id]: (prev[id] ?? []).map((s) =>
                s.kind === tick.statusKind ? { ...s, stacks: tick.remaining } : s,
              ),
            }))
            setStatusTickMarks((prev) => ({
              ...prev,
              [id]: {
                ...(prev[id] ?? {}),
                [tick.statusKind]: (prev[id]?.[tick.statusKind] ?? 0) + 1,
              },
            }))
          }
        }, trail.arrivalMs)
        return
      }
      if (
        trail.purpose === 'status-proc' &&
        trail.target &&
        trail.target !== 'player' &&
        trail.procFacet === 'block'
      ) {
        const id = trail.target
        scheduleAfterMs(() => {
          const pending = pendingEnemyDamageRef.current[id]
          if (pending) {
            delete pendingEnemyDamageRef.current[id]
            if (pending.blocked > 0) {
              setDisplayedBlock((prev) => ({
                ...prev,
                [id]: Math.max(0, (prev[id] ?? 0) - pending.blocked),
              }))
            }
          }
        }, trail.arrivalMs)
        return
      }
      if (trail.purpose === 'status-apply' && trail.target && trail.target !== 'player') {
        const id = trail.target
        scheduleAfterMs(() => {
          const incoming = pendingEnemyStatusApplyRef.current[id]
          delete pendingEnemyStatusApplyRef.current[id]
          if (!incoming) return
          setDisplayedStatuses((prev) => ({
            ...prev,
            [id]: applyStatusToList(prev[id] ?? [], incoming),
          }))
        }, trail.arrivalMs)
        return
      }
      if (trail.purpose === 'spell-effect' && trail.target && trail.target !== 'player') {
        const id = trail.target
        scheduleAfterMs(() => {
          if (trail.slot === 'hp' || trail.slot === undefined) {
            const pending = pendingEnemyDamageRef.current[id]
            if (pending) {
              delete pendingEnemyDamageRef.current[id]
              applyEnemyDamage(id, pending.amount, pending.blocked)
            }
          }
          if (trail.slot === 'status') {
            const incoming = pendingEnemyStatusApplyRef.current[id]
            delete pendingEnemyStatusApplyRef.current[id]
            if (!incoming) return
            setDisplayedStatuses((prev) => ({
              ...prev,
              [id]: applyStatusToList(prev[id] ?? [], incoming),
            }))
          }
        }, trail.arrivalMs)
      }
    })

    const unsub = subscribeGameEvents((event) => {
      if (event.kind === 'damage-dealt') {
        const id = event.targetId
        const amount = event.amount
        const isPlayerAttack = event.source === 'player-attack'
        const procKind = statusKindFromDamageSource(event.source)
        if (procKind && amount > 0) {
          const pk = procKind
          setStatusCueMarks((prev) => ({
            ...prev,
            [id]: {
              ...(prev[id] ?? {}),
              [pk]: ((prev[id] ?? {})[pk] ?? 0) + 1,
            },
          }))
        }
        if (procKind) {
          pendingEnemyDamageRef.current[id] = {
            amount,
            blocked: event.blocked,
            isProc: true,
          }
        } else if (isPlayerAttack && readSpellVisualBeat(event)) {
          pendingEnemyDamageRef.current[id] = {
            amount,
            blocked: event.blocked,
            isProc: false,
          }
        } else if (isPlayerAttack) {
          window.setTimeout(() => applyEnemyDamage(id, amount, event.blocked), TRAIL_ARRIVAL_MS)
        } else {
          applyEnemyDamage(id, amount, event.blocked)
        }
      } else if (event.kind === 'pool-gained' && event.color === 'red') {
        // Red pool trail pulse syncs via trail-scheduled.
      } else if (event.kind === 'damage-taken' && event.source === 'enemy-attack') {
        const id = event.attackerId ?? useGameStore.getState().fight.targetEnemyId
        if (id) bumpIntentFiring(setIntentFiring, id, 'attack')
      } else if (event.kind === 'enemy-block-gained') {
        bumpIntentFiring(setIntentFiring, event.enemyId, 'block')
        setDisplayedBlock((prev) => ({
          ...prev,
          [event.enemyId]: (prev[event.enemyId] ?? 0) + event.amount,
        }))
      } else if (event.kind === 'enemy-staggered') {
        const id = event.enemyId
        setStaggered((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
        window.setTimeout(() => {
          setStaggered((prev) => ({
            ...prev,
            [id]: Math.max(0, (prev[id] ?? 0) - 1),
          }))
        }, 520)
      } else if (event.kind === 'ally-healed') {
        applyEnemyHeal(event.targetId, event.amount)
      } else if (event.kind === 'drain-triggered') {
        applyEnemyHeal(event.enemyId, event.healAmount)
      } else if (event.kind === 'intent-telegraphed') {
        setDisplayedIntent((prev) => ({ ...prev, [event.enemyId]: event.intent }))
        setIntentTick((prev) => ({
          ...prev,
          [event.enemyId]: (prev[event.enemyId] ?? 0) + 1,
        }))
        setFiredIntent((prev) => {
          if (!prev[event.enemyId]) return prev
          const next = { ...prev }
          delete next[event.enemyId]
          return next
        })
      } else if (event.kind === 'enemy-acted') {
        setFiredIntent((prev) => ({ ...prev, [event.enemyId]: true }))
      } else if (event.kind === 'phase-changed' && event.phase === 'enemy-acting') {
        setFiredIntent({})
      } else if (event.kind === 'status-applied' && event.target !== 'player') {
        const enemyId = event.target
        const incoming = event.status
        if (readSpellVisualBeat(event)) {
          pendingEnemyStatusApplyRef.current[enemyId] = incoming
        } else if (event.source?.kind === 'enemy') {
          setDisplayedStatuses((prev) => ({
            ...prev,
            [enemyId]: applyStatusToList(prev[enemyId] ?? [], incoming),
          }))
        } else {
          pendingEnemyStatusApplyRef.current[enemyId] = incoming
        }
      } else if (event.kind === 'status-ticked' && event.target !== 'player') {
        const enemyId = event.target
        if (event.statusKind === 'burn') {
          pendingEnemyTickRef.current[enemyId] = {
            statusKind: event.statusKind,
            remaining: event.remaining,
          }
        } else {
          const { statusKind, remaining } = event
          setDisplayedStatuses((prev) => ({
            ...prev,
            [enemyId]: (prev[enemyId] ?? []).map((s) =>
              s.kind === statusKind ? { ...s, stacks: remaining } : s,
            ),
          }))
          setStatusTickMarks((prev) => ({
            ...prev,
            [enemyId]: {
              ...(prev[enemyId] ?? {}),
              [statusKind]: (prev[enemyId]?.[statusKind] ?? 0) + 1,
            },
          }))
        }
      } else if (event.kind === 'status-expired' && event.target !== 'player') {
        const enemyId = event.target
        const { statusKind } = event
        const FIZZLE_MS = 480
        window.setTimeout(() => {
          setExpiringStatusKinds((prev) => {
            const cur = prev[enemyId] ?? new Set<StatusKind>()
            if (cur.has(statusKind)) return prev
            const next = new Set(cur)
            next.add(statusKind)
            return { ...prev, [enemyId]: next }
          })
        }, TRAIL_ARRIVAL_MS)
        window.setTimeout(() => {
          setDisplayedStatuses((prev) => ({
            ...prev,
            [enemyId]: (prev[enemyId] ?? []).filter((s) => s.kind !== statusKind),
          }))
          setExpiringStatusKinds((prev) => {
            const cur = prev[enemyId]
            if (!cur || !cur.has(statusKind)) return prev
            const next = new Set(cur)
            next.delete(statusKind)
            return { ...prev, [enemyId]: next }
          })
        }, TRAIL_ARRIVAL_MS + FIZZLE_MS)
      }
    })

    return () => {
      unsubTrail()
      unsub()
    }
  }, [])

  const [trackedFightCounter, setTrackedFightCounter] = useState(fightCounter)
  if (trackedFightCounter !== fightCounter) {
    setTrackedFightCounter(fightCounter)
    const freshHp: Record<string, number> = {}
    const freshBlock: Record<string, number> = {}
    const freshStatuses: Record<string, StatusInstance[]> = {}
    const freshIntent: Record<string, Intent> = {}
    for (const e of enemies) {
      freshHp[e.id] = e.hp
      freshBlock[e.id] = e.block
      freshStatuses[e.id] = e.statuses
      freshIntent[e.id] = e.currentIntent
    }
    setDisplayedHp(freshHp)
    setDisplayedBlock(freshBlock)
    setDisplayedStatuses(freshStatuses)
    setDisplayedIntent(freshIntent)
    setIntentTick({})
    setStatusTickMarks({})
    setStatusCueMarks({})
    setExpiringStatusKinds({})
  }

  return (
    <section className="enemy-row" aria-label="Enemies">
      {enemies.map((enemy) => {
        const shownHp = displayedHp[enemy.id] ?? enemy.hp
        const shownBlock = displayedBlock[enemy.id] ?? enemy.block
        const dead = shownHp <= 0
        const isTarget = enemy.id === targetId
        const isHit = (flashing[enemy.id] ?? 0) > 0
        const isTrailHit = (trailPulse[enemy.id] ?? 0) > 0
        const isStaggered = (staggered[enemy.id] ?? 0) > 0
        const isHealing = (healing[enemy.id] ?? 0) > 0
        const isEnraged = showsEnragedBadge(enemy, shownHp)
        const traitHint = enemyPassiveTraitHint(enemy.archetype)
        const isKilledPulse = (killedPulse[enemy.id] ?? 0) > 0
        const firingState = intentFiring[enemy.id]
        const isFiring = (firingState?.count ?? 0) > 0
        const firingKind = firingState?.kind
        const intent = displayedIntent[enemy.id] ?? enemy.currentIntent
        const lethalIntent = intent.kind === 'attack' && intent.amount > playerHp + playerBlock
        const hpPct = Math.max(0, (shownHp / enemy.maxHp) * 100)
        // Gate on store-immediate hp (not displayedHp) to avoid trails homing onto a corpse
        const poolTargetAttr = isTarget && enemy.hp > 0 ? 'red' : undefined
        const selectable = !dead && !isTarget && fightPhase === 'player-acting'
        const shoveCellHovered =
          !dead &&
          hoveredCell !== null &&
          intent.kind === 'cluster-shove' &&
          (intent.sources.some((p) => p.x === hoveredCell.x && p.y === hoveredCell.y) ||
            intent.destinations.some((p) => p.x === hoveredCell.x && p.y === hoveredCell.y))
        return (
          <div
            key={enemy.id}
            data-enemy-id={enemy.id}
            data-pool-target={poolTargetAttr}
            className={[
              'enemy-frame',
              dead ? 'dead' : '',
              isKilledPulse ? 'killed' : '',
              isTarget ? 'targeted' : '',
              selectable ? 'selectable' : '',
              isHit ? 'hit' : '',
              isTrailHit ? 'trail-pulsing' : '',
              isFiring ? `firing-${firingKind}` : '',
              isStaggered ? 'staggered' : '',
              isHealing ? 'healing' : '',
              isEnraged ? 'enraged' : '',
              shoveCellHovered ? 'shove-cell-hovered' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={`${enemy.name} ${shownHp}/${enemy.maxHp} HP${dead ? ' (defeated)' : ''}${selectable ? ' — click to target' : isTarget ? ' — current target' : ''}`}
            role={selectable ? 'button' : undefined}
            tabIndex={selectable ? 0 : undefined}
            onClick={() => {
              if (selectable) setTargetEnemy(enemy.id)
            }}
            onMouseEnter={() => setHoveredEnemy(enemy.id)}
            onMouseLeave={() => setHoveredEnemy(null)}
            onFocus={() => setHoveredEnemy(enemy.id)}
            onBlur={() => setHoveredEnemy(null)}
            onKeyDown={(e) => {
              if (!selectable) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setTargetEnemy(enemy.id)
              }
            }}
          >
            {!dead && (animatedPhase === 'player-acting' || !firedIntent[enemy.id]) && (
              <IntentBadge
                intent={intent}
                tick={intentTick[enemy.id] ?? 0}
                lethal={lethalIntent}
                enemies={enemies}
                shoveHue={intent.kind === 'cluster-shove' ? shoveHueFor(enemies, enemy.id) : null}
              />
            )}
            <div className="enemy-sprite" aria-hidden>
              <span className="enemy-glyph">{dead ? '💀' : '👹'}</span>
            </div>
            <div className="enemy-name" title={traitHint}>
              {enemy.name}
              {isEnraged && (
                <Keyword id="enrage" standalone>
                  <span className="enemy-enraged-badge">ENRAGED</span>
                </Keyword>
              )}
              {isElite && (
                <Keyword id="elite" standalone>
                  <span className="enemy-elite-badge">ELITE</span>
                </Keyword>
              )}
            </div>
            <div className="enemy-effects-row">
              <div
                className={`enemy-block-badge${!dead && shownBlock > 0 ? '' : ' empty'}`}
                title="Block"
                aria-label={!dead && shownBlock > 0 ? `Block ${shownBlock}` : undefined}
                aria-hidden={dead || shownBlock <= 0}
              >
                <span aria-hidden>🛡</span>
                <span>{shownBlock}</span>
              </div>
              <StatusBar
                statuses={dead ? [] : (displayedStatuses[enemy.id] ?? enemy.statuses)}
                tickMarks={statusTickMarks[enemy.id]}
                cueMarks={statusCueMarks[enemy.id]}
                expiringKinds={expiringStatusKinds[enemy.id]}
                className="enemy-statuses"
              />
            </div>
            <div className="enemy-hp-bar" role="img">
              <div className="enemy-hp-fill" style={{ width: `${hpPct}%` }} />
              <span className="enemy-hp-text">
                {Math.max(0, shownHp)} / {enemy.maxHp}
              </span>
            </div>
          </div>
        )
      })}
    </section>
  )
}

function IntentBadge({
  intent,
  tick,
  lethal,
  enemies,
  shoveHue,
}: {
  intent: Intent
  tick: number
  lethal: boolean
  enemies: Enemy[]
  shoveHue: number | null
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const { mounted: tipMounted, visible: tipVisible } = useTooltipFade(hovered)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const displayPos = tipMounted ? pos : null
  const tipRevealed = useTooltipReveal(displayPos !== null, tipVisible)

  useTooltipTouchAnchor(hovered, setHovered, anchorRef, tipRef)

  useLayoutEffect(() => {
    if (!tipMounted) return
    const compute = () => {
      const a = anchorRef.current?.getBoundingClientRect()
      const t = tipRef.current?.getBoundingClientRect()
      if (!a || !t) return
      const margin = 8
      const wantsBelow = a.top - margin - t.height < margin
      const top = wantsBelow ? a.bottom + margin : a.top - margin - t.height
      let left = a.left + a.width / 2 - t.width / 2
      left = Math.max(margin, Math.min(window.innerWidth - t.width - margin, left))
      setPos({ left, top })
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [tipMounted])

  const allyTargetId =
    intent.kind === 'heal-ally' || intent.kind === 'buff-ally' || intent.kind === 'shield-ally'
      ? intent.targetAllyId
      : null
  const allyTargetName = allyTargetId
    ? (enemies.find((e) => e.id === allyTargetId)?.name ?? '?')
    : null

  const display = intentDisplay(intent)

  return (
    <>
      <div
        ref={anchorRef}
        key={`${intent.kind}-${display.number ?? 'x'}-${tick}`}
        className={`enemy-intent intent-${intent.kind}${lethal ? ' lethal' : ''}`}
        style={
          shoveHue !== null ? ({ ['--shove-hue']: String(shoveHue) } as CSSProperties) : undefined
        }
        role="img"
        aria-label={`${display.label}${allyTargetName ? ` → ${allyTargetName}` : ''}${lethal ? ' — lethal!' : ''}`}
        tabIndex={0}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        <span className="intent-icon" aria-hidden>
          {display.icon}
        </span>
        {display.number !== undefined && <span className="intent-amount">{display.number}</span>}
        {intent.kind === 'attack' && intent.onHit && (
          <span className={`intent-rider rider-${intent.onHit.status}`} aria-hidden>
            {getStatusDef(intent.onHit.status).icon}
            <span className="intent-rider-amount">{intent.onHit.stacks}</span>
          </span>
        )}
        {intent.kind === 'attack' && intent.lifesteal != null && intent.lifesteal > 0 && (
          <span className="intent-rider rider-lifesteal" aria-hidden title="Lifesteal">
            <span className="intent-rider-icon">{LIFESTEAL_RIDER_ICON}</span>
          </span>
        )}
        {allyTargetName && (
          <>
            <span className="intent-ally-arrow" aria-hidden>
              ➜
            </span>
            <span className="intent-ally-target" aria-hidden title={allyTargetName}>
              {allyTargetName}
            </span>
          </>
        )}
      </div>
      {tipMounted &&
        createPortal(
          <div
            ref={tipRef}
            className={`intent-tooltip intent-${intent.kind}${tipRevealed ? ' is-visible' : ''}`}
            role="tooltip"
            style={{
              left: displayPos?.left ?? 0,
              top: displayPos?.top ?? 0,
            }}
          >
            <div className="intent-tooltip-title">{display.label}</div>
            <div className="intent-tooltip-body">{display.description}</div>
          </div>,
          document.body,
        )}
    </>
  )
}

function bumpIntentFiring(
  setter: Dispatch<SetStateAction<Record<string, { count: number; kind: 'attack' | 'block' }>>>,
  id: string,
  kind: 'attack' | 'block',
): void {
  setter((prev) => ({
    ...prev,
    [id]: { count: (prev[id]?.count ?? 0) + 1, kind },
  }))
  window.setTimeout(() => {
    setter((prev) => {
      const entry = prev[id]
      if (!entry) return prev
      return {
        ...prev,
        [id]: { count: Math.max(0, entry.count - 1), kind: entry.kind },
      }
    })
  }, INTENT_FIRE_MS)
}
