import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import MarketingCaseResults from '@/components/landing/MarketingCaseResults.vue'

describe('public award and qualification evidence', () => {
  const wrappers: VueWrapper[] = []

  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open') })
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => [{ width: 10, height: 10 }] as unknown as DOMRectList)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'scroll'
  })

  afterEach(() => {
    wrappers.splice(0).forEach(wrapper => wrapper.unmount())
    document.body.innerHTML = ''
    document.body.style.overflow = ''
    document.documentElement.style.overflow = ''
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function render(kind?: 'course' | 'competition') {
    const wrapper = mount(MarketingCaseResults, { props: kind ? { kind } : {}, attachTo: document.body })
    wrappers.push(wrapper)
    return wrapper
  }

  async function openCertificate(wrapper: VueWrapper, triggerId = 'award-open-certificate') {
    const trigger = wrapper.get(`[data-testid="${triggerId}"]`)
    ;(trigger.element as HTMLButtonElement).focus()
    await trigger.trigger('click')
    await flushPromises()
    const dialog = document.querySelector<HTMLDialogElement>('[data-testid="certificate-viewer"]')!
    expect(dialog).not.toBeNull()
    expect(dialog.open).toBe(true)
    return { dialog, trigger }
  }

  it.each([undefined, 'competition'] as const)('anchors the %s award in the sixth 2025 final, not the current ninth competition', kind => {
    const wrapper = render(kind)
    const award = wrapper.get('.case-competition')
    expect(award.text()).toContain('2025')
    expect(award.text()).toContain('第六届')
    expect(award.text()).toContain('全国总决赛')
    expect(award.text()).toContain('一等奖')
    expect(award.text()).not.toContain('第九届')
    expect(award.text()).not.toMatch(/官方认证工具|官方指定工具|保证提分|保证获奖|百分之百/)
    expect(award.get('.case-before').text()).toContain('60分')
    expect(award.get('.case-award').text()).toContain('一等奖')
    expect(award.find('.case-score-bars').exists()).toBe(false)
    expect(award.find('.case-difference').exists()).toBe(false)
    const certificate = award.get('[data-testid="award-open-certificate"] img')
    expect(certificate.attributes('src')).toContain('competition-award-2025-thumb.webp')
    expect(certificate.attributes('width')).toBe('640')
    expect(certificate.attributes('height')).toBe('905')
    expect(certificate.attributes('src')).not.toMatch(/^https?:/)
    expect(certificate.attributes('alt')).toMatch(/一等奖|获奖|证书/)
    expect(wrapper.get('.case-note').text()).toContain('用户提供')
  })

  it('keeps the secondary credential as a competition-only link without a team qualification section', () => {
    const homepage = render()
    const course = render('course')
    expect(homepage.find('[data-testid="team-qualification"]').exists()).toBe(false)
    expect(homepage.find('[data-testid="qualification-open-certificate"]').exists()).toBe(false)
    expect(course.find('.case-competition').exists()).toBe(false)
    expect(course.find('[data-testid="award-open-certificate"]').exists()).toBe(false)
    expect(course.find('[data-testid="team-qualification"]').exists()).toBe(false)
    expect(course.find('[data-testid="qualification-open-certificate"]').exists()).toBe(false)
    const competition = render('competition')
    expect(competition.find('[data-testid="team-qualification"]').exists()).toBe(false)
    const qualification = competition.get('[data-testid="qualification-open-certificate"]')
    expect(competition.get('.qualification-achievement').text()).toContain('获得全国一等奖，同时取得跨境电子商务师（中级）职业能力证书')
    expect(qualification.text()).toContain('中级')
    expect(qualification.text()).not.toMatch(/官方认证工具|官方指定工具|全国一等奖|第九届/)
    expect(competition.text()).not.toMatch(/团队专业能力|团队资质/)
  })

  it('opens the redacted award in one accessible viewer and returns focus on close', async () => {
    const wrapper = render()
    const { dialog, trigger } = await openCertificate(wrapper)
    expect(document.querySelectorAll('[data-testid="certificate-viewer"]')).toHaveLength(1)
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dialog.querySelector('img')?.getAttribute('src')).toContain('competition-award-2025-redacted.jpg')
    expect(dialog.querySelector('[data-testid="certificate-zoom-in"]')).not.toBeNull()
    expect(dialog.querySelector('[data-testid="certificate-zoom-out"]')).not.toBeNull()
    expect(dialog.querySelector('[data-testid="certificate-fit"]')).not.toBeNull()
    expect(document.body.style.overflow).toBe('hidden')
    dialog.querySelector<HTMLButtonElement>('[data-testid="certificate-close"]')!.click()
    await flushPromises()
    expect(document.querySelector('[data-testid="certificate-viewer"]')).toBeNull()
    expect(document.body.style.overflow).toBe('auto')
    expect(document.documentElement.style.overflow).toBe('scroll')
    expect(document.activeElement).toBe(trigger.element)
  })

  it('opens the secondary vocational credential and closes it with Escape', async () => {
    const wrapper = render('competition')
    const { dialog, trigger } = await openCertificate(wrapper, 'qualification-open-certificate')
    expect(dialog.querySelector('img')?.getAttribute('src')).toContain('team-qualification-redacted.jpg')
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.querySelector('[data-testid="certificate-viewer"]')).toBeNull()
    expect(document.activeElement).toBe(trigger.element)
    expect(document.body.style.overflow).toBe('auto')
  })

  it('handles native cancel and leaves no overlay or scroll lock when the owner unmounts', async () => {
    const wrapper = render()
    const { dialog, trigger } = await openCertificate(wrapper)
    dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true }))
    await flushPromises()
    expect(document.querySelector('[data-testid="certificate-viewer"]')).toBeNull()
    expect(document.activeElement).toBe(trigger.element)
    await openCertificate(wrapper)
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    wrapper.unmount()
    expect(document.querySelector('[data-testid="certificate-viewer"]')).toBeNull()
    expect(document.body.style.overflow).toBe('auto')
    expect(document.documentElement.style.overflow).toBe('scroll')
  })

  it('keeps keyboard focus inside the viewer instead of moving to background links', async () => {
    const { dialog } = await openCertificate(render())
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'))
    const first = controls[0]!
    const last = controls.at(-1)!
    expect(controls.length).toBeGreaterThanOrEqual(4)
    expect(last.getAttribute('role')).toBe('region')
    expect(last.getAttribute('aria-label')).toContain('滚动')
    first.focus()
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(last)
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(first)
  })

  it('supports zooming and fitting the certificate without changing the page or losing the close control', async () => {
    const { dialog } = await openCertificate(render())
    const zoomIn = dialog.querySelector<HTMLButtonElement>('[data-testid="certificate-zoom-in"]')!
    const zoomOut = dialog.querySelector<HTMLButtonElement>('[data-testid="certificate-zoom-out"]')!
    const canvas = dialog.querySelector<HTMLElement>('.certificate-image-canvas')!
    expect(zoomOut.disabled).toBe(true)
    expect(canvas.style.width).toBe('100%')
    zoomIn.click()
    await flushPromises()
    expect(canvas.style.width).toBe('150%')
    expect(dialog.querySelector('output')?.textContent).toBe('150%')
    expect(zoomOut.disabled).toBe(false)
    for (let i = 0; i < 3; i++) {
      zoomIn.click()
      await flushPromises()
    }
    expect(canvas.style.width).toBe('300%')
    expect(zoomIn.disabled).toBe(true)
    dialog.querySelector<HTMLButtonElement>('[data-testid="certificate-fit"]')!.click()
    await flushPromises()
    expect(canvas.style.width).toBe('100%')
    expect(zoomOut.disabled).toBe(true)
    expect(dialog.querySelector('[data-testid="certificate-close"]')).not.toBeNull()
  })

  it('keeps the certificate controls in a pinched mobile viewport and cleans up its listeners', async () => {
    const viewport = Object.assign(new EventTarget(), { scale: 1.5, width: 260, height: 560, offsetLeft: 18, offsetTop: 10 })
    vi.stubGlobal('visualViewport', viewport)
    const remove = vi.spyOn(viewport, 'removeEventListener')
    const { dialog } = await openCertificate(render())
    expect(dialog.style.width).toBe('260px')
    expect(dialog.style.height).toBe('560px')
    expect(dialog.style.left).toBe('18px')
    viewport.offsetLeft = 40
    viewport.dispatchEvent(new Event('scroll'))
    await flushPromises()
    expect(dialog.style.left).toBe('40px')
    viewport.scale = 1
    viewport.dispatchEvent(new Event('resize'))
    await flushPromises()
    expect(dialog.style.width).toBe('')
    dialog.querySelector<HTMLButtonElement>('[data-testid="certificate-close"]')!.click()
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
  })

  it('reveals the award only once after it enters view and disconnects on unmount', async () => {
    let callback: IntersectionObserverCallback | undefined
    const observe = vi.fn()
    const unobserve = vi.fn()
    const disconnect = vi.fn()
    class Observer {
      constructor(next: IntersectionObserverCallback) { callback = next }
      observe = observe
      unobserve = unobserve
      disconnect = disconnect
    }
    vi.stubGlobal('IntersectionObserver', Observer)
    const wrapper = render()
    const award = wrapper.get('.case-competition')
    const entry = (ratio: number) => ({ target: award.element, isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry)
    expect(observe).toHaveBeenCalledWith(award.element)
    expect(award.classes()).not.toContain('award-entered')
    callback!([entry(0.1)], {} as IntersectionObserver)
    await wrapper.vm.$nextTick()
    expect(award.classes()).not.toContain('award-entered')
    callback!([entry(1)], {} as IntersectionObserver)
    await wrapper.vm.$nextTick()
    expect(award.classes()).toContain('award-entered')
    expect(unobserve).toHaveBeenCalledExactlyOnceWith(award.element)
    callback!([entry(0), entry(1)], {} as IntersectionObserver)
    await wrapper.vm.$nextTick()
    expect(unobserve).toHaveBeenCalledTimes(1)
    expect(award.classes()).toContain('award-entered')
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalled()
  })

  it('keeps full award text and certificate access for reduced motion or missing observers', () => {
    const observer = vi.fn()
    vi.stubGlobal('IntersectionObserver', observer)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const reduced = render('competition')
    expect(observer).not.toHaveBeenCalled()
    expect(reduced.get('.case-competition').text()).toContain('一等奖')
    expect(reduced.get('[data-testid="award-open-certificate"]').isVisible()).toBe(true)
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    const fallback = render()
    expect(fallback.get('.case-competition').text()).toContain('2025')
    expect(fallback.get('[data-testid="award-open-certificate"]').isVisible()).toBe(true)
  })
})
