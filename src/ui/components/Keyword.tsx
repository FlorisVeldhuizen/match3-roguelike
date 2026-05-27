import { getKeyword, type KeywordId } from '../../content/keywords'
import { HoverTooltip, KEYWORD_SUBTOOLTIP_DELAY_MS } from './HoverTooltip'

export function Keyword({ id, children }: { id: KeywordId; children?: React.ReactNode }) {
  const def = getKeyword(id)
  return (
    <HoverTooltip
      title={def.name}
      body={def.body}
      variant={`kw-${def.variant}`}
      className={`kw kw-${def.variant}`}
      ariaLabel={`${def.name} — ${def.body}`}
      autoShow
      autoShowDelayMs={KEYWORD_SUBTOOLTIP_DELAY_MS}
    >
      {children ?? def.name}
    </HoverTooltip>
  )
}
