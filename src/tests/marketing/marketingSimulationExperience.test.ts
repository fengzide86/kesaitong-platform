import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import MarketingSimulationExperience from '@/components/landing/MarketingSimulationExperience.vue'

const lifecycle = vi.hoisted(() => ({ mounted: 0, stopped: 0 }))

vi.mock('@/marketing/demo/v2/V2SimulationView.vue', async () => {
  const { defineComponent, h, onMounted, onUnmounted, ref } = await import('vue')
  return {
    default: defineComponent({
      props: { embedded: Boolean, initialTask: String },
      emits: ['close'],
      setup(props, { emit }) {
        const modal = ref(false)
        const panel = ref(false)
        onMounted(() => { lifecycle.mounted++ })
        onUnmounted(() => { lifecycle.stopped++ })
        return () => h('div', { class: 'v2-experience', 'data-testid': 'simulation-stub', 'data-task': props.initialTask, 'data-embedded': String(props.embedded) }, [
          h('button', { 'data-testid': 'inner-first', onClick: () => { modal.value = true } }, '打开内部确认'),
          h('button', { 'data-testid': 'open-panel', onClick: () => { panel.value = true } }, '展开一键演示'),
          modal.value ? h('div', { role: 'dialog', 'aria-modal': 'true', onKeydown: (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); modal.value = false } } }, [h('button', { 'data-testid': 'inner-modal-button' }, '内部确认')]) : null,
          panel.value ? h('aside', { class: 'kst-demo-panel', onKeydown: (event: KeyboardEvent) => { if (event.key === 'Escape') panel.value = false } }, [h('button', { 'data-testid': 'inner-panel-button' }, '一键演示选项')]) : null,
          h('button', { 'data-testid': 'runtime-error', onClick: () => { throw new Error('isolated demo failure') } }, '模拟体验加载失败'),
          h('button', { 'data-testid': 'inner-last', onClick: () => emit('close') }, '内部退出'),
        ])
      },
    }),
  }
})

describe('tools-page embedded simulation experience', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    lifecycle.mounted = 0
    lifecycle.stopped = 0
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open') })
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => [{ width: 10, height: 10 }] as unknown as DOMRectList)
    document.body.style.overflow = 'auto'
    document.body.style.paddingRight = '6px'
    document.documentElement.style.overflow = 'scroll'
    document.documentElement.style.scrollBehavior = 'smooth'
    document.documentElement.style.overflowAnchor = 'auto'
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

  function render() {
    wrapper = mount(MarketingSimulationExperience, { attachTo: document.body })
    return wrapper
  }

  async function enter(task = 'product') {
    const button = wrapper!.get(`[data-experience-task="${task}"]`)
    ;(button.element as HTMLButtonElement).focus()
    await button.trigger('click')
    await flushPromises()
    return document.querySelector<HTMLDialogElement>('[data-testid="marketing-experience-dialog"]')!
  }

  it('offers five explicit task entrances without a standalone route or eager simulation', () => {
    const view = render()
    expect(view.findAll('[data-experience-task]').map(button => button.attributes('data-experience-task'))).toEqual(['product', 'template', 'advertising', 'fba', 'shipping'])
    expect(view.get('#experience').text()).toContain('选一项，自己操作或看一键演示')
    expect(view.text()).toContain('本机样例，不连接真实平台或账号')
    expect(view.get('[data-testid="experience-start"]').text()).toBe('开始体验')
    expect(view.get('#experience-title').text()).toBe('在线操作体验')
    expect(view.findAll('.experience-task-action').every(action => action.text() === '体验这个任务')).toBe(true)
    expect(view.findAll('a')).toHaveLength(0)
    expect(document.querySelector('dialog')).toBeNull()
    expect(lifecycle.mounted).toBe(0)
  })

  it('starts the sample from the prominent button and restores focus there on exit', async () => {
    const view = render()
    const start = view.get('[data-testid="experience-start"]')
    ;(start.element as HTMLButtonElement).focus()
    await start.trigger('click')
    await flushPromises()
    const modal = document.querySelector<HTMLDialogElement>('[data-testid="marketing-experience-dialog"]')!
    expect(modal.querySelector('[data-testid="simulation-stub"]')?.getAttribute('data-task')).toBe('product')
    modal.querySelector<HTMLButtonElement>('[data-testid="experience-close"]')!.click()
    await flushPromises()
    expect(document.activeElement).toBe(start.element)
  })

  it('opens the selected local task without auto execution and locks the underlying page', async () => {
    render()
    const modal = await enter('shipping')
    expect(modal.open).toBe(true)
    const simulation = modal.querySelector('[data-testid="simulation-stub"]')!
    expect(simulation.getAttribute('data-task')).toBe('shipping')
    expect(simulation.getAttribute('data-embedded')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.documentElement.style.overflow).toBe('hidden')
    expect(document.documentElement.style.scrollBehavior).toBe('auto')
    expect(document.documentElement.style.overflowAnchor).toBe('none')
    expect(document.activeElement).toBe(modal.querySelector('[data-testid="experience-close"]'))
    expect(modal.querySelector('[data-testid="experience-session-note"]')?.textContent).toContain('本次操作会保留，退出或刷新后重新开始')
  })

  it('unmounts on exit, restores exact scroll styles and returns focus to the entrance', async () => {
    render()
    const modal = await enter('template')
    modal.querySelector<HTMLButtonElement>('[data-testid="experience-close"]')!.click()
    await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
    expect(lifecycle.stopped).toBe(1)
    expect(document.body.style.overflow).toBe('auto')
    expect(document.body.style.paddingRight).toBe('6px')
    expect(document.documentElement.style.overflow).toBe('scroll')
    expect(document.documentElement.style.scrollBehavior).toBe('smooth')
    expect(document.documentElement.style.overflowAnchor).toBe('auto')
    expect(document.activeElement).toBe(wrapper!.get('[data-experience-task="template"]').element)
    await enter('product')
    expect(lifecycle.mounted).toBe(2)
  })

  it('gives Escape to the internal confirmation first, then closes the experience', async () => {
    render()
    const modal = await enter()
    modal.querySelector<HTMLButtonElement>('[data-testid="inner-first"]')!.click()
    await flushPromises()
    modal.querySelector<HTMLButtonElement>('[data-testid="inner-modal-button"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.querySelector('[data-testid="marketing-experience-dialog"]')).not.toBeNull()
    expect(modal.querySelector('[role="dialog"]')).toBeNull()
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('does not close the outer experience when Escape collapses the one-click panel', async () => {
    render()
    const modal = await enter()
    modal.querySelector<HTMLButtonElement>('[data-testid="open-panel"]')!.click()
    await flushPromises()
    modal.querySelector<HTMLButtonElement>('[data-testid="inner-panel-button"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(modal.open).toBe(true)
    expect(modal.querySelector('.kst-demo-panel')).toBeNull()
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('keeps keyboard focus within the outer modal when no inner modal is active', async () => {
    render()
    const modal = await enter()
    const first = modal.querySelector<HTMLButtonElement>('[data-testid="experience-close"]')!
    const last = modal.querySelector<HTMLButtonElement>('[data-testid="inner-last"]')!
    first.focus()
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(last)
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(first)
  })

  it('isolates runtime failures and allows retrying or exiting without losing the tools page', async () => {
    render()
    const modal = await enter()
    modal.querySelector<HTMLButtonElement>('[data-testid="runtime-error"]')!.click()
    await flushPromises()
    expect(modal.textContent).toContain('暂时没能打开体验')
    expect(lifecycle.stopped).toBe(1)
    const retry = Array.from(modal.querySelectorAll('button')).find(button => button.textContent === '重新加载')!
    retry.click()
    await flushPromises()
    expect(modal.querySelector('[data-testid="simulation-stub"]')).not.toBeNull()
    expect(lifecycle.mounted).toBe(2)
    modal.querySelector<HTMLButtonElement>('[data-testid="experience-close"]')!.click()
    await flushPromises()
    expect(wrapper!.find('#experience').exists()).toBe(true)
  })

  it('keeps the close bar within a magnified visual viewport and removes zoom listeners on exit', async () => {
    const viewport = Object.assign(new EventTarget(), { scale: 1.5, width: 260, height: 600, offsetLeft: 20, offsetTop: 12 })
    vi.stubGlobal('visualViewport', viewport)
    const remove = vi.spyOn(viewport, 'removeEventListener')
    render()
    const modal = await enter()
    expect(modal.style.width).toBe('260px')
    expect(modal.style.height).toBe('600px')
    expect(modal.style.left).toBe('20px')
    viewport.offsetLeft = 40
    viewport.dispatchEvent(new Event('scroll'))
    await flushPromises()
    expect(modal.style.left).toBe('40px')
    viewport.scale = 1
    viewport.dispatchEvent(new Event('resize'))
    await flushPromises()
    expect(modal.style.width).toBe('')
    modal.querySelector<HTMLButtonElement>('[data-testid="experience-close"]')!.click()
    await flushPromises()
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
  })

  it('cleans up the active experience and scroll lock if the tools page is unmounted', async () => {
    render()
    await enter()
    wrapper!.unmount()
    wrapper = undefined
    expect(lifecycle.stopped).toBe(1)
    expect(document.body.style.overflow).toBe('auto')
    expect(document.documentElement.style.overflow).toBe('scroll')
    expect(document.querySelector('dialog')).toBeNull()
  })
})
