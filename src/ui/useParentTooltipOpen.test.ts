import { describe, expect, it } from 'vitest'
import { readParentTooltipOpen } from './useParentTooltipOpen'

describe('readParentTooltipOpen', () => {
  it('is false without a parent tooltip', () => {
    expect(readParentTooltipOpen(null)).toBe(false)
  })

  it('is true when parent has is-visible', () => {
    const parent = {
      closest: () => ({
        classList: { contains: (c: string) => c === 'is-visible' },
      }),
    } as unknown as HTMLElement
    expect(readParentTooltipOpen(parent)).toBe(true)
  })

  it('is false when parent is fading out', () => {
    const parent = {
      closest: () => ({
        classList: { contains: () => false },
      }),
    } as unknown as HTMLElement
    expect(readParentTooltipOpen(parent)).toBe(false)
  })
})
