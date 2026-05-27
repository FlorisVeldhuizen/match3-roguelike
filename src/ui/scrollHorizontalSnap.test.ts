import { describe, expect, it, vi } from 'vitest'
import { scrollHorizontalSnap } from './scrollHorizontalSnap'

vi.stubGlobal(
  'getComputedStyle',
  vi.fn(() => ({
    scrollPaddingLeft: '30px',
    scrollPaddingInline: '30px',
  })),
)

function mockRect(left: number, width: number) {
  const right = left + width
  return { left, right, top: 0, bottom: 0, width, height: 0, x: left, y: 0, toJSON: () => ({}) }
}

function mockItem(left: number, width = 104) {
  const rect = mockRect(left, width)
  return {
    getBoundingClientRect: () => rect,
    scrollIntoView: () => {},
  } as unknown as HTMLElement
}

describe('scrollHorizontalSnap', () => {
  it('scrolls to the next card after the leading one (not the card already at the edge)', () => {
    const leading = mockItem(130)
    const next = mockItem(238)
    const items = [leading, next, mockItem(346)]
    const scrollEl = {
      scrollLeft: 78,
      clientWidth: 300,
      scrollWidth: 600,
      getBoundingClientRect: () => mockRect(100, 300),
      querySelectorAll: () => items,
      scrollTo: () => {},
    } as unknown as HTMLElement

    let scrolledTo: HTMLElement | undefined
    next.scrollIntoView = () => {
      scrolledTo = next
    }

    scrollHorizontalSnap(scrollEl, 1, { behavior: 'auto' })

    expect(scrolledTo).toBe(next)
  })

  it('scrolls to the first off-screen card when aligned at scrollLeft 0', () => {
    const leading = mockItem(130)
    const next = mockItem(238)
    const items = [leading, next]
    const scrollEl = {
      scrollLeft: 0,
      clientWidth: 300,
      scrollWidth: 500,
      getBoundingClientRect: () => mockRect(100, 300),
      querySelectorAll: () => items,
      scrollTo: () => {},
    } as unknown as HTMLElement

    let scrolledTo: HTMLElement | undefined
    leading.scrollIntoView = () => {
      scrolledTo = leading
    }
    next.scrollIntoView = () => {
      scrolledTo = next
    }

    scrollHorizontalSnap(scrollEl, 1, { behavior: 'auto' })

    // Leading card sits at scroll-padding; second card is the first past the edge.
    expect(scrolledTo).toBe(next)
  })
})
