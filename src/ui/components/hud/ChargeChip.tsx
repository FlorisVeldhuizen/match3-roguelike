import { HoverTooltip } from '../HoverTooltip'
import { listUltimates } from '../../../core/combat/spellRegistry'
import { popClass, type PopState } from './popAnimation'

export function ChargeChip({
  value,
  pop,
  pulsing,
}: {
  value: number
  pop: PopState
  pulsing: boolean
}) {
  const ult = listUltimates()[0]
  const threshold = ult?.chargeCost ?? 8
  const ready = value >= threshold
  return (
    <HoverTooltip
      variant="charge"
      title={`Skill charge — ${value}`}
      body={
        <>
          <div>Earned from <strong>purple gem matches</strong>. Powers your <strong>ultimate</strong> ability.</div>
          <div className="hover-tooltip-aside">
            {ready
              ? `Fully charged — ${ult?.name ?? 'your ultimate'} is ready to cast.`
              : `${threshold - value} more to unlock ${ult?.name ?? 'your ultimate'}.`}
          </div>
        </>
      }
      ariaLabel={`Skill charge: ${value}`}
    >
      <span
        className={`charge-chip${pulsing ? ' pulsing' : ''}${ready ? ' is-ready' : ''}`}
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
