import { HoverTooltip } from '../HoverTooltip'
import { listUltimates } from '../../../core/combat/spellRegistry'
import { popClass, type PopState } from './popAnimation'

// Charge sits next to the mana row visually but is conceptually separate:
// it's not mana, it's the ultimate's fuel. Matches the mana-chip
// silhouette so the row reads coherently, with a faint divider before
// it (see .hud-divider) signalling "different resource class."
export function ChargeChip({
  value,
  pop,
  pulsing,
}: {
  value: number
  pop: PopState
  pulsing: boolean
}) {
  // Threshold = the lowest-cost ultimate. Slice has one (Riposte) so this
  // is just its chargeCost. With multiple ultimates later, this becomes
  // "your cheapest available ultimate."
  const ult = listUltimates()[0]
  const threshold = ult?.chargeCost ?? 8
  const ready = value >= threshold
  // Display just the current value — there's no cap on charge, only a
  // *cost* to fire the ultimate. Previous "/8" misread as a cap (the
  // value can overflow 8 — confusing). The cost is shown on the spell
  // card itself; the chip just shows how much charge you've banked.
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
