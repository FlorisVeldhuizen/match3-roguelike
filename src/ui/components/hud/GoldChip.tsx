import { HoverTooltip } from '../HoverTooltip'
import { popClass, type PopState } from './popAnimation'

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
      body={
        <>
          <div>Earned from <strong>gold gem matches</strong> (~10% of board spawns) and from <strong>fight rewards</strong>.</div>
          <div className="hover-tooltip-aside">No cap. Persists for the whole run; spent at shops.</div>
        </>
      }
      ariaLabel={`Gold: ${value}`}
    >
      <span
        className={`mana-chip mana-gold${pulsing ? ' pulsing' : ''}`}
        data-mana-target="gold"
        data-pool-target="gold"
      >
        <span className="mana-dot" data-color="gold" aria-hidden />
        <span className="mana-value">
          <span key={pop.key} className={popClass(pop)}>{value}</span>
        </span>
      </span>
    </HoverTooltip>
  )
}
