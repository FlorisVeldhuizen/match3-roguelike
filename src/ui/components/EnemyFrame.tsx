import { useGameStore } from '../../core/state/store'

export function EnemyFrame() {
  const enemies = useGameStore((s) => s.fight.enemies)
  const targetId = useGameStore((s) => s.fight.targetEnemyId)

  return (
    <section className="enemy-row" aria-label="Enemies">
      {enemies.map((enemy) => {
        const dead = enemy.hp <= 0
        const isTarget = enemy.id === targetId
        const hpPct = Math.max(0, (enemy.hp / enemy.maxHp) * 100)
        return (
          <div
            key={enemy.id}
            className={`enemy-frame ${dead ? 'dead' : ''} ${isTarget ? 'targeted' : ''}`}
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
