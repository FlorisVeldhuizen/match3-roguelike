import { HoverTooltip } from '../HoverTooltip'
import { Keyword } from '../Keyword'
import { listUltimates } from '../../../core/combat/spellRegistry'
import { popClass, type PopState } from './popAnimation'

export function ChargeChip({
  value,
  pop,
  pulsing,
  spending,
}: {
  value: number
  pop: PopState
  pulsing: boolean
  spending?: boolean
}) {
  const ult = listUltimates()[0]
  const threshold = ult?.chargeCost ?? 8
  const ready = value >= threshold
  return (
    <HoverTooltip
      variant="charge"
      title={`Skill charge — ${value}`}
      body={
        <div>
          <strong>Purple gems</strong> build <Keyword id="ultimate">ultimate</Keyword> charge — no
          direct combat effect on match.
          {ready
            ? ' Ready to cast.'
            : ` ${threshold - value} more needed.`}
        </div>
      }
      ariaLabel={`Skill charge: ${value}`}
    >
      <span
        className={`charge-chip${pulsing ? ' pulsing' : ''}${spending ? ' spending' : ''}${ready ? ' is-ready' : ''}`}
        data-pool-target="purple"
      >
        <span className="charge-icon" data-color="purple" aria-hidden />
        <span className="mana-value">
          <span key={pop.key} className={popClass(pop)}>{value}</span>
        </span>
      </span>
    </HoverTooltip>
  )
}
