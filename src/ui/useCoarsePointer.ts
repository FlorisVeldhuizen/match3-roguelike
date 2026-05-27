import { useEffect, useState } from 'react'

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(pointer: coarse), (hover: none)').matches
      : false,
  )

  useEffect(() => {
    const mql = window.matchMedia('(pointer: coarse), (hover: none)')
    const apply = () => setCoarse(mql.matches)
    apply()
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [])

  return coarse
}
