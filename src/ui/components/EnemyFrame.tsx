import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'

const HIT_FLASH_MS = 280

export function EnemyFrame() {
  const enemies = useGameStore((s) => s.fight.enemies)
  const targetId = useGameStore((s) => s.fight.targetEnemyId)
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
            <div className="enemy-sprite" aria-hidden>
              <span className="enemy-glyph">{dead ? '💀' : '👹'}</span>
            </div>
            <div className="enemy-name">{enemy.name}</div>
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
