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

export function EnemyFrame() {
  const enemies = useGameStore((s) => s.fight.enemies)
  const targetId = useGameStore((s) => s.fight.targetEnemyId)
  const pendingRed = useGameStore((s) => s.fight.player.phasePools.red)
  const animatedPhase = useAnimatedPhase()
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
        setFlashing((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
        window.setTimeout(() => {
          setFlashing((prev) => ({
            ...prev,
            [id]: Math.max(0, (prev[id] ?? 0) - 1),
          }))
        }, HIT_FLASH_MS)
      } else if (event.kind === 'pool-gained' && event.color === 'red') {
        // Red gem trail just landed — pulse the currently targeted enemy.
        // The trail itself flies to the [data-pool-target="red"] element,
        // which is the same frame.
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
        }, 700) // matches TRAIL_TRAVEL_MS in HUD
      } else if (event.kind === 'damage-taken' && event.source === 'enemy-attack') {
        // Enemy's attack just landed — pulse the *currently-acting* enemy.
        // Phase E only has one enemy; in H2 we'll route by enemy id once the
        // damage-taken payload carries it.
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

  return (
    <section className="enemy-row" aria-label="Enemies">
      {enemies.map((enemy) => {
        const dead = enemy.hp <= 0
        const isTarget = enemy.id === targetId
        const isHit = (flashing[enemy.id] ?? 0) > 0
        const isTrailHit = (trailPulse[enemy.id] ?? 0) > 0
        const firingState = intentFiring[enemy.id]
        const isFiring = (firingState?.count ?? 0) > 0
        const firingKind = firingState?.kind
        const intent = displayedIntent[enemy.id] ?? enemy.currentIntent
        const hpPct = Math.max(0, (enemy.hp / enemy.maxHp) * 100)
        // Pending damage pip only shown on the target — that's where the
        // red pool will resolve at phase end.
        const showPendingDamage = isTarget && !dead && pendingRed > 0
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
              isFiring ? `firing firing-${firingKind}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={`${enemy.name} ${enemy.hp}/${enemy.maxHp} HP${dead ? ' (defeated)' : ''}`}
          >
            {!dead && showIntent && (
              <div
                // key forces re-mount on intent change so the pop-in
                // animation replays for the freshly telegraphed intent.
                key={`${intent.kind}-${intent.amount}-${intentTick[enemy.id] ?? 0}`}
                className={`enemy-intent intent-${intent.kind}`}
                role="img"
                aria-label={intentLabel(intent)}
                title={intentLabel(intent)}
              >
                <span className="intent-icon" aria-hidden>
                  {intentIcon(intent)}
                </span>
                <span className="intent-amount">{intent.amount}</span>
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
            <div
              className="enemy-hp-bar"
              role="img"
              title={
                showPendingDamage
                  ? `Incoming damage: -${pendingRed} at end of phase`
                  : undefined
              }
            >
              <div className="enemy-hp-fill" style={{ width: `${hpPct}%` }} />
              <span className="enemy-hp-text">
                {Math.max(0, enemy.hp)} / {enemy.maxHp}
              </span>
              {showPendingDamage && (
                <span className="enemy-hp-pending" aria-hidden>−{pendingRed}</span>
              )}
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
