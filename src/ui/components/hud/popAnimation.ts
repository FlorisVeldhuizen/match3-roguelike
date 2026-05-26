import { useEffect, useRef, useState } from 'react'

export type PopState = { key: number; dir: -1 | 0 | 1 }

export function usePopOnChange(value: number): PopState {
  const [state, setState] = useState<PopState>({ key: 0, dir: 0 })
  const prev = useRef(value)
  useEffect(() => {
    if (prev.current === value) return
    const dir: -1 | 1 = value > prev.current ? 1 : -1
    prev.current = value
    setState((s) => ({ key: s.key + 1, dir }))
  }, [value])
  return state
}

export function popClass(p: PopState) {
  if (p.key === 0) return 'value-pop'
  return p.dir > 0 ? 'value-pop value-pop-up' : 'value-pop value-pop-down'
}
