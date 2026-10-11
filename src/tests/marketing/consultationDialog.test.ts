import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import MarketingConsultationDialog from '@/components/landing/MarketingConsultationDialog.vue'

describe('in-place marketing tool consultation', () => {
  let wrapper: VueWrapper | undefined
  let trigger: HTMLButtonElement
  const writeText = vi.fn()

  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')) })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(1234)
    writeText.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { userAgent: navigator.userAgent, clipboard: { writeText } })
    document.body.style.overflow = 'auto'
    document.body.style.paddingRight = '6px'
    document.documentElement.style.overflow = 'scroll'
    document.documentElement.style.scrollBehavior = 'smooth'
    document.documentElement.style.overflowAnchor = 'auto'
    trigger = document.createElement('button')
    trigger.textContent = '咨询这个工具'
    document.body.append(trigger)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
    document.documentElement.style.overflow = ''
    document.documentElement.style.scrollBehavior = ''
    document.documentElement.style.overflowAnchor = ''
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function enter(task = '发布商品') {
    wrapper = mount(MarketingConsultationDialog, { props: { wechat: 'Moweiiong' }, attachTo: document.body })
    const instance = wrapper.vm as unknown as { openConsultation: (task: string, event: Event) => Promise<void> }
    trigger.addEventListener('click', event => { void instance.openConsultation(task, event) })
    trigger.focus()
    trigger.click()
    await flushPromises()
    return document.querySelector<HTMLDialogElement>('[data-testid="marketing-consultation-dialog"]')!
  }

  it('shows only the selected task and real public WeChat without navigating away', async () => {
    const modal = await enter('订单发货')
    expect(modal.open).toBe(true)
    expect(modal.querySelector('h2')?.textContent).toBe('咨询订单发货')
    expect(modal.querySelector<HTMLInputElement>('input')?.value).toBe('Moweiiong')
    expect(modal.querySelectorAll('a, form')).toHaveLength(0)
    expect(modal.textContent).not.toMatch(/kst\.example|二维码待接入|预览演示|模拟咨询/)
    expect(document.activeElement).toBe(modal.querySelector('[data-testid="consultation-close"]'))
    const checklist = modal.querySelector('[aria-label="开通前核对清单"]')
    expect(checklist?.textContent).toContain('平台与版本')
    expect(checklist?.textContent).toContain('设备额度与支持方式')
    expect(checklist?.textContent).toContain('官网模拟体验不代表真实工具已开放')
  })

  it('locks both scroll surfaces and restores the exact styles, position and initiating focus', async () => {
    const modal = await enter()
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.documentElement.style.scrollBehavior).toBe('auto')
    expect(document.documentElement.style.overflowAnchor).toBe('none')
    expect(window.scrollTo).toHaveBeenCalledWith({ left: 0, top: 1234, behavior: 'instant' })
    const focus = vi.spyOn(trigger, 'focus')
    modal.querySelector<HTMLButtonElement>('[data-testid="consultation-close"]')!.click()
    await flushPromises()
    expect(document.querySelector('[data-testid="marketing-consultation-dialog"]')).toBeNull()
    expect(document.body.style.overflow).toBe('auto')
    expect(document.body.style.paddingRight).toBe('6px')
    expect(document.documentElement.style.overflow).toBe('scroll')
    expect(document.documentElement.style.scrollBehavior).toBe('smooth')
    expect(document.documentElement.style.overflowAnchor).toBe('auto')
    expect(window.scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 1234, behavior: 'instant' })
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(document.activeElement).toBe(trigger)
  })

  it('contains keyboard navigation and supports Escape without a page move', async () => {
    const modal = await enter()
    const controls = modal.querySelectorAll<HTMLElement>('button, input')
    controls[0]!.focus()
    controls[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(controls[controls.length - 1])
    controls[controls.length - 1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(controls[0])
    controls[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(document.documentElement.style.overflow).toBe('scroll')
  })

  it.each(['copied', 'manual'])('provides %s clipboard feedback without closing or moving the page', async state => {
    if (state === 'manual') writeText.mockRejectedValue(new Error('Clipboard permission denied'))
    const modal = await enter()
    modal.querySelector<HTMLButtonElement>('[data-testid="consultation-copy"]')!.click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledExactlyOnceWith('Moweiiong')
    expect(modal.querySelector('[role="status"]')?.textContent).toContain(state === 'copied' ? '微信号已复制' : '请选择上方微信号手动复制')
    expect(modal.open).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')
    const input = modal.querySelector<HTMLInputElement>('input')!
    input.click()
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('Moweiiong'.length)
  })

  it('releases scroll locks when the owner unmounts during a pending copy', async () => {
    let finishCopy: (() => void) | undefined
    writeText.mockImplementation(() => new Promise<void>(resolve => { finishCopy = resolve }))
    const modal = await enter()
    modal.querySelector<HTMLButtonElement>('[data-testid="consultation-copy"]')!.click()
    wrapper!.unmount()
    wrapper = undefined
    finishCopy?.()
    await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
    expect(document.body.style.overflow).toBe('auto')
    expect(document.documentElement.style.overflow).toBe('scroll')
    expect(document.activeElement).toBe(trigger)
  })
})
