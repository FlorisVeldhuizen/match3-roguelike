import { formatStatusTooltip, getStatusDef } from '../../content/statuses'
import type { StatusInstance } from '../../types'
import { HoverTooltip } from './HoverTooltip'

// Icons + counters for active statuses on player or enemy. One inline
// row; empty list renders nothing. Uses the portal HoverTooltip so the
// status explanation reads the same as the spell/intent tooltips
// elsewhere in the UI.
export function StatusBar({
  statuses,
  className,
}: {
  statuses: readonly StatusInstance[]
  className?: string
}) {
  if (statuses.length === 0) return null
  return (
    <div className={`status-bar${className ? ` ${className}` : ''}`} aria-label="Statuses">
      {statuses.map((s) => {
        const def = getStatusDef(s.kind)
        const body = formatStatusTooltip(s.kind, s.stacks)
        return (
          <HoverTooltip
            key={s.kind}
            variant={`status-${s.kind}`}
            title={def.name}
            body={body}
            ariaLabel={`${def.name} — ${body}`}
          >
            <span
              className={`status-chip status-${s.kind}`}
              // data-status-chip lets the FX layer find this exact chip
              // when its status procs (e.g. Burn ticking) — particles
              // fly chip → target, treating the chip as the attacker.
              data-status-chip={s.kind}
            >
              <span className="status-icon" aria-hidden>
                {def.icon}
              </span>
              {/* Single number per status (StS pattern). For Burn it's
                  the next-tick damage AND turns-remaining (decays each
                  tick). For Vulnerable/Weak it's just turns-remaining
                  (the multiplier is binary). */}
              <span className="status-stacks" aria-hidden>
                {s.stacks}
              </span>
            </span>
          </HoverTooltip>
        )
      })}
    </div>
  )
}
