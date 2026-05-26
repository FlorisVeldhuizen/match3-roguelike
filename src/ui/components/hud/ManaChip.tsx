import { type ReactNode } from 'react'
import type { GemColor } from '../../../types'
import { HoverTooltip } from '../HoverTooltip'
import { popClass, type PopState } from './popAnimation'

export function ManaChip({
  color,
  value,
  cap,
  pop,
  pulsing,
  wild,
  title,
  body,
}: {
  color: GemColor
  value: number
  cap: number
  pop: PopState
  pulsing: boolean
  wild?: boolean
  title: string
  body: ReactNode
}) {
  return (
    <HoverTooltip
      variant="mana"
      title={`${title} — ${value}/${cap}`}
      body={body}
      ariaLabel={`${title}: ${value} of ${cap}`}
    >
      <span
        className={`mana-chip mana-${color}${wild ? ' mana-wild' : ''}${pulsing ? ' pulsing' : ''}${value >= cap ? ' is-capped' : ''}`}
        data-mana-target={color}
        data-pool-target={color === 'yellow' ? 'yellow' : undefined}
      >
        <span className="mana-dot" data-color={color} aria-hidden />
        <span className="mana-value">
          <span key={pop.key} className={popClass(pop)}>{value}</span>
          <span className="mana-cap">/{cap}</span>
        </span>
      </span>
    </HoverTooltip>
  )
}
