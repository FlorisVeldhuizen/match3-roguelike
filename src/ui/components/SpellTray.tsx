import { useGameStore } from '../../core/state/store'
import {
  listSpells,
  listUltimates,
} from '../../core/combat/spellRegistry'
import type { PendingSpellId } from '../../types'

// Spell + ultimate cast surface. Disabled when:
// - Not the player's phase
// - Cost can't be paid (mana / charge insufficient)
// - Spell already queued this phase (Bulwark/Reinforce lock per 01-design)
// "Board settled" gating (no cascade in flight) is a UX nicety the
// AnimationController could flag later; engine already permits.
export function SpellTray() {
  const phase = useGameStore((s) => s.fight.phase)
  const mana = useGameStore((s) => s.fight.player.mana)
  const charge = useGameStore((s) => s.fight.player.skillCharge)
  const pending = useGameStore((s) => s.fight.player.pendingSpells)
  const castSpell = useGameStore((s) => s.castSpell)
  const castUltimate = useGameStore((s) => s.castUltimate)
  const onPlayerPhase = phase === 'player-acting'

  return (
    <div className="spell-tray" aria-label="Spells">
      {listSpells().map((def) => {
        const queued = pending.includes(def.id)
        const canPay = mana >= def.manaCost
        const disabled = !onPlayerPhase || !canPay || queued
        return (
          <button
            key={def.id}
            type="button"
            className={`spell-btn${queued ? ' queued' : ''}${canPay && onPlayerPhase && !queued ? ' ready' : ''}`}
            disabled={disabled}
            onClick={() => castSpell(def.id)}
            title={`${def.name} (${def.manaCost} mana) — ${def.description}`}
            aria-label={`${def.name}, costs ${def.manaCost} mana. ${def.description}`}
          >
            <span className="spell-icon" aria-hidden>
              {def.icon}
            </span>
            <span className="spell-label">{def.name}</span>
            <span className="spell-cost" aria-hidden>
              {def.manaCost}
            </span>
          </button>
        )
      })}
      {listUltimates().map((def) => {
        const queued = pending.includes(def.id)
        const canPay = charge >= def.chargeCost
        const disabled = !onPlayerPhase || !canPay || queued
        return (
          <button
            key={def.id}
            type="button"
            className={`spell-btn ultimate${queued ? ' queued' : ''}${canPay && onPlayerPhase && !queued ? ' ready' : ''}`}
            disabled={disabled}
            onClick={() => castUltimate(def.id)}
            title={`${def.name} (full charge) — ${def.description}`}
            aria-label={`${def.name}, costs ${def.chargeCost} charge. ${def.description}`}
          >
            <span className="spell-icon" aria-hidden>
              {def.icon}
            </span>
            <span className="spell-label">{def.name}</span>
            <span className="spell-cost" aria-hidden>
              {def.chargeCost}⚡
            </span>
          </button>
        )
      })}
    </div>
  )
}

// Pending-effects strip: shows icons for spells cast this phase whose
// effects haven't resolved yet. Visibility only — the cast already
// happened on click (01-design §Spell-timing rule).
export function PendingStrip() {
  const pending = useGameStore((s) => s.fight.player.pendingSpells)
  if (pending.length === 0) return null
  return (
    <div className="pending-strip" aria-label="Pending spell effects">
      {pending.map((id) => (
        <span
          key={id}
          className={`pending-pip pending-${id}`}
          title={describePending(id)}
        >
          {pendingIcon(id)}
        </span>
      ))}
    </div>
  )
}

function pendingIcon(id: PendingSpellId): string {
  if (id === 'bulwark') return '🗡'
  if (id === 'reinforce') return '🛡'
  return '⚡'
}

function describePending(id: PendingSpellId): string {
  if (id === 'bulwark') return 'Bulwark queued — resolves at phase end'
  if (id === 'reinforce') return 'Reinforce queued — doubles block at phase end'
  return 'Riposte armed — parries the next enemy attack'
}
