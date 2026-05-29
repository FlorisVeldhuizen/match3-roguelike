import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useGameStore } from '../../core/state/store'
import {
  getPendingMeta,
  getSpell,
  isUltimateId,
  listSpellsForTray,
  listUltimates,
} from '../../core/combat/spellRegistry'
import { isUnlockAllSpells, subscribeUnlockAllSpells } from '../../debug/devControls'
import { canAffordSpell } from '../../core/combat/mana'
import {
  MANA_CAPS,
  type Enemy,
  type ManaCost,
  type ManaPools,
  type PendingSpellId,
  type SpellId,
  type StatusInstance,
  type StatusKind,
} from '../../types'
import type { SpellDef } from '../../core/combat/spellRegistry'
import { HoverTooltip } from './HoverTooltip'
import { PurifyPickerModal } from './PurifyPickerModal'
import { FocusPickerModal } from './FocusPickerModal'
import { TransmutePickerModal } from './TransmutePickerModal'
import { VolleyTargetModal } from './VolleyTargetModal'
import { useBoardSettled } from '../hooks/useBoardSettled'
import { useHoldSmoothScroll } from '../hooks/useHoldSmoothScroll'
import { useHorizontalScrollHints } from '../hooks/useHorizontalScrollHints'
import { useSpellTrayScrollTouch } from '../hooks/useSpellTrayScrollTouch'
import { primaryManaRgb, spellManaClassName } from '../spellManaTheme'
import { playBoardSpellEvents } from '../../core/board/spellPlayback'

const PICKER_SPELLS: ReadonlySet<SpellId> = new Set(['purify', 'focus', 'volley', 'transmute'])

const BOARD_TARGETING_SPELLS: ReadonlySet<SpellId> = new Set(['shatter', 'frozen-wall'])

const PURIFIABLE: ReadonlySet<StatusKind> = new Set(['burn', 'vulnerable', 'weak'])

function describeCost(cost: ManaCost): string {
  const parts: string[] = []
  if (cost.red) parts.push(`${cost.red} red`)
  if (cost.blue) parts.push(`${cost.blue} blue`)
  if (cost.green) parts.push(`${cost.green} green`)
  if (cost.yellow) parts.push(`${cost.yellow} yellow`)
  return parts.join(', ') || '0'
}

function ManaCostBadges({ cost }: { cost: ManaCost }) {
  const entries: { color: 'red' | 'blue' | 'green' | 'yellow'; amount: number }[] = []
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

// Matches the spell-btn.just-cast keyframe in index.css
const CAST_FLASH_MS = 520

function spellExtraBlock(
  spellId: SpellId,
  mana: ManaPools,
  statuses: StatusInstance[],
  enemies: Enemy[],
): boolean {
  const livingEnemy = enemies.some((e) => e.hp > 0)
  if (spellId === 'purify' && !statuses.some((s) => PURIFIABLE.has(s.kind))) {
    return true
  }
  if (spellId === 'focus') {
    const haveSource = mana.red >= 1 || mana.blue >= 1 || mana.green >= 1 || mana.yellow >= 1
    const haveTarget =
      MANA_CAPS.red - mana.red >= 1 ||
      MANA_CAPS.blue - mana.blue >= 1 ||
      MANA_CAPS.green - mana.green >= 1 ||
      MANA_CAPS.yellow - mana.yellow >= 1
    return !haveSource || !haveTarget
  }
  if (
    (spellId === 'volley' ||
      spellId === 'ignite' ||
      spellId === 'brittle' ||
      spellId === 'cinder-lash') &&
    !livingEnemy
  ) {
    return true
  }
  return false
}

function isSpellButtonBlocked(
  def: SpellDef,
  opts: {
    onPlayerPhase: boolean
    boardSettled: boolean
    mana: ManaPools
    pending: PendingSpellId[]
    statuses: StatusInstance[]
    enemies: Enemy[]
  },
): boolean {
  const queued = opts.pending.includes(def.id)
  const canPay = canAffordSpell(opts.mana, def.cost)
  const extraBlock = spellExtraBlock(def.id, opts.mana, opts.statuses, opts.enemies)
  return !opts.onPlayerPhase || !opts.boardSettled || !canPay || queued || extraBlock
}

function spellExtraReason(
  spellId: SpellId,
  mana: ManaPools,
  statuses: StatusInstance[],
  enemies: Enemy[],
): string | null {
  if (spellId === 'purify' && !statuses.some((s) => PURIFIABLE.has(s.kind))) {
    return 'No curses to purify.'
  }
  if (spellId === 'focus') {
    const haveSource = mana.red >= 1 || mana.blue >= 1 || mana.green >= 1 || mana.yellow >= 1
    const haveTarget =
      MANA_CAPS.red - mana.red >= 1 ||
      MANA_CAPS.blue - mana.blue >= 1 ||
      MANA_CAPS.green - mana.green >= 1 ||
      MANA_CAPS.yellow - mana.yellow >= 1
    if (!haveSource || !haveTarget) {
      return 'Nothing useful to convert right now.'
    }
  }
  if (
    (spellId === 'volley' ||
      spellId === 'ignite' ||
      spellId === 'brittle' ||
      spellId === 'cinder-lash') &&
    !enemies.some((e) => e.hp > 0)
  ) {
    return 'No targets left.'
  }
  return null
}

function spellTouchActionHint(spellId: SpellId): string {
  if (BOARD_TARGETING_SPELLS.has(spellId)) {
    return 'Tap again, then tap a gem on the board.'
  }
  if (PICKER_SPELLS.has(spellId)) {
    return 'Tap again to choose targets.'
  }
  return 'Tap again to cast.'
}

function spellTouchOpenAnnounce(name: string, spellId: SpellId): string {
  if (BOARD_TARGETING_SPELLS.has(spellId)) {
    return `${name}. Tap again, then choose a gem.`
  }
  if (PICKER_SPELLS.has(spellId)) {
    return `${name}. Tap again to choose targets.`
  }
  return `${name}. Tap again to cast.`
}

export function SpellTray() {
  const phase = useGameStore((s) => s.fight.phase)
  const mana = useGameStore((s) => s.fight.player.mana)
  const charge = useGameStore((s) => s.fight.player.skillCharge)
  const pending = useGameStore((s) => s.fight.player.pendingSpells)
  const statuses = useGameStore((s) => s.fight.player.statuses)
  const enemies = useGameStore((s) => s.fight.enemies)
  const ownedSpellIds = useGameStore((s) => s.fight.player.ownedSpellIds)
  const castSpell = useGameStore((s) => s.castSpell)
  const castUltimate = useGameStore((s) => s.castUltimate)
  const boardTargetingSpell = useGameStore((s) => s.boardTargetingSpell)
  const beginBoardTargeting = useGameStore((s) => s.beginBoardTargeting)
  const cancelBoardTargeting = useGameStore((s) => s.cancelBoardTargeting)
  const [unlockAll, setUnlockAll] = useState(isUnlockAllSpells)
  useEffect(() => subscribeUnlockAllSpells(setUnlockAll), [])
  const onPlayerPhase = phase === 'player-acting'
  const boardSettled = useBoardSettled()
  const [pickerOpen, setPickerOpen] = useState<SpellId | null>(null)
  const traySpells = listSpellsForTray(ownedSpellIds, unlockAll)
  const trayUltimates = listUltimates()
  const {
    ref: trayScrollRef,
    canScrollStart,
    canScrollEnd,
    hasOverflow,
    scrollByDirection,
    snapToNearest,
  } = useHorizontalScrollHints(traySpells.length, trayUltimates.length, unlockAll)

  const chevronScrollStart = useHoldSmoothScroll(
    trayScrollRef,
    -1,
    () => scrollByDirection(-1),
    !canScrollStart,
    { onHoldEnd: snapToNearest },
  )
  const chevronScrollEnd = useHoldSmoothScroll(
    trayScrollRef,
    1,
    () => scrollByDirection(1),
    !canScrollEnd,
    { onHoldEnd: snapToNearest },
  )

  const [trayDismissTick, setTrayDismissTick] = useState(0)
  const bumpTrayDismiss = useCallback(() => setTrayDismissTick((t) => t + 1), [])
  const { didDragRef } = useSpellTrayScrollTouch(trayScrollRef, bumpTrayDismiss)

  const [flashKey, setFlashKey] = useState<Record<string, number>>({})
  const [tooltipCloseTick, setTooltipCloseTick] = useState<Record<string, number>>({})
  const bumpTooltipClose = (id: string) => {
    setTooltipCloseTick((prev) => ({
      ...prev,
      [id]: (prev[id] ?? 0) + 1,
    }))
  }
  const flashCast = (id: string) => {
    setFlashKey((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }))
    window.setTimeout(() => {
      setFlashKey((prev) => {
        if ((prev[id] ?? 0) <= 0) return prev
        return { ...prev, [id]: Math.max(0, (prev[id] ?? 0) - 1) }
      })
    }, CAST_FLASH_MS)
  }

  const shellClass = [
    'spell-tray-shell',
    hasOverflow ? 'has-overflow' : '',
    canScrollStart ? 'can-scroll-start' : '',
    canScrollEnd ? 'can-scroll-end' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={shellClass}>
      <button
        type="button"
        className="spell-tray-chevron spell-tray-chevron-start"
        aria-label="Scroll spells left"
        disabled={!canScrollStart}
        onContextMenu={(e) => e.preventDefault()}
        {...chevronScrollStart}
      />
      <div className="spell-tray-viewport">
        <div
          ref={trayScrollRef}
          className="spell-tray-scroll"
          aria-describedby={hasOverflow ? 'spell-tray-more-hint' : undefined}
        >
          <div className="spell-tray" aria-label="Spells">
      {traySpells.map((def) => {
        const trayCtx = {
          onPlayerPhase,
          boardSettled,
          mana,
          pending,
          statuses,
          enemies,
        }
        const queued = pending.includes(def.id)
        const canPay = canAffordSpell(mana, def.cost)
        const blocked = isSpellButtonBlocked(def, trayCtx)
        const extraReason = spellExtraReason(def.id, mana, statuses, enemies)
        const costSummary = describeCost(def.cost)
        const manaTheme = spellManaClassName(def.cost)
        const castRgb = primaryManaRgb(def.cost)
        const reason = queued
          ? 'Already cast this turn.'
          : !onPlayerPhase
            ? 'Wait for your turn.'
            : !boardSettled
              ? 'Wait for the board to settle.'
              : !canPay
                ? `Not enough mana — needs ${costSummary}.`
                : extraReason
        const touchHint = !blocked ? spellTouchActionHint(def.id) : undefined
        const touchAnnounce = !blocked ? spellTouchOpenAnnounce(def.name, def.id) : undefined
        return (
          <HoverTooltip
            key={def.id}
            variant="spell"
            queued={queued}
            closeTick={(tooltipCloseTick[def.id] ?? 0) + trayDismissTick}
            touchActionHint={touchHint}
            touchOpenAnnounce={touchAnnounce}
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
              className={`spell-btn ${manaTheme}${queued ? ' queued' : ''}${canPay && onPlayerPhase && !queued ? ' ready' : ''}${blocked ? ' is-disabled' : ''}${(flashKey[def.id] ?? 0) > 0 ? ' just-cast' : ''}${boardTargetingSpell === def.id ? ' is-targeting' : ''}`}
              key={`${def.id}-${flashKey[def.id] ?? 0}`}
              data-spell-target={def.id}
              style={
                {
                  '--spell-cast-rgb': castRgb,
                } as CSSProperties
              }
              aria-disabled={blocked}
              onClick={() => {
                if (didDragRef.current || blocked) return
                if (BOARD_TARGETING_SPELLS.has(def.id)) {
                  if (boardTargetingSpell === def.id) {
                    cancelBoardTargeting()
                  } else {
                    beginBoardTargeting(def.id)
                  }
                  return
                }
                if (PICKER_SPELLS.has(def.id)) {
                  bumpTooltipClose(def.id)
                  setPickerOpen(def.id)
                  return
                }
                const res = castSpell(def.id)
                if (res.ok) {
                  const after = useGameStore.getState().fight
                  if (
                    isSpellButtonBlocked(def, {
                      onPlayerPhase: after.phase === 'player-acting',
                      boardSettled,
                      mana: after.player.mana,
                      pending: after.player.pendingSpells,
                      statuses: after.player.statuses,
                      enemies: after.enemies,
                    })
                  ) {
                    bumpTooltipClose(def.id)
                  }
                  void playBoardSpellEvents(res.events)
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
      {trayUltimates.map((def) => {
        const queued = pending.includes(def.id)
        const canPay = charge >= def.chargeCost
        const blocked = !onPlayerPhase || !boardSettled || !canPay || queued
        const reason = queued
          ? 'Already armed — waiting for them to attack.'
          : !onPlayerPhase
            ? 'Wait for your turn.'
            : !boardSettled
              ? 'Wait for the board to settle.'
              : !canPay
                ? `Not charged up yet — needs ${def.chargeCost}, you have ${charge}.`
                : null
        const ultimateTouchHint = !blocked ? 'Tap again to arm.' : undefined
        const ultimateTouchAnnounce = !blocked ? `${def.name}. Tap again to arm.` : undefined
        return (
          <HoverTooltip
            key={def.id}
            variant="ultimate"
            queued={queued}
            closeTick={(tooltipCloseTick[def.id] ?? 0) + trayDismissTick}
            touchActionHint={ultimateTouchHint}
            touchOpenAnnounce={ultimateTouchAnnounce}
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
              className={`spell-btn ultimate spell-mana-purple${queued ? ' queued' : ''}${canPay && onPlayerPhase && !queued ? ' ready' : ''}${blocked ? ' is-disabled' : ''}${(flashKey[def.id] ?? 0) > 0 ? ' just-cast' : ''}`}
              key={`${def.id}-${flashKey[def.id] ?? 0}`}
              data-spell-target={def.id}
              aria-disabled={blocked}
              onClick={() => {
                if (didDragRef.current || blocked) return
                const res = castUltimate(def.id)
                if (res.ok) {
                  const after = useGameStore.getState().fight
                  const ultimateBlocked =
                    after.phase !== 'player-acting' ||
                    !boardSettled ||
                    after.player.pendingSpells.includes(def.id) ||
                    after.player.skillCharge < def.chargeCost
                  if (ultimateBlocked) {
                    bumpTooltipClose(def.id)
                  }
                  void playBoardSpellEvents(res.events)
                  flashCast(def.id)
                }
              }}
            >
              <span className="spell-icon" aria-hidden>
                {def.icon}
              </span>
              <span className="spell-label">{def.name}</span>
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
          </div>
        </div>
        {hasOverflow ? (
          <span id="spell-tray-more-hint" className="spell-tray-scroll-hint sr-only">
            Swipe sideways to see more spells
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="spell-tray-chevron spell-tray-chevron-end"
        aria-label="Scroll spells right"
        disabled={!canScrollEnd}
        onContextMenu={(e) => e.preventDefault()}
        {...chevronScrollEnd}
      />
      {pickerOpen != null &&
        createPortal(
          <>
            {pickerOpen === 'purify' && (
              <PurifyPickerModal onClose={() => setPickerOpen(null)} />
            )}
            {pickerOpen === 'focus' && <FocusPickerModal onClose={() => setPickerOpen(null)} />}
            {pickerOpen === 'transmute' && (
              <TransmutePickerModal onClose={() => setPickerOpen(null)} />
            )}
            {pickerOpen === 'volley' && <VolleyTargetModal onClose={() => setPickerOpen(null)} />}
          </>,
          document.body,
        )}
    </div>
  )
}

export function PendingStrip() {
  const pending = useGameStore((s) => s.fight.player.pendingSpells)
  if (pending.length === 0) return null
  return (
    <div className="pending-strip" aria-label="Pending spell effects">
      {pending.map((id) => {
        const meta = getPendingMeta(id)
        const manaTheme = isUltimateId(id)
          ? 'spell-mana-purple'
          : spellManaClassName(getSpell(id).cost)
        return (
          <HoverTooltip
            key={id}
            variant="pending"
            title={`${meta.name} — ${meta.pendingLabel}`}
            body={meta.pendingDescription}
          >
            <span className={`pending-pip pending-${id} ${manaTheme}`}>{meta.icon}</span>
          </HoverTooltip>
        )
      })}
    </div>
  )
}
