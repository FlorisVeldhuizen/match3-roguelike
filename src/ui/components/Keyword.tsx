import { getKeyword, type KeywordId } from '../../content/keywords'
import { HoverTooltip } from './HoverTooltip'
import { useEffect, useState } from 'react'

export function Keyword({
  id,
  children,
}: {
  id: KeywordId
  children?: React.ReactNode
}) {
  const def = getKeyword(id)
  const [coarsePointer, setCoarsePointer] = useState(false)

  useEffect(() => {
    const mql =
      typeof window !== 'undefined'
        ? window.matchMedia?.('(pointer: coarse), (hover: none)')
        : null
    if (!mql) return
    const apply = () => setCoarsePointer(Boolean(mql.matches))
    apply()
    mql.addEventListener?.('change', apply)
    return () => mql.removeEventListener?.('change', apply)
  }, [])
  return (
    <HoverTooltip
      title={def.name}
      body={def.body}
      variant={`kw-${def.variant}`}
      className={`kw kw-${def.variant}`}
      ariaLabel={`${def.name} — ${def.body}`}
      autoShow={!coarsePointer}
    >
      {children ?? def.name}
    </HoverTooltip>
  )
}
