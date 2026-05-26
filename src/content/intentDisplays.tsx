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
  // tile-burn count, ally-buff stacks). Omitted for board verbs
  // (column-smash, petrify-row) because the only "number" they have
  // is a coordinate, which reads as a duration counter and confuses
  // players — the board overlay shows the location visually.
  number?: number
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
        // No badge number — the threat overlay shows the targeted column
        // visually. A coordinate here misreads as "lasts N turns". The
        // description still names the column so the player can confirm
        // which one the chevron points to.
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
        // Coordinate would be the gem-colour index — meaningless to the
        // player. The board overlay pulses every gem of that colour.
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
        // 🙌 names the shove *verb* on the enemy frame; the cell-level
        // markers handle source vs destination separately. The old `↗`
        // collided with the destination chevron and read as one icon
        // floating above the board with no clear ownership.
        icon: '🙌',
        // No badge number — the overlay shows source brackets + landing ring.
        label: `Shoves ${intent.sources.length} gems`,
        description: `Next turn, ${intent.sources.length} flagged gems get shoved to a new spot — their colours overwrite the destination cells. Match the source gems first to deny the shove.`,
      }
  }
}
