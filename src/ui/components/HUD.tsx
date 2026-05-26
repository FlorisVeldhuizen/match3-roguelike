import { useGameStore } from '../../core/state/store'
import { MANA_CAPS, type GemColor } from '../../types'
import { StatusBar } from './StatusBar'
import { useHudEventChannel } from './hud/useHudEventChannel'
import { usePopOnChange, popClass } from './hud/popAnimation'
import { ManaChip } from './hud/ManaChip'
import { ChargeChip } from './hud/ChargeChip'
import { GoldChip } from './hud/GoldChip'

export function HUD() {
  const player = useGameStore((s) => s.fight.player)
  const {
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
    hpGlow,
    hpHit,
    hpBurnHit,
    blockPulse,
  } = useHudEventChannel()

  const cls = (color: GemColor, base: string) =>
    pulse[color] > 0 ? `${base} pulsing` : base

  const hpPop = usePopOnChange(displayedHp)
  const blockPop = usePopOnChange(stagedBlue)
  const redManaPop = usePopOnChange(displayedMana.red)
  const blueManaPop = usePopOnChange(displayedMana.blue)
  const greenManaPop = usePopOnChange(displayedMana.green)
  const yellowManaPop = usePopOnChange(displayedMana.yellow)
  const chargePop = usePopOnChange(displayedCharge)
  const goldPop = usePopOnChange(displayedGold)

  const hpPct = Math.max(0, (displayedHp / player.maxHp) * 100)
  const isLowHp = displayedHp > 0 && displayedHp / player.maxHp <= 0.3
  const badgeBlock = stagedBlue
  const blockHasPending = badgeBlock > 0 && !blockCommitted
  const blockActive = badgeBlock > 0 && blockCommitted

  return (
    <section
      className="hud"
      aria-label="Player status"
      data-player-hud="true"
    >
      <StatusBar
        statuses={displayedStatuses}
        tickMarks={statusTickMarks}
        cueMarks={statusCueMarks}
        expiringKinds={expiringStatusKinds}
        className="player-statuses player-statuses-floating"
      />
      <div className="hud-row hud-stat-resource-row">
        <div className="hud-stat-cluster">
          <div
            className={`hp-bar ${hpGlow ? 'glow' : ''} ${hpHit ? 'hit' : ''} ${hpBurnHit ? 'burn-hit' : ''} ${isLowHp ? 'low' : ''} ${cls('green', '')}`}
            role="img"
            aria-label={`HP ${displayedHp}/${player.maxHp}`}
            data-pool-target="green"
          >
            <div className="hp-fill" style={{ width: `${hpPct}%` }} />
            <span className="hp-text">
              <span key={hpPop.key} className={popClass(hpPop)}>
                {displayedHp}
              </span>{' '}
              / {player.maxHp}
            </span>
          </div>
          <div
            className={`block-badge ${blockActive ? 'active' : ''} ${blockHasPending ? 'pending' : ''} ${blockPulse ? 'pulsing' : ''} ${cls('blue', '')}`}
            title={
              blockHasPending
                ? `Block ${badgeBlock} (pending — commits at phase end)`
                : 'Block'
            }
            data-pool-target="blue"
          >
            <span className="block-icon" aria-hidden>🛡</span>
            <span className="block-value">
              <span key={blockPop.key} className={popClass(blockPop)}>
                {badgeBlock}
              </span>
            </span>
          </div>
        </div>
        <div className="hud-resource-cluster hud-mana-chips">
          <ManaChip
            color="red"
            value={displayedMana.red}
            cap={MANA_CAPS.red}
            pop={redManaPop}
            pulsing={pulse.red > 0}
            title="Red mana"
            body={
              <>
                <div>Earned from <strong>red gem matches</strong>. Spent on offensive spells like Bash and Volley.</div>
                <div className="hover-tooltip-aside">Caps at {MANA_CAPS.red}. Persists across fights.</div>
              </>
            }
          />
          <ManaChip
            color="blue"
            value={displayedMana.blue}
            cap={MANA_CAPS.blue}
            pop={blueManaPop}
            pulsing={pulse.blue > 0}
            title="Blue mana"
            body={
              <>
                <div>Earned from <strong>blue gem matches</strong>. Spent on defensive spells like Bulwark and Reinforce.</div>
                <div className="hover-tooltip-aside">Caps at {MANA_CAPS.blue}. Persists across fights.</div>
              </>
            }
          />
          <ManaChip
            color="green"
            value={displayedMana.green}
            cap={MANA_CAPS.green}
            pop={greenManaPop}
            pulsing={pulse.green > 0}
            title="Green mana"
            body={
              <>
                <div>Earned from <strong>green gem matches</strong>. Spent on healing and cleanse spells.</div>
                <div className="hover-tooltip-aside">Caps at {MANA_CAPS.green}. Persists across fights.</div>
              </>
            }
          />
          <ManaChip
            color="yellow"
            value={displayedMana.yellow}
            cap={MANA_CAPS.yellow}
            pop={yellowManaPop}
            pulsing={pulse.yellow > 0}
            wild
            title="Wild mana"
            body={
              <>
                <div>Earned from <strong>yellow gem matches</strong>. <strong>Substitutes for any colour's spell cost at 1:1</strong> — pays the shortfall when you're light on a specific colour.</div>
                <div className="hover-tooltip-aside">Caps at {MANA_CAPS.yellow}. Persists across fights.</div>
              </>
            }
          />
          <span className="hud-divider" aria-hidden />
          <ChargeChip
            value={displayedCharge}
            pop={chargePop}
            pulsing={pulse.purple > 0}
          />
          <span className="hud-divider" aria-hidden />
          <GoldChip
            value={displayedGold}
            pop={goldPop}
            pulsing={pulse.gold > 0}
          />
        </div>
      </div>
    </section>
  )
}
