import { useState } from 'react'
import { useGameStore } from '../../core/state/store'
import {
  getPendingMeta,
  listSpells,
  listUltimates,
} from '../../core/combat/spellRegistry'
import { canAffordSpell } from '../../core/combat/mana'
import { emitGameEvent } from '../../core/events/emitter'
import { MANA_CAPS, type ManaCost, type SpellId, type StatusKind } from '../../types'
import { HoverTooltip } from './HoverTooltip'
import { PurifyPickerModal } from './PurifyPickerModal'
import { FocusPickerModal } from './FocusPickerModal'
import { VolleyTargetModal } from './VolleyTargetModal'
import { useBoardSettled } from '../hooks/useBoardSettled'

// Spells whose cast needs args; clicking the tray button opens a picker
// modal rather than dispatching castSpell. Each modal calls its own
// store action (castPurify / castFocus / castVolley) on confirm.
const PICKER_SPELLS: ReadonlySet<SpellId> = new Set([
  'purify',
  'focus',
  'volley',
])

// Spells whose cast args come from a click on the board (gem or cell).
// Clicking the tray button enters targeting mode; BoardScene reads
// the next click and dispatches per-spell. Future Banish / Mark /
// Petrify-player slot in here.
const BOARD_TARGETING_SPELLS: ReadonlySet<SpellId> = new Set(['shatter'])

// Purify only acts on harmful statuses. Regen is beneficial; the
// player would never want to strip it, so the spell-tray gate
// excludes Regen-only state.
const PURIFIABLE: ReadonlySet<StatusKind> = new Set(['burn', 'vulnerable', 'weak'])

// Human-readable cost summary, e.g. "3 blue", "2 red, 1 yellow". Used in
// tooltips so the player knows the colour break-down at a glance.
function describeCost(cost: ManaCost): string {
  const parts: string[] = []
  if (cost.red) parts.push(`${cost.red} red`)
  if (cost.blue) parts.push(`${cost.blue} blue`)
  if (cost.green) parts.push(`${cost.green} green`)
  if (cost.yellow) parts.push(`${cost.yellow} yellow`)
  return parts.join(', ') || '0'
}

// Colour-coded mana pips on a spell button. One pip per colour in the
// cost, with the count next to it. Bulwark `{ blue: 3 }` → a single blue
// dot + "3". Multi-colour costs (future content) render multiple pips
// in canonical R/B/G/Y order so the layout is stable.
function ManaCostBadges({ cost }: { cost: ManaCost }) {
  const entries: { color: 'red' | 'blue' | 'green' | 'yellow'; amount: number }[] =
    []
  if (cost.red) entries.push({ color: 'red', amount: cost.red })
  if (cost.blue) entries.push({ color: 'blue', amount: cost.blue })
  if (cost.green) entries.push({ color: 'green', amount: cost.green })
  if (cost.yellow) entries.push({ color: 'yellow', amount: cost.yellow })
  if (entries.length === 0) {
    return <span className="spell-cost spell-cost-free">free</span>
  }
  return (
    <span className="spell-cost spell-cost-pips" aria-hidden>
      {entries.map((e) => (
        <span key={e.color} className={`spell-cost-pip pip-${e.color}`}>
          <span className="spell-cost-dot" data-color={e.color} aria-hidden />
          <span className="spell-cost-amount">{e.amount}</span>
        </span>
      ))}
    </span>
  )
}

// CSS flash duration on cast. Matches the spell-btn.just-cast keyframe
// in index.css. Anything that "released" was kept inside one beat to
// avoid double-cast confusion.
const CAST_FLASH_MS = 520

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
  const statuses = useGameStore((s) => s.fight.player.statuses)
  const enemies = useGameStore((s) => s.fight.enemies)
  const castSpell = useGameStore((s) => s.castSpell)
  const castUltimate = useGameStore((s) => s.castUltimate)
  // Board-pick UX state. Generic across all board-targeting spells
  // (Shatter is the first; Banish / Mark / Petrify-player will join).
  // The button toggles targeting on/off; BoardScene reads the spell id
  // and dispatches per-spell on the next gem click.
  const boardTargetingSpell = useGameStore((s) => s.boardTargetingSpell)
  const beginBoardTargeting = useGameStore((s) => s.beginBoardTargeting)
  const cancelBoardTargeting = useGameStore((s) => s.cancelBoardTargeting)
  const onPlayerPhase = phase === 'player-acting'
  // 01-design §Spell-timing: "cast window = player phase + board
  // settled + can pay cost". Without this gate, the spell-tray button
  // could be clicked during a cascade — the store's mana already
  // reflects the new match's gain but the HUD chip is still mid-trail
  // (700ms behind), so the player sees "0 yellow" and casts anyway.
  const boardSettled = useBoardSettled()
  // Which picker modal is currently open (null = none). Set on button
  // click for picker-spells; cleared by the modal on confirm/cancel.
  const [pickerOpen, setPickerOpen] = useState<SpellId | null>(null)

  // Per-button "just cast" flash. Single concurrent timer per button id;
  // a re-cast (can't happen now, but reserved for relics that refund
  // pending) cleanly restarts the flash via the key bump.
  const [flashKey, setFlashKey] = useState<Record<string, number>>({})
  const flashCast = (id: string) => {
    setFlashKey((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
    window.setTimeout(() => {
      setFlashKey((prev) => {
        if ((prev[id] ?? 0) <= 0) return prev
        return { ...prev, [id]: Math.max(0, (prev[id] ?? 0) - 1) }
      })
    }, CAST_FLASH_MS)
  }

  return (
    <div className="spell-tray" aria-label="Spells">
      {listSpells().map((def) => {
        const queued = pending.includes(def.id)
        const canPay = canAffordSpell(mana, def.cost)
        // H4a per-spell extra gates beyond mana/queued:
        // - Purify: needs at least one harmful status (Regen doesn't count)
        // - Focus: needs at least one source colour with mana AND one
        //   non-source colour with cap headroom
        // - Volley / Ignite / Brittle / Cinder Lash: need a living target
        const livingEnemy = enemies.some((e) => e.hp > 0)
        let extraBlock = false
        let extraReason: string | null = null
        if (
          def.id === 'purify' &&
          !statuses.some((s) => PURIFIABLE.has(s.kind))
        ) {
          extraBlock = true
          extraReason = 'No curses to purify.'
        } else if (def.id === 'focus') {
          const haveSource =
            mana.red >= 1 ||
            mana.blue >= 1 ||
            mana.green >= 1 ||
            mana.yellow >= 1
          const haveTarget =
            MANA_CAPS.red - mana.red >= 1 ||
            MANA_CAPS.blue - mana.blue >= 1 ||
            MANA_CAPS.green - mana.green >= 1 ||
            MANA_CAPS.yellow - mana.yellow >= 1
          if (!haveSource || !haveTarget) {
            extraBlock = true
            extraReason = 'Nothing useful to convert right now.'
          }
        } else if (
          (def.id === 'volley' ||
            def.id === 'ignite' ||
            def.id === 'brittle' ||
            def.id === 'cinder-lash') &&
          !livingEnemy
        ) {
          extraBlock = true
          extraReason = 'No targets left.'
        }
        const blocked =
          !onPlayerPhase || !boardSettled || !canPay || queued || extraBlock
        const costSummary = describeCost(def.cost)
        const reason = queued
          ? 'Already cast this turn.'
          : !onPlayerPhase
            ? "Wait for your turn."
            : !boardSettled
              ? 'Wait for the board to settle.'
              : !canPay
                ? `Not enough mana — needs ${costSummary}.`
                : extraReason
        return (
          <HoverTooltip
            key={def.id}
            variant="spell"
            title={`${def.name} — ${costSummary} mana`}
            body={
              <>
                <div>{def.description}</div>
                {reason && <div className="hover-tooltip-reason">{reason}</div>}
              </>
            }
            ariaLabel={`${def.name}, costs ${costSummary} mana`}
          >
            <button
              type="button"
              className={`spell-btn${queued ? ' queued' : ''}${canPay && onPlayerPhase && !queued ? ' ready' : ''}${blocked ? ' is-disabled' : ''}${(flashKey[def.id] ?? 0) > 0 ? ' just-cast' : ''}${boardTargetingSpell === def.id ? ' is-targeting' : ''}`}
              // key re-mount on cast so the .just-cast keyframe replays
              // even if rapid casts land within the same flash window.
              key={`${def.id}-${flashKey[def.id] ?? 0}`}
              aria-disabled={blocked}
              onClick={() => {
                if (blocked) return
                // Board-targeting spells (Shatter; future Banish / Mark
                // / Petrify-player) toggle a mode; BoardScene picks up
                // the next gem click and fires the cast. Re-clicking
                // the same button while in targeting mode cancels.
                if (BOARD_TARGETING_SPELLS.has(def.id)) {
                  if (boardTargetingSpell === def.id) {
                    cancelBoardTargeting()
                  } else {
                    beginBoardTargeting(def.id)
                  }
                  return
                }
                // Picker-arg spells open a modal; the modal dispatches
                // the dedicated cast action (castCleanse / castFocus /
                // castVolley) on confirm. Cast-flash plays only on the
                // direct-cast path; picker flow runs through the modal.
                if (PICKER_SPELLS.has(def.id)) {
                  setPickerOpen(def.id)
                  return
                }
                const res = castSpell(def.id)
                if (res.ok) {
                  for (const ev of res.events) emitGameEvent(ev)
                  flashCast(def.id)
                }
              }}
            >
              <span className="spell-icon" aria-hidden>
                {def.icon}
              </span>
              <span className="spell-label">{def.name}</span>
              <ManaCostBadges cost={def.cost} />
            </button>
          </HoverTooltip>
        )
      })}
      {listUltimates().map((def) => {
        const queued = pending.includes(def.id)
        const canPay = charge >= def.chargeCost
        const blocked = !onPlayerPhase || !boardSettled || !canPay || queued
        const reason = queued
          ? 'Already armed — waiting for them to attack.'
          : !onPlayerPhase
            ? "Wait for your turn."
            : !boardSettled
              ? 'Wait for the board to settle.'
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
                const res = castUltimate(def.id)
                if (res.ok) {
                  for (const ev of res.events) emitGameEvent(ev)
                }
              }}
            >
              <span className="spell-icon" aria-hidden>
                {def.icon}
              </span>
              <span className="spell-label">{def.name}</span>
              {/* Ultimate cost uses the purple gem pip (same visual
                  language as the charge chip in the HUD) instead of a
                  loose ⚡. Players were reading the ⚡ on Riposte's
                  card and the purple gem in the HUD as two separate
                  resources — now they match. */}
              <span className="spell-cost spell-cost-pips" aria-hidden>
                <span className="spell-cost-pip pip-purple">
                  <span className="spell-cost-dot" data-color="purple" aria-hidden />
                  <span className="spell-cost-amount">{def.chargeCost}</span>
                </span>
              </span>
            </button>
          </HoverTooltip>
        )
      })}
      {pickerOpen === 'purify' && (
        <PurifyPickerModal onClose={() => setPickerOpen(null)} />
      )}
      {pickerOpen === 'focus' && (
        <FocusPickerModal onClose={() => setPickerOpen(null)} />
      )}
      {pickerOpen === 'volley' && (
        <VolleyTargetModal onClose={() => setPickerOpen(null)} />
      )}
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
