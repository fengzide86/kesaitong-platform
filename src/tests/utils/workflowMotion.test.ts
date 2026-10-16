import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrollToWorkflowTarget } from '@/shared/ui/workflowMotion'

function createTarget(reduced = false) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced })))
  const element = document.createElement('section')
  const input = document.createElement('input')
  element.append(input)
  document.body.append(element)
  const scrollIntoView = vi.fn()
  const focus = vi.spyOn(input, 'focus')
  const animation = { cancel: vi.fn(), onfinish: null as null | (() => void) }
  const animate = vi.fn(() => animation)
  Object.assign(element, { scrollIntoView, animate })
  return { element, scrollIntoView, input, focus, animate, animation }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('scrollToWorkflowTarget', () => {
  it('locates a normal-motion target and highlights only its edge once', () => {
    const target = createTarget()
    scrollToWorkflowTarget(target.element)
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(target.animate).toHaveBeenCalledTimes(1)
    const [frames, options] = target.animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions]
    expect(options).toEqual({ duration: 600, easing: 'cubic-bezier(0.2, 0, 0, 1)' })
    expect(frames).toHaveLength(3)
    expect(frames.every(frame => Object.keys(frame).every(key => ['boxShadow', 'offset'].includes(key)))).toBe(true)
    expect(frames[1]?.boxShadow).toContain('3px rgba(45, 95, 202, .2)')
  })

  it('immediately focuses the requested input without waiting for scrolling or animation', () => {
    const target = createTarget()
    scrollToWorkflowTarget(target.element, { block: 'start', focusSelector: 'input' })
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(target.focus.mock.invocationCallOrder[0]).toBeLessThan(target.scrollIntoView.mock.invocationCallOrder[0]!)
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('uses immediate scrolling, retains focus and does not animate with reduced motion', () => {
    const target = createTarget(true)
    scrollToWorkflowTarget(target.element, { focusSelector: 'input', block: 'nearest' })
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'nearest' })
    expect(target.animate).not.toHaveBeenCalled()
  })

  it('does nothing for an absent target', () => {
    const target = createTarget()
    expect(() => scrollToWorkflowTarget(null)).not.toThrow()
    expect(() => scrollToWorkflowTarget(undefined)).not.toThrow()
    expect(target.animate).not.toHaveBeenCalled()
    expect(target.scrollIntoView).not.toHaveBeenCalled()
  })

  it('still scrolls when the browser has no Web Animations API or optional focus target', () => {
    const target = createTarget()
    Object.assign(target.element, { animate: undefined })
    expect(() => scrollToWorkflowTarget(target.element, { focusSelector: 'textarea' })).not.toThrow()
    expect(target.scrollIntoView).toHaveBeenCalledOnce()
    expect(target.focus).not.toHaveBeenCalled()
  })

  it('keeps focus and navigation functional if decorative animation is unsupported', () => {
    const target = createTarget()
    target.animate.mockImplementation(() => { throw new Error('Animation unsupported') })
    expect(() => scrollToWorkflowTarget(target.element, { focusSelector: 'input' })).not.toThrow()
    expect(target.focus).toHaveBeenCalledOnce()
    expect(target.scrollIntoView).toHaveBeenCalledOnce()
  })

  it('does not stack highlights after repeated clicks or a preference change', () => {
    const target = createTarget()
    scrollToWorkflowTarget(target.element)
    scrollToWorkflowTarget(target.element)
    expect(target.animation.cancel).toHaveBeenCalledTimes(1)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    scrollToWorkflowTarget(target.element)
    expect(target.animation.cancel).toHaveBeenCalledTimes(2)
    expect(target.animate).toHaveBeenCalledTimes(2)
    expect(target.scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'instant', block: 'center' })
  })

  it('keeps an existing surface shadow throughout the highlight', () => {
    const target = createTarget()
    target.element.style.boxShadow = '0 1px 2px black'
    target.element.style.setProperty('--color-focus-ring', 'rgba(10, 20, 30, .2)')
    const originalShadow = window.getComputedStyle(target.element).boxShadow
    expect(originalShadow).not.toBe('')
    scrollToWorkflowTarget(target.element)
    const [frames] = target.animate.mock.calls[0] as unknown as [Keyframe[]]
    expect(frames.every(frame => String(frame.boxShadow).startsWith(`${originalShadow}, `))).toBe(true)
    expect(frames[1]?.boxShadow).toContain('rgba(10, 20, 30, .2)')
  })

  it('works without matchMedia and drops a completed highlight', () => {
    const target = createTarget()
    vi.stubGlobal('matchMedia', undefined)
    scrollToWorkflowTarget(target.element)
    target.animation.onfinish?.()
    scrollToWorkflowTarget(target.element)
    expect(target.animation.cancel).not.toHaveBeenCalled()
    expect(target.scrollIntoView).toHaveBeenCalledTimes(2)
  })
})
