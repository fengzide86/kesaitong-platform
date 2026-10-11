import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import Simulation from './V2SimulationView.vue'
import ProductEditor from './V2ProductEditor.vue'
import { type DemoTask } from './demo-tasks'
import { type Product, SIMULATION_STORAGE_KEY } from './model'

const mounted: VueWrapper[] = []
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks)
  else Reflect.deleteProperty(navigator, 'locks')
})

async function openExperience(initialTask: DemoTask = 'product', embedded = true) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/tools', component: { template: '<div />' } }, { path: '/demo', component: { template: '<div />' } }, { path: '/', component: { template: '<div />' } }] })
  await router.push(embedded ? '/tools#experience' : '/demo?page=inventory')
  await router.isReady()
  const wrapper = mount(Simulation, { props: { embedded, initialTask }, global: { plugins: [router] } })
  mounted.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('tools-page embedded simulation contract', () => {
  it.each<[DemoTask, string]>([['product', 'inventory'], ['template', 'templates'], ['advertising', 'advertising'], ['fba', 'inventory'], ['shipping', 'orders']])('opens %s in the correct local scene without running or changing the website URL', async (initialTask, page) => {
    const { wrapper, router } = await openExperience(initialTask)
    expect(wrapper.attributes('data-embedded-page')).toBe(page)
    expect(wrapper.classes()).toContain('is-embedded')
    expect(wrapper.get('.kst-demo-panel').isVisible()).toBe(true)
    expect((wrapper.get('[aria-label="选择一键任务"]').element as HTMLSelectElement).value).toBe(initialTask)
    expect(wrapper.find('.v2-demo-target').exists()).toBe(false)
    expect(wrapper.find('[aria-label="首次体验引导"]').exists()).toBe(false)
    expect(router.currentRoute.value.fullPath).toBe('/tools#experience')
    expect(localStorage.getItem(SIMULATION_STORAGE_KEY)).toBeNull()
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })

  it('keeps manual scene navigation inside the feature and does not offer a new browser tab', async () => {
    const { wrapper, router } = await openExperience()
    await wrapper.get('[data-action="go-course"]').trigger('click')
    expect(wrapper.attributes('data-embedded-page')).toBe('course')
    await wrapper.get('[data-area="amazon"]').trigger('click')
    expect(wrapper.text()).not.toContain('在新标签页打开卖家后台')
    await wrapper.get('[data-action="enter-seller"]').trigger('click')
    expect(wrapper.attributes('data-embedded-page')).toBe('seller')
    expect(router.currentRoute.value.fullPath).toBe('/tools#experience')
  })

  it('emits close rather than navigating away from tools', async () => {
    const { wrapper, router } = await openExperience()
    await wrapper.get('[data-action="close-embedded-experience"]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(router.currentRoute.value.fullPath).toBe('/tools#experience')
    expect(wrapper.find('[aria-label="返回课赛通官网"]').exists()).toBe(false)
  })

  it('does not persist a manual save whose Web Lock resolves after unmount', async () => {
    let releaseLock: (() => void) | undefined
    const request = vi.fn((_name: string, work: () => void) => new Promise<void>(resolve => { releaseLock = () => { work(); resolve() } }))
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
    const { wrapper } = await openExperience()
    await wrapper.get('[data-edit]').trigger('click')
    const editor = wrapper.getComponent(ProductEditor)
    const product = JSON.parse(JSON.stringify((editor.props() as { readonly product: Product }).product)) as Product
    product.title = '未保存的本地测试修改'
    editor.vm.$emit('save', product, false)
    await flushPromises()
    expect(request).toHaveBeenCalledOnce()
    wrapper.unmount()
    releaseLock!()
    await flushPromises()
    expect(localStorage.setItem).not.toHaveBeenCalled()
    expect(localStorage.getItem(SIMULATION_STORAGE_KEY)).toBeNull()
  })

  it('retains the default standalone return link and route navigation', async () => {
    const { wrapper, router } = await openExperience('product', false)
    expect(wrapper.classes()).not.toContain('is-embedded')
    expect(wrapper.get('[aria-label="返回课赛通官网"]').attributes('href')).toBe('/')
    await wrapper.get('[data-action="go-course"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/demo?page=course')
  })
})
