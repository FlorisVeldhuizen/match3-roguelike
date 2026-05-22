import { useGameStore } from '../../core/state/store'
import type { CombatPhase, GemColor } from '../../types'

const PHASE_LABEL: Record<CombatPhase, string> = {
  'player-acting': 'Your turn',
  resolving: 'Resolving…',
  'player-phase-end': 'Resolving…',
  'enemy-acting': 'Enemy turn',
  'enemy-end': 'Enemy turn',
  victory: 'Victory',
}

const POOL_COLORS: { color: GemColor; label: string; key: 'red' | 'blue' | 'green' }[] = [
  { color: 'red', label: 'R', key: 'red' },
  { color: 'blue', label: 'B', key: 'blue' },
  { color: 'green', label: 'G', key: 'green' },
]

export function HUD() {
  const player = useGameStore((s) => s.fight.player)
  const phase = useGameStore((s) => s.fight.phase)
  const hpPct = Math.max(0, (player.hp / player.maxHp) * 100)

  return (
    <section className="hud" aria-label="Player status">
      <div className="hud-row">
        <span className="hud-phase">{PHASE_LABEL[phase]}</span>
      </div>
      <div className="hud-row">
        <div className="hp-bar" role="img" aria-label={`HP ${player.hp}/${player.maxHp}`}>
          <div className="hp-fill" style={{ width: `${hpPct}%` }} />
          <span className="hp-text">
            {player.hp} / {player.maxHp}
          </span>
        </div>
        <div className={`block-badge ${player.block > 0 ? 'active' : ''}`} title="Block">
          <span className="block-icon" aria-hidden>🛡</span>
          <span className="block-value">{player.block}</span>
        </div>
      </div>
      <div className="hud-row hud-resources">
        <div className="resource resource-mana" title="Mana (yellow, persistent)">
          <span className="resource-dot" data-color="yellow" aria-hidden />
          <span className="resource-label">Mana</span>
          <span className="resource-value">{player.mana}</span>
        </div>
        <div className="resource resource-charge" title="Skill charge (purple, persistent)">
          <span className="resource-dot" data-color="purple" aria-hidden />
          <span className="resource-label">Charge</span>
          <span className="resource-value">{player.skillCharge}</span>
        </div>
      </div>
      <div className="hud-row hud-pools" aria-label="This phase's pools">
        <span className="hud-pools-label">Phase pools</span>
        {POOL_COLORS.map(({ color, label, key }) => (
          <div key={color} className="pool" title={`${color} pool (resolves at end of phase)`}>
            <span className="pool-dot" data-color={color} aria-hidden>{label}</span>
            <span className="pool-value">{player.phasePools[key]}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
