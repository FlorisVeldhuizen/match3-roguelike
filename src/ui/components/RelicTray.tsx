import { useEffect, useState } from 'react'
import { useGameStore } from '../../core/state/store'
import { subscribeGameEvents } from '../../core/events/emitter'
import { tryGetRelic } from '../../core/relics/registry'

export function RelicTray() {
  const relics = useGameStore((s) => s.fight.player.relics)
  const [pulsing, setPulsing] = useState<Record<string, number>>({})

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind !== 'relic-triggered' && event.kind !== 'relic-gained') return
      const id = event.relicId
      setPulsing((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }))
      window.setTimeout(() => {
        setPulsing((p) => {
          const next = { ...p }
          const v = (next[id] ?? 0) - 1
          if (v <= 0) delete next[id]
          else next[id] = v
          return next
        })
      }, 600)
    })
  }, [])

  if (relics.length === 0) return null

  return (
    <div className="relic-tray" aria-label="Relics">
      {relics.map((inst) => {
        const def = tryGetRelic(inst.id)
        if (!def) return null
        const pulse = (pulsing[inst.id] ?? 0) > 0
        return (
          <div
            key={inst.id}
            className={`relic-slot rarity-${def.rarity} ${pulse ? 'pulse' : ''}`}
            tabIndex={0}
          >
            <span className="relic-icon" aria-hidden>
              {def.icon}
            </span>
            <div className="relic-tooltip" role="tooltip">
              <div className="relic-tooltip-name">{def.name}</div>
              <div className="relic-tooltip-rarity">{def.rarity}</div>
              <div className="relic-tooltip-desc">{def.description}</div>
              {def.orderHint ? (
                <div className="relic-tooltip-hint">{def.orderHint}</div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
