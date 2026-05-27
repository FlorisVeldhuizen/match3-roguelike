import { formatStatusTooltip, getStatusDef } from '../../content/statuses'
import type { StatusInstance, StatusKind } from '../../types'
import { HoverTooltip } from './HoverTooltip'

export function StatusBar({
  statuses,
  tickMarks,
  cueMarks,
  expiringKinds,
  className,
}: {
  statuses: readonly StatusInstance[]
  tickMarks?: Partial<Record<StatusKind, number>>
  cueMarks?: Partial<Record<StatusKind, number>>
  expiringKinds?: ReadonlySet<StatusKind>
  className?: string
}) {
  return (
    <div className={`status-bar${className ? ` ${className}` : ''}`} aria-label="Statuses">
      {statuses.map((s) => {
        const def = getStatusDef(s.kind)
        const body = formatStatusTooltip(s.kind, s.stacks)
        const tick = tickMarks?.[s.kind] ?? 0
        const cue = cueMarks?.[s.kind] ?? 0
        const expiring = expiringKinds?.has(s.kind) ?? false
        return (
          <HoverTooltip
            key={s.kind}
            variant={`status-${s.kind}`}
            title={def.name}
            body={body}
            ariaLabel={`${def.name} — ${body}`}
          >
            <span
              className={`status-chip status-${s.kind}${expiring ? ' is-expiring' : ''}`}
              data-status-chip={s.kind}
            >
              <span className="status-icon" aria-hidden>
                {def.icon}
              </span>
              <span className="status-stacks" aria-hidden>
                <span key={`n-${tick}`} className={tick > 0 ? 'status-stacks-pulse' : undefined}>
                  {s.stacks}
                </span>
              </span>
              {tick > 0 && (
                <span key={`pop-${tick}`} className="status-chip-tick" aria-hidden>
                  −1
                </span>
              )}
              {cue > 0 && <span key={`cue-${cue}`} className="status-chip-cue" aria-hidden />}
            </span>
          </HoverTooltip>
        )
      })}
    </div>
  )
}
