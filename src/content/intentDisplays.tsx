import type { ReactNode } from 'react'
import type { Intent } from '../types'
import { getStatusDef } from './statuses'
import { Keyword } from '../ui/components/Keyword'

export type IntentDisplay = {
  icon: string
  number?: number
  label: string
  description: ReactNode
}

export function intentDisplay(intent: Intent): IntentDisplay {
  switch (intent.kind) {
    case 'attack': {
      const onHit = intent.onHit
      if (onHit) {
        const def = getStatusDef(onHit.status)
        return {
          icon: '⚔',
          number: intent.amount,
          label: `Attacks for ${intent.amount} (applies ${onHit.stacks} ${def.name} on hit)`,
          description: (
            <>
              Will hit you for {intent.amount} next turn. If it lands, you also
              gain {onHit.stacks} <Keyword id={onHit.status} />.
            </>
          ),
        }
      }
      return {
        icon: '⚔',
        number: intent.amount,
        label: `Attacks for ${intent.amount}`,
        description: `Will hit you for ${intent.amount} next turn.`,
      }
    }
    case 'block':
      return {
        icon: '🛡',
        number: intent.amount,
        label: `Blocks for ${intent.amount}`,
        description: (
          <>
            Armored for {intent.amount} — your attacks chip through this{' '}
            <Keyword id="block">block</Keyword> first.
          </>
        ),
      }
    case 'tile-burn':
      return {
        icon: '🔥',
        number: intent.count,
        label: `Sets ${intent.count} tile${intent.count === 1 ? '' : 's'} on fire`,
        description: (
          <>
            Next turn, sets {intent.count} tile{intent.count === 1 ? '' : 's'}{' '}
            on fire. Match a burning tile and you take <Keyword id="burn" /> —
            bigger matches mean longer, fiercer burns.
          </>
        ),
      }
    case 'heal-ally':
      return {
        icon: '❤️',
        number: intent.amount,
        label: `Heals ally for ${intent.amount}`,
        description: `Restores ${intent.amount} HP to an ally next turn.`,
      }
    case 'buff-ally':
      return {
        icon: '🔱',
        number: intent.stacks,
        label: `Buffs ally with ${intent.stacks} Strength`,
        description: `Grants ${intent.stacks} Strength to an ally — their attacks deal extra damage.`,
      }
    case 'shield-ally':
      return {
        icon: '🛡',
        number: intent.amount,
        label: `Shields ally for ${intent.amount}`,
        description: `Adds ${intent.amount} block to an ally next turn.`,
      }
    case 'column-smash':
      return {
        icon: '💥',
        label: `Smashes column ${intent.column + 1}`,
        description: `Next turn, column ${intent.column + 1} is smashed — every gem in it that isn't matched first is cleared with no payout. Match the threatened gems to deny the smash.`,
      }
    case 'petrify-row':
      return {
        icon: '🪨',
        label: `Petrifies row ${intent.row + 1}`,
        description: `Next turn, row ${intent.row + 1} is petrified for 2 phases — its gems are locked (can't be swapped) and matches can't originate there. Cascades and matches anchored elsewhere can still flow through.`,
      }
    case 'color-hex': {
      const colorName =
        intent.color.charAt(0).toUpperCase() + intent.color.slice(1)
      return {
        icon: '🔮',
        label: `Hexes ${colorName}`,
        description: (
          <>
            Next turn, {colorName} gems are hexed. Matching them while the
            hex is up piles on <Keyword id="weak" /> (one stack per gem
            cleared, stacks add up). Wait it out or burn through the cost.
          </>
        ),
      }
    }
    case 'cluster-shove':
      return {
        icon: '🙌',
        label: `Shoves ${intent.sources.length} gems`,
        description: `Next turn, ${intent.sources.length} flagged gems get shoved to a new spot — their colours overwrite the destination cells. Match the source gems first to deny the shove.`,
      }
  }
}
