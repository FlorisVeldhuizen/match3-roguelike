import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { useAnimatedPhase } from '../hooks/useAnimatedPhase'
import type { Intent } from '../../types'

const HIT_FLASH_MS = 280
const INTENT_FIRE_MS = 420

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
    ? `On its turn, this enemy will attack you for ${intent.amount} damage.`
    : `On its turn, this enemy will gain ${intent.amount} block, reducing incoming damage.`
}

export function EnemyFrame() {
  const enemies = useGameStore((s) => s.fight.enemies)
  const targetId = useGameStore((s) => s.fight.targetEnemyId)
  const rootSeed = useGameStore((s) => s.rootSeed)
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

  const [flashing, setFlashing] = useState<Record<string, number>>({})
  // Red trail arrival → brief "incoming damage" pulse on the targeted enemy.
  // Cleared by id so the pulse stops if the player switches targets mid-phase.
  const [trailPulse, setTrailPulse] = useState<Record<string, number>>({})
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
        // takes ~700ms to land, so we delay the bar drain + hit flash
        // until it arrives. Other damage sources (future DoTs, etc.)
        // are not trail-driven — apply instantly.
        const delay = isPlayerAttack ? 700 : 0
        window.setTimeout(() => {
          setDisplayedHp((prev) => ({
            ...prev,
            [id]: Math.max(0, (prev[id] ?? 0) - amount),
          }))
          setFlashing((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
          window.setTimeout(() => {
            setFlashing((prev) => ({
              ...prev,
              [id]: Math.max(0, (prev[id] ?? 0) - 1),
            }))
          }, HIT_FLASH_MS)
        }, delay)
      } else if (event.kind === 'pool-gained' && event.color === 'red') {
        // Brief outline pulse when the trail lands. Damage popup itself
        // comes from the per-match damage-dealt event.
        const id = useGameStore.getState().fight.targetEnemyId
        if (!id) return
        window.setTimeout(() => {
          setTrailPulse((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
          window.setTimeout(() => {
            setTrailPulse((prev) => ({
              ...prev,
              [id]: Math.max(0, (prev[id] ?? 0) - 1),
            }))
          }, 380)
        }, 700)
      } else if (event.kind === 'damage-taken' && event.source === 'enemy-attack') {
        // Enemy's attack landed — pulse the currently-acting enemy. Single-
        // enemy fight today; multi-enemy routing waits on a damage-taken
        // payload that carries the source enemy id.
        const id = useGameStore.getState().fight.targetEnemyId
        if (id) bumpIntentFiring(setIntentFiring, id, 'attack')
      } else if (event.kind === 'enemy-block-gained') {
        bumpIntentFiring(setIntentFiring, event.enemyId, 'block')
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
      const fresh: Record<string, number> = {}
      for (const e of s.fight.enemies) fresh[e.id] = e.hp
      setDisplayedHp(fresh)
    })
  }, [rootSeed])

  return (
    <section className="enemy-row" aria-label="Enemies">
      {enemies.map((enemy) => {
        const shownHp = displayedHp[enemy.id] ?? enemy.hp
        // Use the *displayed* HP for the dead-vs-alive visual so the
        // skull/intent-hide flips in sync with the bar drain, not at
        // store-commit time.
        const dead = shownHp <= 0
        const isTarget = enemy.id === targetId
        const isHit = (flashing[enemy.id] ?? 0) > 0
        const isTrailHit = (trailPulse[enemy.id] ?? 0) > 0
        const firingState = intentFiring[enemy.id]
        const isFiring = (firingState?.count ?? 0) > 0
        const firingKind = firingState?.kind
        const intent = displayedIntent[enemy.id] ?? enemy.currentIntent
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
              isTarget ? 'targeted' : '',
              isHit ? 'hit' : '',
              isTrailHit ? 'trail-pulsing' : '',
              isFiring ? `firing-${firingKind}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={`${enemy.name} ${shownHp}/${enemy.maxHp} HP${dead ? ' (defeated)' : ''}`}
          >
            {!dead && showIntent && (
              <div
                // key forces re-mount on intent change so the pop-in
                // animation replays for the freshly telegraphed intent.
                key={`${intent.kind}-${intent.amount}-${intentTick[enemy.id] ?? 0}`}
                className={`enemy-intent intent-${intent.kind}`}
                role="img"
                aria-label={intentLabel(intent)}
                tabIndex={0}
              >
                <span className="intent-icon" aria-hidden>
                  {intentIcon(intent)}
                </span>
                <span className="intent-amount">{intent.amount}</span>
                <div className="intent-tooltip" role="tooltip">
                  <div className="intent-tooltip-title">{intentLabel(intent)}</div>
                  <div className="intent-tooltip-body">{intentDescription(intent)}</div>
                </div>
              </div>
            )}
            <div className="enemy-sprite" aria-hidden>
              <span className="enemy-glyph">{dead ? '💀' : '👹'}</span>
            </div>
            <div className="enemy-name">{enemy.name}</div>
            {!dead && enemy.block > 0 && (
              <div
                className="enemy-block-badge"
                title="Block"
                aria-label={`Block ${enemy.block}`}
              >
                <span aria-hidden>🛡</span>
                <span>{enemy.block}</span>
              </div>
            )}
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
