import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { createPortal } from 'react-dom'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { useAnimatedPhase } from '../hooks/useAnimatedPhase'
import { TRAIL_ARRIVAL_MS, scheduleAtTrailArrival } from '../../timing'
import type { Enemy, Intent, StatusInstance, StatusKind } from '../../types'
import {
  applyStatusToList,
  statusKindFromDamageSource,
} from '../../core/combat/statuses'
import { getStatusDef } from '../../content/statuses'
import { intentDisplay } from '../../content/intentDisplays'
import { StatusBar } from './StatusBar'

const HIT_FLASH_MS = 280
// Must match (or slightly outlast) the longest .firing-* animation in
// index.css — currently enemy-firing-attack at 460ms.
const INTENT_FIRE_MS = 460
// Death pulse duration — long enough to read the scale-flash arc, short
// enough to settle into the static .dead state before the next event.
const KILL_PULSE_MS = 720

// Intent badge / tooltip data now lives in src/content/intentDisplays.tsx
// (icon, badge number, label, description as a single switch dispatched
// from `intentDisplay(intent)`). Adding a new IntentKind means one new
// case there, not four parallel branches here.

export function EnemyFrame() {
  const enemies = useGameStore((s) => s.fight.enemies)
  const targetId = useGameStore((s) => s.fight.targetEnemyId)
  const setTargetEnemy = useGameStore((s) => s.setTargetEnemy)
  const fightPhase = useGameStore((s) => s.fight.phase)
  const fightCounter = useGameStore((s) => s.fightCounter)
  // Drive the lethal-intent warning. Store values (not HUD's display-timed
  // ones) — intent only shows during player-acting, when they're settled.
  const playerHp = useGameStore((s) => s.fight.player.hp)
  const playerBlock = useGameStore((s) => s.fight.player.block)
  const animatedPhase = useAnimatedPhase()

  // Displayed HP per enemy, mirrored event-driven so the bar drains on
  // `damage-dealt` (animation-timed) instead of snapping when the store
  // finalises the whole turn synchronously at swap commit time.
  const [displayedHp, setDisplayedHp] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {}
    for (const e of enemies) out[e.id] = e.hp
    return out
  })
  // The badge belongs to the *player phase that's about to end* — it tells
  // the player "this is what the enemy will do." Once the enemy starts
  // acting (animated phase = enemy-acting) we hide it; the firing pulse on
  // the enemy frame represents the intent resolving.
  const showIntent = animatedPhase === 'player-acting'

  // Displayed intent lags the store: it only updates when intent-telegraphed
  // plays (after the enemy has visibly resolved the previous one).
  const [displayedIntent, setDisplayedIntent] = useState<Record<string, Intent>>(() => {
    const out: Record<string, Intent> = {}
    for (const e of enemies) out[e.id] = e.currentIntent
    return out
  })

  // Displayed block lags the store too. executeEnemyTurn pre-applies the
  // next block intent at telegraph time, so `enemy.block` jumps the moment
  // the swap commits — long before the shield pulse + intent badge play.
  // Mirror it event-driven instead: bump on enemy-block-gained (sync with
  // the firing-block pulse) and drain on player-attack damage-dealt at
  // trail arrival (sync with displayedHp).
  const [displayedBlock, setDisplayedBlock] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {}
    for (const e of enemies) out[e.id] = e.block
    return out
  })

  // Per-enemy status chips, animation-timed. Same store/animation race
  // as the player side — if we read enemy.statuses straight from the
  // store, a status applied at swap commit pops the icon before its
  // particles have even left the caster.
  const [displayedStatuses, setDisplayedStatuses] = useState<
    Record<string, StatusInstance[]>
  >(() => {
    const out: Record<string, StatusInstance[]> = {}
    for (const e of enemies) out[e.id] = e.statuses
    return out
  })
  // Bumps per (enemyId, statusKind) on every tick — used as a React key
  // so the chip's "-1" popup re-mounts and replays its keyframe.
  const [statusTickMarks, setStatusTickMarks] = useState<
    Record<string, Partial<Record<StatusKind, number>>>
  >({})
  // Parallel pre-impact "wind up" cue bumps; fires when this enemy's
  // status is about to deal proc damage. Pulses the chip just as the
  // chip→frame trail launches.
  const [statusCueMarks, setStatusCueMarks] = useState<
    Record<string, Partial<Record<StatusKind, number>>>
  >({})
  // Per-enemy fizzle window — chips remain in displayedStatuses for an
  // extra ~480ms past status-expired so the goodbye flash + fade can
  // play on the chip itself. Cleared once the fizzle finishes.
  const [expiringStatusKinds, setExpiringStatusKinds] = useState<
    Record<string, Set<StatusKind>>
  >({})

  const [flashing, setFlashing] = useState<Record<string, number>>({})
  // Red trail arrival → brief "incoming damage" pulse on the targeted enemy.
  // Cleared by id so the pulse stops if the player switches targets mid-phase.
  const [trailPulse, setTrailPulse] = useState<Record<string, number>>({})
  // Scale+flash CSS transition into the dead state. Triggered when
  // displayedHp hits zero, in sync with the death burst.
  const [killedPulse, setKilledPulse] = useState<Record<string, number>>({})
  // Stagger pulse: the enemy's shield was broken and their turn is spent
  // recovering. Drives the .staggered CSS recoil animation on the frame.
  const [staggered, setStaggered] = useState<Record<string, number>>({})
  // "Intent firing" tracks which enemy is currently visibly resolving its
  // intent and whether that intent is attack or block (so the CSS can play
  // the right pulse — the intent badge is already hidden by this point).
  const [intentFiring, setIntentFiring] = useState<
    Record<string, { count: number; kind: 'attack' | 'block' }>
  >({})
  // Bump on intent-telegraphed → triggers a "new intent" pop-in animation.
  const [intentTick, setIntentTick] = useState<Record<string, number>>({})

  useEffect(() => {
    const unsub = subscribeGameEvents((event) => {
      if (event.kind === 'damage-dealt') {
        const id = event.targetId
        const amount = event.amount
        const isPlayerAttack = event.source === 'player-attack'
        const procKind = statusKindFromDamageSource(event.source)
        // Status-proc damage on this enemy: bump the chip's pre-impact
        // cue immediately so the chip pulses as the trail launches,
        // not when it arrives.
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
        // Both player-attack hits (red gem trail) and status-proc hits
        // (chip → enemy trail) need to delay the bar drain so it lands
        // when the particles arrive. Everything else is immediate.
        const delay = isPlayerAttack || procKind ? TRAIL_ARRIVAL_MS : 0
        window.setTimeout(() => {
          setDisplayedHp((prev) => {
            const before = prev[id] ?? 0
            const after = Math.max(0, before - amount)
            // Kill transition (alive → 0): fire the .killed pulse in sync
            // with the death burst (both land at trail arrival).
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
          if (event.blocked > 0) {
            setDisplayedBlock((prev) => ({
              ...prev,
              [id]: Math.max(0, (prev[id] ?? 0) - event.blocked),
            }))
          }
        }, delay)
      } else if (event.kind === 'pool-gained' && event.color === 'red') {
        // Brief outline pulse when the trail lands. Damage popup itself
        // comes from the per-match damage-dealt event.
        const id = useGameStore.getState().fight.targetEnemyId
        if (!id) return
        scheduleAtTrailArrival(() => {
          setTrailPulse((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
          window.setTimeout(() => {
            setTrailPulse((prev) => ({
              ...prev,
              [id]: Math.max(0, (prev[id] ?? 0) - 1),
            }))
          }, 380)
        })
      } else if (event.kind === 'damage-taken' && event.source === 'enemy-attack') {
        // Enemy's attack landed — pulse the actual attacker (multi-enemy
        // safe). Fall back to targetEnemyId only if the event omitted the
        // attackerId (older payloads / non-attack sources).
        const id =
          event.attackerId ?? useGameStore.getState().fight.targetEnemyId
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
      } else if (event.kind === 'intent-telegraphed') {
        setDisplayedIntent((prev) => ({ ...prev, [event.enemyId]: event.intent }))
        setIntentTick((prev) => ({
          ...prev,
          [event.enemyId]: (prev[event.enemyId] ?? 0) + 1,
        }))
      } else if (event.kind === 'status-applied' && event.target !== 'player') {
        // Apply IMMEDIATELY at event time. Was delayed by
        // TRAIL_ARRIVAL_MS to sync with the particle trail; that delay
        // let a follow-up status-ticked race the apply at +700ms and
        // skip the intermediate value (player saw chip jump from N to
        // N+M-1 with a popup of N+M, instead of N → N+M → N+M-1).
        // Trail particles spawned by AnimationController are decorative
        // confirmation now — the chip is the authoritative state.
        const enemyId = event.target
        const incoming = event.status
        setDisplayedStatuses((prev) => ({
          ...prev,
          [enemyId]: applyStatusToList(prev[enemyId] ?? [], incoming),
        }))
      } else if (event.kind === 'status-ticked' && event.target !== 'player') {
        // Delay by TRAIL_ARRIVAL_MS so the chip number drops AFTER the
        // tick's chip→target particle lands (otherwise the chip ticks
        // 3→2 while the hit-for-3 is still in flight). Bump the tick
        // marker so StatusBar replays the "-1" popup animation.
        const enemyId = event.target
        const { statusKind, remaining } = event
        window.setTimeout(() => {
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
        }, TRAIL_ARRIVAL_MS)
      } else if (event.kind === 'status-expired' && event.target !== 'player') {
        // Goodbye flash + fade on the enemy chip when its final tick
        // lands. Sequence mirrors HUD.tsx player-side:
        //   t = +TRAIL_ARRIVAL_MS         → mark chip as expiring; the
        //                                    `is-expiring` CSS class plays
        //                                    a ~480ms flash-and-fade.
        //   t = +TRAIL_ARRIVAL_MS + FIZZLE → filter the chip out of
        //                                    displayedStatuses.
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
            [enemyId]: (prev[enemyId] ?? []).filter(
              (s) => s.kind !== statusKind,
            ),
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
    return unsub
  }, [])

  // Hard-resync displayed HP on fight reset (new fight via reward,
  // skip, or restart — fightCounter bumps in all three). Done as a
  // render-phase update so the fresh values are in place during the
  // SAME render that picks up the new enemies — a useEffect-based
  // resync paints once with stale entries (e.g. displayedHp[enemy-1]=0
  // from a previous fight's death) and the intent badge / dead class
  // flicker through that stale frame before correcting.
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
        // Use the *displayed* HP for the dead-vs-alive visual so the
        // skull/intent-hide flips in sync with the bar drain, not at
        // store-commit time.
        const dead = shownHp <= 0
        const isTarget = enemy.id === targetId
        const isHit = (flashing[enemy.id] ?? 0) > 0
        const isTrailHit = (trailPulse[enemy.id] ?? 0) > 0
        const isStaggered = (staggered[enemy.id] ?? 0) > 0
        const isKilledPulse = (killedPulse[enemy.id] ?? 0) > 0
        const firingState = intentFiring[enemy.id]
        const isFiring = (firingState?.count ?? 0) > 0
        const firingKind = firingState?.kind
        const intent = displayedIntent[enemy.id] ?? enemy.currentIntent
        // Lethal: telegraphed attack exceeds hp + visible block.
        const lethalIntent =
          intent.kind === 'attack' && intent.amount > playerHp + playerBlock
        const hpPct = Math.max(0, (shownHp / enemy.maxHp) * 100)
        // Targeted, living enemy is the attractor for red gem trails.
        // Gate on store-immediate hp (not displayed/lagged hp) so the
        // attribute drops the same frame the enemy hits zero — otherwise
        // a flock spawned during the ~700ms displayedHp drain can still
        // home onto a corpse, which is the swarm-AoE bug.
        const poolTargetAttr =
          isTarget && enemy.hp > 0 ? 'red' : undefined
        // Clickable when the player is acting and the enemy is alive but
        // not already the target. Dead enemies and the current target are
        // inert so the cursor doesn't mislead.
        const selectable =
          !dead && !isTarget && fightPhase === 'player-acting'
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
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={`${enemy.name} ${shownHp}/${enemy.maxHp} HP${dead ? ' (defeated)' : ''}${selectable ? ' — click to target' : isTarget ? ' — current target' : ''}`}
            role={selectable ? 'button' : undefined}
            tabIndex={selectable ? 0 : undefined}
            onClick={() => {
              if (selectable) setTargetEnemy(enemy.id)
            }}
            onKeyDown={(e) => {
              if (!selectable) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setTargetEnemy(enemy.id)
              }
            }}
          >
            {!dead && showIntent && (
              <IntentBadge
                intent={intent}
                tick={intentTick[enemy.id] ?? 0}
                lethal={lethalIntent}
                enemies={enemies}
              />
            )}
            <div className="enemy-sprite" aria-hidden>
              <span className="enemy-glyph">{dead ? '💀' : '👹'}</span>
            </div>
            <div className="enemy-name">{enemy.name}</div>
            {/* Effects row: block badge + status chips share one slot.
                The block badge is always mounted (.empty when no block) so
                this row's height is reserved regardless of statuses — adding
                Burn etc. expands inline without shifting the HP bar down. */}
            <div className="enemy-effects-row">
              <div
                className={`enemy-block-badge${
                  !dead && shownBlock > 0 ? '' : ' empty'
                }`}
                title="Block"
                aria-label={
                  !dead && shownBlock > 0 ? `Block ${shownBlock}` : undefined
                }
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

// Badge + viewport-aware tooltip. The tooltip is portalled to body and
// position is computed in JS so it never clips the viewport edges.
// Closes immediately on mouseleave — inline keyword sub-tooltips
// auto-show alongside the parent (see <Keyword> + HoverTooltip's
// autoShow path), so the player never needs to traverse into the
// tooltip itself, and both parent + children vanish together when the
// badge loses hover.
function IntentBadge({
  intent,
  tick,
  lethal,
  enemies,
}: {
  intent: Intent
  tick: number
  lethal: boolean
  enemies: Enemy[]
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    // Tooltip is unmounted when !hovered, so we don't need to reset pos.
    // On next hover useLayoutEffect re-runs and recomputes before paint.
    if (!hovered) return
    const compute = () => {
      const a = anchorRef.current?.getBoundingClientRect()
      const t = tipRef.current?.getBoundingClientRect()
      if (!a || !t) return
      const margin = 8
      // Prefer above the badge; flip below if there isn't room.
      const wantsBelow = a.top - margin - t.height < margin
      const top = wantsBelow ? a.bottom + margin : a.top - margin - t.height
      // Center on the anchor horizontally, then clamp inside the viewport.
      let left = a.left + a.width / 2 - t.width / 2
      left = Math.max(
        margin,
        Math.min(window.innerWidth - t.width - margin, left),
      )
      setPos({ left, top })
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [hovered])

  // For ally-target intents, look up the target's name from the enemy list
  // so the badge shows "❤️ 4 ➜ Brute" rather than a bare number.
  const allyTargetId =
    intent.kind === 'heal-ally' || intent.kind === 'buff-ally' || intent.kind === 'shield-ally'
      ? intent.targetAllyId
      : null
  const allyTargetName = allyTargetId
    ? (enemies.find((e) => e.id === allyTargetId)?.name ?? '?')
    : null

  // All per-kind icon/badge/label/tooltip data comes from one registry
  // call. Adding a new IntentKind lands as a single case in
  // src/content/intentDisplays.tsx — no parallel branches here.
  const display = intentDisplay(intent)

  return (
    <>
      <div
        ref={anchorRef}
        // key on the wrapping element re-mounts on intent change so the
        // pop-in animation replays for the freshly telegraphed intent.
        key={`${intent.kind}-${display.number ?? 'x'}-${tick}`}
        className={`enemy-intent intent-${intent.kind}${lethal ? ' lethal' : ''}`}
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
        {display.number !== undefined && (
          <span className="intent-amount">{display.number}</span>
        )}
        {intent.kind === 'attack' && intent.onHit && (
          <span
            className={`intent-rider rider-${intent.onHit.status}`}
            aria-hidden
          >
            {getStatusDef(intent.onHit.status).icon}
            {/* Rider stacks — surfaces the magnitude of the applied
                status so the player can read the full threat as a
                single sentence: "⚔ 3 🔥 2" → "hit for 3, apply Burn 2".
                The chip will show the same number once it lands. */}
            <span className="intent-rider-amount">{intent.onHit.stacks}</span>
          </span>
        )}
        {/* Ally-target: show arrow + target ally name/silhouette */}
        {allyTargetName && (
          <>
            <span className="intent-ally-arrow" aria-hidden>➜</span>
            <span className="intent-ally-target" aria-hidden title={allyTargetName}>
              {allyTargetName}
            </span>
          </>
        )}
      </div>
      {hovered &&
        createPortal(
          <div
            ref={tipRef}
            className={`intent-tooltip intent-${intent.kind}`}
            role="tooltip"
            style={{
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              opacity: pos ? 1 : 0,
            }}
          >
            <div className="intent-tooltip-title">{display.label}</div>
            <div className="intent-tooltip-body">
              {display.description}
            </div>
            {/* Damage-math preview (`X − Y block = Z to HP`) was removed
                — it duplicated info already conveyed by the intent
                amount + the keyword sub-tooltips, and added visual
                noise to every hover. Block/damage interactions are
                covered by the <Keyword id="block"/> sub-tooltip. */}
          </div>,
          document.body,
        )}
    </>
  )
}

function bumpIntentFiring(
  setter: Dispatch<
    SetStateAction<Record<string, { count: number; kind: 'attack' | 'block' }>>
  >,
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
