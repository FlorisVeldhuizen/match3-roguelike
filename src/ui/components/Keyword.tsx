import { getKeyword, type KeywordId } from '../../content/keywords'
import { HoverTooltip } from './HoverTooltip'

// Inline highlighted keyword (Burn, Vulnerable, Block, ...). Hovering
// the word spawns a sub-tooltip with the keyword's definition — so a
// player reading an intent like "applies 2 Burn" can hover "Burn"
// without leaving the intent tooltip to recall what Burn does.
//
// Usage:
//   Apply 3 <Keyword id="burn" /> to target.   // canonical — number
//                                              // OUTSIDE the chip, just
//                                              // the keyword name inside
//   <Keyword id="block">armor</Keyword>        // override visible text
//                                              // (e.g. flavour synonym)
//
// Convention: status stack counts read **"N Keyword"**, never
// "Keyword N" — matches the intent-display pattern and Slay-the-Spire
// idiom. Put the number outside the chip; keep the chip as just the
// keyword name.
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
