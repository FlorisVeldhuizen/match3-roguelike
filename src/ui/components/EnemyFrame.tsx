import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import type { Intent } from '../../types'

const HIT_FLASH_MS = 280

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
  const phase = useGameStore((s) => s.fight.phase)
  const showIntent = phase === 'player-acting'
  const [flashing, setFlashing] = useState<Record<string, number>>({})

  useEffect(() => {
    const unsub = subscribeGameEvents((event) => {
      if (event.kind !== 'damage-dealt') return
      const id = event.targetId
      setFlashing((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
      window.setTimeout(() => {
        setFlashing((prev) => ({
          ...prev,
          [id]: Math.max(0, (prev[id] ?? 0) - 1),
        }))
      }, HIT_FLASH_MS)
    })
    return unsub
  }, [])

  return (
    <section className="enemy-row" aria-label="Enemies">
      {enemies.map((enemy) => {
        const dead = enemy.hp <= 0
        const isTarget = enemy.id === targetId
        const isHit = (flashing[enemy.id] ?? 0) > 0
        const hpPct = Math.max(0, (enemy.hp / enemy.maxHp) * 100)
        return (
          <div
            key={enemy.id}
            data-enemy-id={enemy.id}
            className={[
              'enemy-frame',
              dead ? 'dead' : '',
              isTarget ? 'targeted' : '',
              isHit ? 'hit' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-label={`${enemy.name} ${enemy.hp}/${enemy.maxHp} HP${dead ? ' (defeated)' : ''}`}
          >
            {!dead && showIntent && (
              <div
                className={`enemy-intent intent-${enemy.currentIntent.kind}`}
                role="img"
                aria-label={intentLabel(enemy.currentIntent)}
                title={intentLabel(enemy.currentIntent)}
              >
                <span className="intent-icon" aria-hidden>
                  {intentIcon(enemy.currentIntent)}
                </span>
                <span className="intent-amount">{enemy.currentIntent.amount}</span>
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
                {Math.max(0, enemy.hp)} / {enemy.maxHp}
              </span>
            </div>
          </div>
        )
      })}
    </section>
  )
}
