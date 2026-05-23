import { formatStatusTooltip, getStatusDef } from '../../content/statuses'
import type { StatusInstance } from '../../types'

// Icons + counters for active statuses on player or enemy. One inline
// row; empty list renders nothing.
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
        const tooltip = formatStatusTooltip(s.kind, s.stacks, s.duration)
        return (
          <span
            key={s.kind}
            className={`status-chip status-${s.kind}`}
            title={`${def.name}: ${tooltip}`}
            aria-label={`${def.name} — ${tooltip}`}
          >
            <span className="status-icon" aria-hidden>
              {def.icon}
            </span>
            <span className="status-stacks" aria-hidden>
              {s.kind === 'burn' ? s.stacks : s.duration}
            </span>
          </span>
        )
      })}
    </div>
  )
}
