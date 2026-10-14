import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import Simulation from './V2SimulationView.vue'
import Controller from './V2DemoController.vue'
import type { DemoTask } from './demo-tasks'

let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers(); vi.restoreAllMocks() })

async function until(predicate: () => boolean) {
  for (let tick = 0; tick < 2400; tick++) {
    await vi.advanceTimersByTimeAsync(25)
    await flushPromises()
    if (predicate()) return
  }
  throw new Error(`Demo did not reach expected state: ${wrapper?.find('[data-testid="run-status"]').text()} / ${wrapper?.find('.v2-message').text()}`)
}
async function start(task: DemoTask) {
  wrapper = mount(Simulation, { attachTo: document.body, props: { embedded: true, initialTask: task } })
  await flushPromises()
  const controller = wrapper.getComponent(Controller)
  controller.vm.$emit('update:pace', 'flow')
  controller.vm.$emit('start')
  await flushPromises()
  return wrapper
}
async function restart(view: VueWrapper) {
  const controller = view.getComponent(Controller)
  controller.vm.$emit('stop')
  await flushPromises()
  expect(controller.props('status')).toContain('已停止')
  controller.vm.$emit('start')
  await until(() => !view.getComponent(Controller).props('running'))
  expect(view.getComponent(Controller).props('status'), view.findAll('.v2-message').map(item => item.text()).join(' / ')).toBe('已完成，保存状态核对通过')
}

describe('embedded demo restart preserves saved state and restarts UI navigation', () => {
  it.each(['fba-selection-confirm', 'fba-only-convert', 'fba-hazard-save'])('restarts FBA after stopping at %s', async action => {
    const view = await start('fba')
    await until(() => view.find(`[data-action="${action}"].v2-demo-target`).exists())
    await restart(view)
    expect(view.get('[data-testid="demo-outcome"]').text()).toContain('亚马逊配送')
    expect(view.findAll('[data-fba-row]')).toHaveLength(6)
  })

  it('does not toggle a previously checked warehouse order off when restarting', async () => {
    const view = await start('shipping')
    await until(() => view.find('[data-action="warehouse-batch"].v2-demo-target').exists())
    expect((view.get('[data-warehouse-select="DEMO-ORDER-10001"]').element as HTMLInputElement).checked).toBe(true)
    await restart(view)
    expect(view.get('[data-testid="demo-outcome"]').text()).toContain('已出库 · 已确认发货')
  })

  it('keeps an already completed picking step when shipping restarts', async () => {
    const view = await start('shipping')
    await until(() => view.find('[data-stage="待打包"].v2-demo-target').exists())
    await restart(view)
    expect(view.get('[data-testid="demo-outcome"]').text()).toContain('已出库 · 已确认发货')
    expect(view.getComponent(Controller).props('steps')).not.toContain('勾选本订单，分拣并确认结果')
  })

  it('restarts a template without inheriting its unfinished child form', async () => {
    const view = await start('template')
    await until(() => view.find('[data-action="template-save"].v2-demo-target').exists())
    await restart(view)
    expect(view.find('[data-testid="demo-outcome"]').exists()).toBe(true)
  })

  it('keeps earlier conversions when another FBA demonstration begins', async () => {
    const view = await start('fba')
    await until(() => !view.getComponent(Controller).props('running'))
    expect(view.findAll('[data-fba-row]')).toHaveLength(6)
    await restart(view)
    expect(view.findAll('[data-fba-row]')).toHaveLength(7)
  })
})
