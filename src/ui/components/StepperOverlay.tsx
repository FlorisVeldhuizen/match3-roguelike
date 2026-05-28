import { useEffect, useState } from 'react'
import {
  advanceStep,
  getStepStatus,
  isStepMode,
  setStepMode,
  subscribeStepMode,
  subscribeStepStatus,
  type StepStatus,
} from '../../debug/devControls'

function humanizeKind(kind: string): string {
  return kind.replace(/-/g, ' ')
}

export function StepperOverlay() {
  const [on, setOn] = useState(isStepMode())
  const [status, setStatus] = useState<StepStatus>(getStepStatus)

  useEffect(() => subscribeStepMode(setOn), [])
  useEffect(() => subscribeStepStatus(setStatus), [])

  useEffect(() => {
    if (!on) return
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (target?.isContentEditable) return
      if (ev.key === ' ' || ev.key === 'Enter' || ev.key === '.') {
        ev.preventDefault()
        advanceStep()
      } else if (ev.key === 'Escape') {
        ev.preventDefault()
        setStepMode(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [on])

  if (!on) return null

  const pendingLabel = status.label ? humanizeKind(status.label) : null

  return (
    <div className="stepper-overlay" role="region" aria-label="Step mode controls">
      <div className="stepper-overlay-header">
        <span className="stepper-overlay-title">STEP MODE</span>
        <span className="stepper-overlay-count" title="Steps advanced since enabling">
          #{status.count}
        </span>
      </div>
      <div className="stepper-overlay-pending">
        <span className="stepper-overlay-pending-label">Next</span>
        <span
          className={`stepper-overlay-pending-value ${
            status.pending ? 'is-ready' : 'is-waiting'
          }`}
          title={status.pending ? 'Ready to advance' : 'Waiting for next gated event'}
        >
          {pendingLabel ?? (status.pending ? 'event' : 'idle…')}
        </span>
      </div>
      <div className="stepper-overlay-actions">
        <button
          type="button"
          className="stepper-overlay-btn is-primary"
          onClick={advanceStep}
          disabled={!status.pending}
          title="Advance one event (Space / Enter / .)"
        >
          Step ▶
        </button>
        <button
          type="button"
          className="stepper-overlay-btn"
          onClick={() => setStepMode(false)}
          title="Resume normal playback (Esc)"
        >
          Resume
        </button>
      </div>
    </div>
  )
}
