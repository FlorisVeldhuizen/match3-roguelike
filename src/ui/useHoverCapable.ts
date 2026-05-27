import { useEffect, useState } from 'react'

/** Primary input can hover (mouse / trackpad). Prefer over coarse pointer for tooltip open. */
export function useHoverCapable(): boolean {
  const [canHover, setCanHover] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(hover: hover)').matches : true,
  )

  useEffect(() => {
    const mql = window.matchMedia('(hover: hover)')
    const apply = () => setCanHover(mql.matches)
    apply()
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [])

  return canHover
}
