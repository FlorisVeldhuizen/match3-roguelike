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
        const body = formatStatusTooltip(s.kind, s.stacks, s.duration)
        return (
          <HoverTooltip
            key={s.kind}
            variant={`status-${s.kind}`}
            title={def.name}
            body={body}
            ariaLabel={`${def.name} — ${body}`}
          >
            <span className={`status-chip status-${s.kind}`}>
              <span className="status-icon" aria-hidden>
                {def.icon}
              </span>
              <span className="status-stacks" aria-hidden>
                {s.kind === 'burn' ? s.stacks : s.duration}
              </span>
            </span>
          </HoverTooltip>
        )
      })}
    </div>
  )
}
