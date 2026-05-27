import { getKeyword, type KeywordId } from '../../content/keywords'
import { HoverTooltip, KEYWORD_SUBTOOLTIP_DELAY_MS } from './HoverTooltip'

export function Keyword({
  id,
  children,
  standalone,
}: {
  id: KeywordId
  children?: React.ReactNode
  /** Direct hover tooltip (e.g. enemy badges), not nested inside another tooltip. */
  standalone?: boolean
}) {
  const def = getKeyword(id)
  return (
    <HoverTooltip
      title={def.name}
      body={def.body}
      variant={`kw-${def.variant}`}
      className={`kw kw-${def.variant}`}
      ariaLabel={`${def.name} — ${def.body}`}
      autoShow={!standalone}
      autoShowDelayMs={standalone ? 0 : KEYWORD_SUBTOOLTIP_DELAY_MS}
    >
      {children ?? def.name}
    </HoverTooltip>
  )
}
