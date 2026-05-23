import { useGameStore } from '../../core/state/store'
import {
  getPendingMeta,
  listSpells,
  listUltimates,
} from '../../core/combat/spellRegistry'
import { HoverTooltip } from './HoverTooltip'

// Spell + ultimate cast surface. Disabled (visually + functionally) when:
// - Not the player's phase
// - Cost can't be paid (mana / charge insufficient)
// - Spell already queued this phase (Bulwark/Reinforce lock per 01-design)
// Tooltip stays available regardless of state so the player can read what
// a spell does before they have the resources to cast it.
//
// We use aria-disabled instead of the native `disabled` attribute so the
// button still fires hover/focus events (HoverTooltip needs them on
// pointer targets) while skipping the cast on click.
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
        const blocked = !onPlayerPhase || !canPay || queued
        const reason = queued
          ? 'Already cast this turn.'
          : !onPlayerPhase
            ? "Wait for your turn."
            : !canPay
              ? `Not enough mana — needs ${def.manaCost}, you have ${mana}.`
              : null
        return (
          <HoverTooltip
            key={def.id}
            variant="spell"
            title={`${def.name} — ${def.manaCost} mana`}
            body={
              <>
                <div>{def.description}</div>
                {reason && <div className="hover-tooltip-reason">{reason}</div>}
              </>
            }
            ariaLabel={`${def.name}, costs ${def.manaCost} mana`}
          >
            <button
              type="button"
              className={`spell-btn${queued ? ' queued' : ''}${canPay && onPlayerPhase && !queued ? ' ready' : ''}${blocked ? ' is-disabled' : ''}`}
              aria-disabled={blocked}
              onClick={() => {
                if (blocked) return
                castSpell(def.id)
              }}
            >
              <span className="spell-icon" aria-hidden>
                {def.icon}
              </span>
              <span className="spell-label">{def.name}</span>
              <span className="spell-cost" aria-hidden>
                {def.manaCost}
              </span>
            </button>
          </HoverTooltip>
        )
      })}
      {listUltimates().map((def) => {
        const queued = pending.includes(def.id)
        const canPay = charge >= def.chargeCost
        const blocked = !onPlayerPhase || !canPay || queued
        const reason = queued
          ? 'Already armed — waiting for them to attack.'
          : !onPlayerPhase
            ? "Wait for your turn."
            : !canPay
              ? `Not charged up yet — needs ${def.chargeCost}, you have ${charge}.`
              : null
        return (
          <HoverTooltip
            key={def.id}
            variant="ultimate"
            title={`${def.name} — ${def.chargeCost} charge`}
            body={
              <>
                <div>{def.description}</div>
                {reason && <div className="hover-tooltip-reason">{reason}</div>}
              </>
            }
            ariaLabel={`${def.name}, costs ${def.chargeCost} charge`}
          >
            <button
              type="button"
              className={`spell-btn ultimate${queued ? ' queued' : ''}${canPay && onPlayerPhase && !queued ? ' ready' : ''}${blocked ? ' is-disabled' : ''}`}
              aria-disabled={blocked}
              onClick={() => {
                if (blocked) return
                castUltimate(def.id)
              }}
            >
              <span className="spell-icon" aria-hidden>
                {def.icon}
              </span>
              <span className="spell-label">{def.name}</span>
              <span className="spell-cost" aria-hidden>
                {def.chargeCost}⚡
              </span>
            </button>
          </HoverTooltip>
        )
      })}
    </div>
  )
}

// Pending-effects strip: shows icons for spells cast this phase whose
// effects haven't resolved yet. Visibility only — the cast already
// happened on click (01-design §Spell-timing rule). All copy (icon,
// name, label, description) comes from the spell registry so the
// pending strip stays in sync with the spell list automatically.
export function PendingStrip() {
  const pending = useGameStore((s) => s.fight.player.pendingSpells)
  if (pending.length === 0) return null
  return (
    <div className="pending-strip" aria-label="Pending spell effects">
      {pending.map((id) => {
        const meta = getPendingMeta(id)
        return (
          <HoverTooltip
            key={id}
            variant="pending"
            title={`${meta.name} — ${meta.pendingLabel}`}
            body={meta.pendingDescription}
          >
            <span className={`pending-pip pending-${id}`}>{meta.icon}</span>
          </HoverTooltip>
        )
      })}
    </div>
  )
}
