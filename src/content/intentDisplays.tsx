import type { ReactNode } from 'react'
import type { Intent } from '../types'
import { getStatusDef } from './statuses'
import { Keyword } from '../ui/components/Keyword'

// Per-intent-kind display data. Single source of truth for what the
// player sees on the intent badge + the hover tooltip. Replaces the
// 4 parallel if/else chains (intentNumber, intentIcon, intentLabel,
// intentDescription) that EnemyFrame.tsx used to carry. Adding a new
// intent kind = one new case in this switch, with the icon, badge
// number, label, and tooltip description co-located.
//
// Why a switch (not a `Record<IntentKind, ...>` registry)? Each case
// narrows the intent type automatically, so the dynamic field
// accesses (`intent.amount`, `intent.column`, `intent.onHit`, etc.)
// stay strictly typed with zero casts. Exhaustive checks come free —
// TS will fail to compile if a new IntentKind lands without a case.

export type IntentDisplay = {
  icon: string
  // Badge number. Magnitude for damage-y intents (attack amount,
  // tile-burn count, ally-buff stacks), index for board verbs
  // (column-smash → column, petrify-row → row). The board verbs are
  // outliers but it's still the most relevant single integer to show.
  number: number
  // Short tooltip-title sentence. Verbal but compressed.
  label: string
  // Longer tooltip body. May embed inline <Keyword/> chips that
  // surface the related keyword's sub-tooltip on hover.
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
        number: intent.column,
        label: `Smashes column ${intent.column}`,
        description: `Next turn, this column is smashed — every gem in it that isn't matched first is cleared with no payout. Match the threatened gems to deny the smash.`,
      }
    case 'petrify-row':
      return {
        icon: '🪨',
        number: intent.row,
        label: `Petrifies row ${intent.row}`,
        description: `Next turn, this row is petrified — matches anchored on these cells are blocked for the duration. Cascades still flow through.`,
      }
  }
}
