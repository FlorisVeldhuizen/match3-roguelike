import { useEffect, useState } from 'react'
import { subscribeGameEvents } from '../../core/events/emitter'

export function useBoardSettled(): boolean {
  const [settled, setSettled] = useState(true)

  useEffect(() => {
    return subscribeGameEvents((event) => {
      if (
        event.kind === 'swap' ||
        event.kind === 'swap-reverted' ||
        event.kind === 'gems-transmuted'
      ) {
        setSettled(false)
      } else if (event.kind === 'gameplay-settled') {
        setSettled(true)
      }
    })
  }, [])

  return settled
}
