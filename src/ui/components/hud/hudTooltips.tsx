import type { ReactNode } from 'react'
import { Keyword } from '../Keyword'

export function hudHpTooltipBody(): ReactNode {
  return (
    <div>
      Your <Keyword id="hp">HP</Keyword>. Restored by <Keyword id="heal">healing</Keyword> and lost
      to enemy attacks and effects.
    </div>
  )
}

export function hudRedManaTooltipBody(): ReactNode {
  return (
    <div>
      <strong>Red gems</strong> damage enemies when matched and add{' '}
      <Keyword id="mana">mana</Keyword> here for attack spells.
    </div>
  )
}

export function hudBlueManaTooltipBody(): ReactNode {
  return (
    <div>
      <strong>Blue gems</strong> build toward your <Keyword id="block">armor</Keyword> (shield) and
      add <Keyword id="mana">mana</Keyword> for defensive spells.
    </div>
  )
}

export function hudGreenManaTooltipBody(): ReactNode {
  return (
    <div>
      <strong>Green gems</strong> <Keyword id="heal">heal</Keyword> you when matched and add{' '}
      <Keyword id="mana">mana</Keyword> for healing spells.
    </div>
  )
}

export function hudWildManaTooltipBody(): ReactNode {
  return (
    <div>
      <strong>Yellow gems</strong> only add <Keyword id="wildMana">wild mana</Keyword> — no direct
      combat effect on match.
    </div>
  )
}

export function hudArmorTooltipTitle(opts: { value: number; hasPending: boolean }): string {
  return opts.hasPending ? `Armor (building) — ${opts.value}` : `Armor — ${opts.value}`
}

export function hudArmorTooltipBody(opts: {
  value: number
  hasPending: boolean
  isActive: boolean
}): ReactNode {
  if (opts.value <= 0) {
    return (
      <div>
        Match blue gems to gain <Keyword id="block">armor</Keyword> for the upcoming enemy turn.
      </div>
    )
  }

  // During your turn, blue matches increase the blue pool; it is finalized into Armor at end-of-turn.
  if (opts.hasPending) {
    return (
      <div>
        Armor you’re building from blue matches this turn. Finalized when you end your turn (some
        effects can modify it).
      </div>
    )
  }

  if (opts.isActive) {
    return (
      <div>
        Your <Keyword id="block">armor</Keyword> absorbs damage before <Keyword id="hp">HP</Keyword>{' '}
        until your next turn unless an effect carries it.
      </div>
    )
  }

  return (
    <div>
      Your <Keyword id="block">armor</Keyword> absorbs damage before <Keyword id="hp">HP</Keyword>.
    </div>
  )
}

export function hudGoldTooltipBody(): ReactNode {
  return (
    <>
      <div>
        From <strong>gold gems</strong> on the board and <strong>fight rewards</strong>. Spend at
        shops.
      </div>
      <div className="hover-tooltip-aside">Kept for the whole run.</div>
    </>
  )
}
