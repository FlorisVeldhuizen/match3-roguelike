import { useEffect, useRef } from 'react'
import { subscribeGameEvents } from '../../core/events/emitter'

export function useBoardWipe(onWipe: () => void): void {
  const cbRef = useRef(onWipe)
  useEffect(() => {
    cbRef.current = onWipe
  }, [onWipe])

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (event.kind === 'board-shuffled' || event.kind === 'board-swept') {
        cbRef.current()
      }
    })
  }, [])
}
