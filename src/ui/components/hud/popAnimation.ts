import { useEffect, useRef, useState } from 'react'

// Tiny pop-on-change primitive used by the HUD value displays (HP, mana,
// charge, block). Each value gets its own `usePopOnChange` so a yellow
// mana match doesn't pulse the red chip, etc. The returned PopState's
// `key` is used as a React key on the number span so the popup
// re-mounts and replays its keyframe animation on each change.
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
