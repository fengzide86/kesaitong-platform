import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import Controller from '@/marketing/demo/v2/V2DemoController.vue'
import type { DemoOutcome } from '@/marketing/demo/v2/demo-tasks'

const outcome: DemoOutcome = {
  task: 'product', objectId: 'sample-product', title: '本机示例商品',
  before: '未创建', after: '在售 · 2 个子 SKU', facts: [], page: 'inventory',
}

describe('stable demo task controls', () => {
  let wrapper: VueWrapper | undefined
  afterEach(() => { wrapper?.unmount(); wrapper = undefined })
  const render = () => (wrapper = mount(Controller, { attachTo: document.body, props: {
    open: true, task: 'product', pace: 'flow', running: false, paused: false,
    status: '就绪', currentStep: '', action: '', steps: [], cursor: 0,
  } }))

  it('keeps the same task selector outside scrolling results and settings', async () => {
    const view = render()
    const selector = view.get('#kst-demo-task').element
    const body = view.get('.kst-demo-body').element as HTMLElement
    expect(body.contains(selector)).toBe(false)
    expect(view.get('.kst-demo-task-picker').element.contains(selector)).toBe(true)
    await view.setProps({ activeTask: 'product', steps: ['保存商品'], cursor: 1, status: '已完成，保存状态核对通过', outcome })
    expect(view.get('[data-testid="demo-outcome"]').isVisible()).toBe(true)
    ;(selector as HTMLElement).focus()
    body.scrollTop = 160
    await view.setProps({ task: 'shipping' })
    expect(view.get('#kst-demo-task').element).toBe(selector)
    expect(document.activeElement).toBe(selector)
    expect(body.scrollTop).toBe(0)
    expect(view.find('[data-testid="demo-outcome"]').exists()).toBe(false)
    expect(view.get('[data-action="run"]').text()).toBe('开始演示')
    await view.setProps({ task: 'product' })
    expect(view.get('#kst-demo-task').element).toBe(selector)
    expect(view.get('[data-testid="demo-outcome"]').text()).toContain(outcome.title)
    expect(view.get('[data-action="run"]').text()).toBe('再演示一次')
  })

  it('retains task identity while running and unlocks it after completion', async () => {
    const view = render()
    const selector = view.get('#kst-demo-task').element as HTMLSelectElement
    await view.setProps({ running: true, activeTask: 'product', steps: ['保存商品'] })
    expect(view.get('#kst-demo-task').element).toBe(selector)
    expect(selector.disabled).toBe(true)
    await view.setProps({ running: false, cursor: 1, status: '已完成，保存状态核对通过', outcome })
    expect(selector.disabled).toBe(false)
    expect(view.get('#kst-demo-task').element).toBe(selector)
    await view.get('#kst-demo-task').setValue('template')
    expect(view.emitted('update:task')?.at(-1)).toEqual(['template'])
  })

  it('keeps optional settings collapsed and returns keyboard focus through the compact dock', async () => {
    const view = render()
    const settings = view.get('.kst-demo-settings').element as HTMLDetailsElement
    expect(settings.open).toBe(false)
    settings.open = true
    await view.setProps({ task: 'shipping' })
    expect(view.get('.kst-demo-settings').element).toBe(settings)
    expect(settings.open).toBe(true)
    await view.get('[aria-label="收起工具控制"]').trigger('click')
    expect(view.emitted('close')).toHaveLength(1)
    await view.setProps({ open: false })
    const toggle = view.get('[data-action="open-demo-controller"]')
    expect(toggle.text()).toContain('展开控制，选择演示任务')
    expect(document.activeElement).toBe(toggle.element)
    await toggle.trigger('click')
    expect(view.emitted('toggle')).toHaveLength(1)
    await view.setProps({ open: true })
    expect(document.activeElement).toBe(view.get('#kst-demo-task').element)
  })

  it('keeps progress and pause available while the running control is collapsed', async () => {
    const view = render()
    await view.setProps({ open: false, running: true, activeTask: 'product', steps: ['填写商品', '保存商品'], cursor: 1, currentStep: '保存商品' })
    expect(view.get('.kst-demo-dock-copy').text()).toContain('保存商品')
    expect(view.get('progress').attributes('value')).toBe('1')
    expect(view.get('progress').attributes('max')).toBe('2')
    await view.get('.kst-demo-dock-pause').trigger('click')
    expect(view.emitted('pause')).toHaveLength(1)
    await view.setProps({ paused: true })
    expect(view.get('.kst-demo-dock-pause').text()).toBe('继续')
  })
})
