import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import MarketingToolsOverview from '@/components/landing/MarketingToolsOverview.vue'

const lifecycle = vi.hoisted(() => ({ mounted: 0, stopped: 0 }))

vi.mock('@/marketing/demo/v2/V2SimulationView.vue', async () => {
  const { defineComponent, h, onMounted, onUnmounted } = await import('vue')
  return {
    default: defineComponent({
      props: { embedded: Boolean, initialTask: String },
      setup(props) {
        onMounted(() => { lifecycle.mounted++ })
        onUnmounted(() => { lifecycle.stopped++ })
        return () => h('div', { 'data-testid': 'task-simulation-stub', 'data-task': props.initialTask, 'data-embedded': String(props.embedded) })
      },
    }),
  }
})

describe('marketing tool detail next actions', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    lifecycle.mounted = 0
    lifecycle.stopped = 0
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.setAttribute('open', '') })
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute('open') })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  function render() {
    wrapper = mount(MarketingToolsOverview, {
      attachTo: document.body,
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' }, MarketingDownloadAction: true } },
    })
    return wrapper
  }

  it('retains eight task anchors, closes details initially and offers three in-page destinations', () => {
    const view = render()
    expect(view.findAll('[data-task-id]').map(card => card.attributes('id'))).toEqual([
      'tool-company', 'tool-sourcing', 'tool-product', 'tool-shipping', 'tool-marketing', 'tool-fba', 'tool-orders', 'tool-pricing',
    ])
    expect(view.findAll('.tool-details')).toHaveLength(8)
    for (const details of view.findAll('.tool-details')) {
      expect(details.attributes('open')).toBeUndefined()
      expect(details.get('summary').text()).toBe('准备资料与详细说明')
      expect(details.get('.tool-input').text()).toContain('准备什么')
      expect(details.get('.tool-support').text()).toContain('课赛通辅助')
    }
    expect(view.findAll('[aria-label="工具页目录"] a').map(link => link.attributes('href'))).toEqual(['#experience', '#tool-list', '#start'])
    for (const id of ['#experience', '#tool-list', '#start']) expect(view.get(id).attributes('tabindex')).toBe('-1')
    expect(view.findAll('.tool-card.is-upcoming').map(card => card.attributes('data-task-id'))).toEqual(['company', 'sourcing', 'pricing'])
  })

  it.each([
    ['product', 'product'], ['shipping', 'template'], ['marketing', 'advertising'], ['fba', 'fba'], ['orders', 'shipping'],
  ])('opens marketing %s in the shared %s simulation and returns focus to the detail action', async (marketingTask, demoTask) => {
    const view = render()
    const trigger = view.get(`[data-tool-experience="${marketingTask}"]`)
    ;(trigger.element as HTMLButtonElement).focus()
    await trigger.trigger('click')
    await flushPromises()
    expect(document.querySelectorAll('[data-testid="marketing-experience-dialog"]')).toHaveLength(1)
    const simulation = document.querySelector('[data-testid="task-simulation-stub"]')!
    expect(simulation.getAttribute('data-task')).toBe(demoTask)
    expect(simulation.getAttribute('data-embedded')).toBe('true')
    expect(document.body.style.overflow).toBe('hidden')
    document.querySelector<HTMLButtonElement>('[data-testid="experience-close"]')!.click()
    await flushPromises()
    expect(document.querySelector('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger.element)
    expect(lifecycle.stopped).toBe(1)
    await trigger.trigger('click')
    await flushPromises()
    expect(lifecycle.mounted).toBe(2)
  })

  it('keeps unavailable tools distinct from local simulations and only offers consultation for conditional desktop tools', async () => {
    const view = render()
    expect(view.findAll('[data-tool-experience]').map(button => button.attributes('data-tool-experience'))).toEqual(['product', 'shipping', 'marketing', 'fba', 'orders'])
    expect(view.findAll('[data-tool-consult]').map(link => link.attributes('data-tool-consult'))).toEqual(['product', 'orders'])
    for (const id of ['shipping', 'marketing', 'fba']) {
      const card = view.get(`#tool-${id}`)
      expect(card.get('.tool-status').text()).toBe('暂未开放')
      expect(card.get('[data-tool-experience]').text()).toBe('在线体验')
      expect(card.get('.tool-details').text()).toContain('不代表对应电脑端工具已经开放')
      expect(card.find('[data-tool-consult]').exists()).toBe(false)
    }
    for (const id of ['company', 'sourcing', 'pricing']) expect(view.get(`#tool-${id}`).find('.tool-card-actions').exists()).toBe(false)
    const consultation = view.get('[data-tool-consult="orders"]')
    expect(consultation.element.tagName).toBe('BUTTON')
    expect(consultation.attributes('href')).toBeUndefined()
    await consultation.trigger('click')
    await flushPromises()
    expect(document.querySelector('[data-testid="marketing-consultation-dialog"] h2')?.textContent).toBe('咨询订单发货')
    expect(document.querySelector<HTMLInputElement>('[data-testid="consultation-wechat-account"]')?.value).toBe('Moweiiong')
    document.querySelector<HTMLButtonElement>('[data-testid="consultation-close"]')!.click()
    await flushPromises()
    expect(document.activeElement).toBe(consultation.element)
    await view.get('[data-tool-consult="product"]').trigger('click')
    await flushPromises()
    expect(document.querySelector('[data-testid="marketing-consultation-dialog"] h2')?.textContent).toBe('咨询发布商品')
    expect(view.find('form').exists()).toBe(false)
    wrapper!.unmount()
    wrapper = undefined
    render()
    expect(document.querySelector('[data-testid="marketing-consultation-dialog"]')).toBeNull()
  })
})
