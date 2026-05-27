import { HoverTooltip } from '../HoverTooltip'
import { popClass, type PopState } from './popAnimation'
import { hudGoldTooltipBody } from './hudTooltips'

export function GoldChip({
  value,
  pop,
  pulsing,
}: {
  value: number
  pop: PopState
  pulsing: boolean
}) {
  return (
    <HoverTooltip
      variant="mana"
      title={`Gold — ${value}`}
      body={hudGoldTooltipBody()}
      ariaLabel={`Gold: ${value}`}
    >
      <span
        className={`mana-chip mana-gold${pulsing ? ' pulsing' : ''}`}
        data-mana-target="gold"
        data-pool-target="gold"
      >
        <span className="mana-dot" data-color="gold" aria-hidden />
        <span className="mana-value">
          <span key={pop.key} className={popClass(pop)}>
            {value}
          </span>
        </span>
      </span>
    </HoverTooltip>
  )
}
