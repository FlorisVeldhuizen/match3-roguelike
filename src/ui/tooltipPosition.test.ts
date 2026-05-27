import { describe, expect, it } from 'vitest'
import { placeNestedTooltip, rectFromBox, rectsOverlap } from './tooltipPosition'

describe('tooltipPosition', () => {
  it('rectsOverlap respects gap', () => {
    const a = rectFromBox(0, 0, 10, 10)
    const b = rectFromBox(12, 0, 10, 10)
    expect(rectsOverlap(a, b, 0)).toBe(false)
    expect(rectsOverlap(a, b, 3)).toBe(true)
  })

  it('placeNestedTooltip avoids trigger anchors below parent', () => {
    const parent = rectFromBox(100, 200, 180, 80)
    const button = rectFromBox(120, 320, 64, 64)
    const pos = placeNestedTooltip(parent, { width: 160, height: 60 }, [button], 8, {
      width: 400,
      height: 800,
    })
    const placed = rectFromBox(pos.left, pos.top, 160, 60)
    expect(rectsOverlap(placed, button, 8)).toBe(false)
    expect(pos.top).toBeLessThan(parent.top)
  })

  it('placeNestedTooltip prefers beside parent when not avoiding triggers', () => {
    const parent = rectFromBox(100, 200, 180, 80)
    const pos = placeNestedTooltip(
      parent,
      { width: 160, height: 60 },
      [],
      8,
      { width: 800, height: 600 },
      { stackedBelowBeforeAbove: true },
    )
    expect(pos.left).toBe(parent.right + 8)
  })
})
