import { getKeyword, type KeywordId } from '../../content/keywords'
import { HoverTooltip } from './HoverTooltip'

// Inline highlighted keyword (Burn, Vulnerable, Block, ...). Hovering
// the word spawns a sub-tooltip with the keyword's definition — so a
// player reading an intent like "Hits for 3, applies Burn 2" can hover
// "Burn" without leaving the intent tooltip to recall what Burn does.
//
// Usage:
//   <Keyword id="burn" />          // renders the keyword name
//   <Keyword id="burn">Burn 2</Keyword>  // override the visible text
//                                        (useful for "Burn N" inline)
export function Keyword({
  id,
  children,
}: {
  id: KeywordId
  children?: React.ReactNode
}) {
  const def = getKeyword(id)
  return (
    <HoverTooltip
      title={def.name}
      body={def.body}
      variant={`kw-${def.variant}`}
      className={`kw kw-${def.variant}`}
      ariaLabel={`${def.name} — ${def.body}`}
      // Auto-show: the sub-tooltip appears alongside its parent
      // tooltip as soon as the keyword is mounted (i.e. the parent is
      // open). No need to hover the inline word — the definition is
      // there immediately, docked next to the parent.
      autoShow
    >
      {children ?? def.name}
    </HoverTooltip>
  )
}
