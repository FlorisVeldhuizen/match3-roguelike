import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { TRAIL_ARRIVAL_MS } from '../../timing'
import { useFightReset } from '../hooks/useFightReset'
import { BOARD_HEIGHT, BOARD_WIDTH } from '../../types'
import type { GemColor } from '../../types'
import { CellAnchor } from './CellAnchor'

type HexState = { turnsLeft: number; expiring: boolean }

const FIZZLE_MS = 1200

export function ColorHexOverlay() {
  const [hexStates, setHexStates] = useState<Map<GemColor, HexState>>(new Map())
  const cells = useGameStore((s) => s.board.cells)

  const seedFromStore = useCallback(() => {
    const s = useGameStore.getState()
    const next = new Map<GemColor, HexState>()
    for (const h of s.fight.hexedColors ?? []) {
      next.set(h.color, { turnsLeft: h.turnsLeft, expiring: false })
    }
    setHexStates(next)
  }, [])

  useLayoutEffect(() => {
    seedFromStore()
  }, [seedFromStore])

  useFightReset(
    useCallback(() => {
      setHexStates(new Map())
      seedFromStore()
    }, [seedFromStore]),
  )

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'color-hex-fired') {
        const color = event.color
        const turnsLeft = event.turnsLeft
        const scheduledFight = useGameStore.getState().fightCounter
        window.setTimeout(() => {
          if (useGameStore.getState().fightCounter !== scheduledFight) return
          setHexStates((prev) => {
            const next = new Map(prev)
            next.set(color, { turnsLeft, expiring: false })
            return next
          })
        }, TRAIL_ARRIVAL_MS)
      } else if (event.kind === 'color-hex-ticked') {
        const color = event.color
        const remaining = event.remaining
        if (remaining > 0) {
          setHexStates((prev) => {
            if (!prev.has(color)) return prev
            const next = new Map(prev)
            next.set(color, { turnsLeft: remaining, expiring: false })
            return next
          })
        } else {
          const scheduledFight = useGameStore.getState().fightCounter
          setHexStates((prev) => {
            if (!prev.has(color)) return prev
            const next = new Map(prev)
            next.set(color, { turnsLeft: 0, expiring: true })
            return next
          })
          window.setTimeout(() => {
            if (useGameStore.getState().fightCounter !== scheduledFight) return
            setHexStates((prev) => {
              if (!prev.has(color)) return prev
              const cur = prev.get(color)
              if (!cur?.expiring) return prev
              const next = new Map(prev)
              next.delete(color)
              return next
            })
          }, FIZZLE_MS)
        }
      }
    })
  }, [])

  if (hexStates.size === 0) return null

  const anchors: ReactNode[] = []
  for (let y = 0; y < BOARD_HEIGHT; y++) {
    const row = cells[y]
    if (!row) continue
    for (let x = 0; x < BOARD_WIDTH; x++) {
      const cell = row[x]
      if (!cell) continue
      const state = hexStates.get(cell.gemColor)
      if (!state) continue
      const cls = state.expiring
        ? 'color-hex-cell is-expiring'
        : state.turnsLeft <= 1
          ? 'color-hex-cell active is-weakening'
          : 'color-hex-cell active'
      anchors.push(<CellAnchor key={`hex-${x}-${y}`} x={x} y={y} className={cls} />)
    }
  }

  return (
    <div className="color-hex-overlay" aria-hidden>
      {anchors}
    </div>
  )
}
