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
import type { Intent } from '../../types'

const HIT_FLASH_MS = 280
// Must match (or slightly outlast) the longest .firing-* animation in
// index.css — currently enemy-firing-attack at 460ms.
const INTENT_FIRE_MS = 460
// Death pulse duration — long enough to read the scale-flash arc, short
// enough to settle into the static .dead state before the next event.
const KILL_PULSE_MS = 720

function intentIcon(intent: Intent): string {
  return intent.kind === 'attack' ? '⚔' : '🛡'
}

function intentLabel(intent: Intent): string {
  return intent.kind === 'attack'
    ? `Attacks for ${intent.amount}`
    : `Blocks for ${intent.amount}`
}

function intentDescription(intent: Intent): string {
  return intent.kind === 'attack'
    ? `Deals ${intent.amount} damage next turn.`
    : `Shield is up — absorbs ${intent.amount} damage from your attacks.`
}

export function EnemyFrame() {
  const enemies = useGameStore((s) => s.fight.enemies)
  const targetId = useGameStore((s) => s.fight.targetEnemyId)
  const rootSeed = useGameStore((s) => s.rootSeed)
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
        // Player-attack hits commit per-match; the matching red trail
        // takes TRAIL_ARRIVAL_MS to land, so we delay the bar drain + hit
        // flash until it arrives. Other damage sources (future DoTs, etc.)
        // are not trail-driven — apply instantly.
        const delay = isPlayerAttack ? TRAIL_ARRIVAL_MS : 0
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
        // Enemy's attack landed — pulse the currently-acting enemy. Single-
        // enemy fight today; multi-enemy routing waits on a damage-taken
        // payload that carries the source enemy id.
        const id = useGameStore.getState().fight.targetEnemyId
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
      }
    })
    return unsub
  }, [])

  // Hard-resync displayed HP on run reset. Subscribe to the store so
  // the setState happens in the callback (external-system update),
  // not in the effect body.
  useEffect(() => {
    let prevSeed = rootSeed
    return useGameStore.subscribe((s) => {
      if (s.rootSeed === prevSeed) return
      prevSeed = s.rootSeed
      const freshHp: Record<string, number> = {}
      const freshBlock: Record<string, number> = {}
      for (const e of s.fight.enemies) {
        freshHp[e.id] = e.hp
        freshBlock[e.id] = e.block
      }
      setDisplayedHp(freshHp)
      setDisplayedBlock(freshBlock)
    })
  }, [rootSeed])

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
        const poolTargetAttr = isTarget && !dead ? 'red' : undefined
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
              isHit ? 'hit' : '',
              isTrailHit ? 'trail-pulsing' : '',
              isFiring ? `firing-${firingKind}` : '',
              isStaggered ? 'staggered' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={`${enemy.name} ${shownHp}/${enemy.maxHp} HP${dead ? ' (defeated)' : ''}`}
          >
            {!dead && showIntent && (
              <IntentBadge
                intent={intent}
                tick={intentTick[enemy.id] ?? 0}
                lethal={lethalIntent}
              />
            )}
            <div className="enemy-sprite" aria-hidden>
              <span className="enemy-glyph">{dead ? '💀' : '👹'}</span>
            </div>
            <div className="enemy-name">{enemy.name}</div>
            {/* Always mounted so the slot reserves vertical space — toggling
                mount on block gain shifted the HP bar down. */}
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
function IntentBadge({
  intent,
  tick,
  lethal,
}: {
  intent: Intent
  tick: number
  lethal: boolean
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

  return (
    <>
      <div
        ref={anchorRef}
        // key on the wrapping element re-mounts on intent change so the
        // pop-in animation replays for the freshly telegraphed intent.
        key={`${intent.kind}-${intent.amount}-${tick}`}
        className={`enemy-intent intent-${intent.kind}${lethal ? ' lethal' : ''}`}
        role="img"
        aria-label={`${intentLabel(intent)}${lethal ? ' — lethal!' : ''}`}
        tabIndex={0}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
      >
        <span className="intent-icon" aria-hidden>
          {intentIcon(intent)}
        </span>
        <span className="intent-amount">{intent.amount}</span>
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
            <div className="intent-tooltip-title">{intentLabel(intent)}</div>
            <div className="intent-tooltip-body">
              {intentDescription(intent)}
            </div>
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
