import { useEffect, useRef } from 'react'
import { useGameStore } from '../../core/state/store'

export function useFightReset(onReset: () => void): void {
  const cbRef = useRef(onReset)
  useEffect(() => {
    cbRef.current = onReset
  }, [onReset])

  useEffect(() => {
    let prev = useGameStore.getState().fightCounter
    return useGameStore.subscribe((s) => {
      if (s.fightCounter === prev) return
      prev = s.fightCounter
      cbRef.current()
    })
  }, [])
}
