import { useGameStore } from '../../core/state/store'
import { MANA_CAPS, type GemColor } from '../../types'
import { StatusBar } from './StatusBar'
import { HoverTooltip } from './HoverTooltip'
import { Keyword } from './Keyword'
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
    spendPulse,
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
          <HoverTooltip
            className="tooltip-anchor-hp"
            variant="hp"
            title={`HP — ${displayedHp} / ${player.maxHp}`}
            body={
              <div>
                Your <Keyword id="hp">HP</Keyword>. Restored by{' '}
                <Keyword id="heal">healing</Keyword> and lost to enemy attacks and
                effects.
              </div>
            }
            ariaLabel={`HP ${displayedHp} of ${player.maxHp}`}
          >
            <div
              className={`hp-bar ${hpGlow ? 'glow' : ''} ${hpHit ? 'hit' : ''} ${hpBurnHit ? 'burn-hit' : ''} ${isLowHp ? 'low' : ''} ${cls('green', '')}`}
              role="img"
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
          </HoverTooltip>
          <HoverTooltip
            variant="block"
            title={
              blockHasPending
                ? `Staged block — ${badgeBlock}`
                : `Armor — ${badgeBlock}`
            }
            body={
              blockHasPending ? (
                <div>
                  Blue gems matched this turn. Becomes{' '}
                  <Keyword id="block">armor</Keyword> when you end your turn.
                </div>
              ) : blockActive ? (
                <div>
                  Your <Keyword id="block">armor</Keyword> absorbs damage before{' '}
                  <Keyword id="hp">HP</Keyword> until your next turn (unless carried).
                </div>
              ) : (
                <div>
                  Match blue gems to build block. It becomes{' '}
                  <Keyword id="block">armor</Keyword> when you end your turn.
                </div>
              )
            }
            ariaLabel={`Armor ${badgeBlock}`}
          >
            <div
              className={`block-badge ${blockActive ? 'active' : ''} ${blockHasPending ? 'pending' : ''} ${blockPulse ? 'pulsing' : ''} ${cls('blue', '')}`}
              data-pool-target="blue"
            >
              <span className="block-icon" aria-hidden>🛡</span>
              <span className="block-value">
                <span key={blockPop.key} className={popClass(blockPop)}>
                  {badgeBlock}
                </span>
              </span>
            </div>
          </HoverTooltip>
        </div>
        <div className="hud-resource-cluster hud-mana-chips">
          <ManaChip
            color="red"
            value={displayedMana.red}
            cap={MANA_CAPS.red}
            pop={redManaPop}
            pulsing={pulse.red > 0}
            spending={spendPulse.red > 0}
            title="Red mana"
            body={
              <div>
                <strong>Red gems</strong> damage enemies when matched and add{' '}
                <Keyword id="mana">mana</Keyword> here for attack spells.
              </div>
            }
          />
          <ManaChip
            color="blue"
            value={displayedMana.blue}
            cap={MANA_CAPS.blue}
            pop={blueManaPop}
            pulsing={pulse.blue > 0}
            spending={spendPulse.blue > 0}
            title="Blue mana"
            body={
              <div>
                <strong>Blue gems</strong> build toward your{' '}
                <Keyword id="block">armor</Keyword> (shield) and add{' '}
                <Keyword id="mana">mana</Keyword> for defensive spells.
              </div>
            }
          />
          <ManaChip
            color="green"
            value={displayedMana.green}
            cap={MANA_CAPS.green}
            pop={greenManaPop}
            pulsing={pulse.green > 0}
            spending={spendPulse.green > 0}
            title="Green mana"
            body={
              <div>
                <strong>Green gems</strong> <Keyword id="heal">heal</Keyword> you when matched and
                add <Keyword id="mana">mana</Keyword> for healing spells.
              </div>
            }
          />
          <ManaChip
            color="yellow"
            value={displayedMana.yellow}
            cap={MANA_CAPS.yellow}
            pop={yellowManaPop}
            pulsing={pulse.yellow > 0}
            spending={spendPulse.yellow > 0}
            wild
            title="Wild mana"
            body={
              <div>
                <strong>Yellow gems</strong> only add <Keyword id="wildMana">wild mana</Keyword> —
                no direct combat effect on match.
              </div>
            }
          />
          <span className="hud-divider" aria-hidden />
          <ChargeChip
            value={displayedCharge}
            pop={chargePop}
            pulsing={pulse.purple > 0}
            spending={spendPulse.purple > 0}
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
