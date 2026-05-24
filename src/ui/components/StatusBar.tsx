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
  cueMarks,
  expiringKinds,
  className,
}: {
  statuses: readonly StatusInstance[]
  tickMarks?: Partial<Record<StatusKind, number>>
  // Pre-tick "winding up" cue: bumps per StatusKind when that status is
  // about to deal proc damage (i.e. damage-taken/damage-dealt with
  // source='burn'). Drives a brief glow on the chip so the proc has a
  // "here it comes" tell before the chip→bar particle trail arrives.
  // Different from tickMarks (which fires AFTER the tick lands and
  // replays the `−1` popup).
  cueMarks?: Partial<Record<StatusKind, number>>
  // Kinds currently mid-fizzle (post-expire goodbye flash + fade).
  // Chips remain in `statuses` during this window so the animation has
  // something to play on; the parent removes them from displayedStatuses
  // after the fizzle window closes. See HUD's status-expired handler.
  expiringKinds?: ReadonlySet<StatusKind>
  className?: string
}) {
  // Always render the container so callers can reserve vertical space via
  // the passed className (see .enemy-statuses min-height) — toggling mount
  // when the first status lands would shift sibling elements down.
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
              {/* Pre-impact "wind up" glow on the chip when this status
                  is about to deal proc damage. Mounted briefly via
                  cueMarks; the React key forces a remount so the
                  keyframe replays on each proc. */}
              {cue > 0 && (
                <span
                  key={`cue-${cue}`}
                  className="status-chip-cue"
                  aria-hidden
                />
              )}
            </span>
          </HoverTooltip>
        )
      })}
    </div>
  )
}
