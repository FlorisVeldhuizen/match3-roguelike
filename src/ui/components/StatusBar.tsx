import { formatStatusTooltip, getStatusDef } from '../../content/statuses'
import type { StatusInstance, StatusKind } from '../../types'
import { HoverTooltip } from './HoverTooltip'

// Icons + counters for active statuses on player or enemy. One inline
// row; empty list renders nothing. Uses the portal HoverTooltip so the
// status explanation reads the same as the spell/intent tooltips
// elsewhere in the UI.
//
// `tickMarks` bumps an integer per StatusKind every time that chip
// ticks. We use it as a React key on the popup + pulse spans so each
// tick re-mounts those nodes, replaying their CSS keyframes — even when
// the displayed stack number happens to be unchanged (it won't be, but
// the key approach is robust to that anyway).
export function StatusBar({
  statuses,
  tickMarks,
  className,
}: {
  statuses: readonly StatusInstance[]
  tickMarks?: Partial<Record<StatusKind, number>>
  className?: string
}) {
  if (statuses.length === 0) return null
  return (
    <div className={`status-bar${className ? ` ${className}` : ''}`} aria-label="Statuses">
      {statuses.map((s) => {
        const def = getStatusDef(s.kind)
        const body = formatStatusTooltip(s.kind, s.stacks)
        const tick = tickMarks?.[s.kind] ?? 0
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
                {/* Inner span carries the tick key so the number-pulse
                    keyframe replays on every tick without re-mounting
                    the whole chip (which would replay the chip-enter
                    animation too). */}
                <span
                  key={`n-${tick}`}
                  className={tick > 0 ? 'status-stacks-pulse' : undefined}
                >
                  {s.stacks}
                </span>
              </span>
              {/* Transient "-1" that floats off the chip on each tick.
                  Mounted only after the first tick (tick > 0) so a
                  freshly-applied chip doesn't render a stray popup. */}
              {tick > 0 && (
                <span
                  key={`pop-${tick}`}
                  className="status-chip-tick"
                  aria-hidden
                >
                  −1
                </span>
              )}
            </span>
          </HoverTooltip>
        )
      })}
    </div>
  )
}
