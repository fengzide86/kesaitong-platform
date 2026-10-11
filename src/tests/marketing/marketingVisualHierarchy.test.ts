import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import MarketingDownloadAction from '@/components/landing/MarketingDownloadAction.vue'
import MarketingShell from '@/components/landing/MarketingShell.vue'
import LandingTaskMap from '@/components/landing/LandingTaskMap.vue'
import MarketingScoreSupport from '@/components/landing/MarketingScoreSupport.vue'
import { marketingTasks } from '@/marketing/task-catalog'

const downloadMocks = vi.hoisted(() => ({ download: vi.fn().mockResolvedValue(undefined), resolve: vi.fn() }))
vi.mock('@/runtime/desktop-download', () => ({
  downloadDesktopInstaller: downloadMocks.download,
  resolveDesktopInstallerUrl: downloadMocks.resolve,
}))

describe('marketing visual hierarchy keeps existing actions usable', () => {
  const wrappers: VueWrapper[] = []
  afterEach(() => {
    wrappers.forEach(wrapper => wrapper.unmount())
    wrappers.length = 0
    vi.restoreAllMocks()
  })

  async function routerAt(path = '/') {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
    })
    await router.push(path)
    await router.isReady()
    return router
  }

  it('keeps the bottom download button primary unless explicitly changed', () => {
    const wrapper = mount(MarketingDownloadAction, { global: { stubs: { LandingDesktopHandoff: true } } })
    wrappers.push(wrapper)
    expect(wrapper.get('button').classes()).not.toContain('secondary')
    expect(wrapper.get('button').text()).toBe('下载 Windows 桌面端')
  })

  it('preserves the isolated download action and authorization notice with the secondary style', async () => {
    const wrapper = mount(MarketingDownloadAction, { props: { compact: true, variant: 'secondary' }, global: { stubs: { LandingDesktopHandoff: true } } })
    wrappers.push(wrapper)
    expect(wrapper.get('button').classes()).toEqual(expect.arrayContaining(['compact', 'secondary']))
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(downloadMocks.download).toHaveBeenCalledOnce()
    expect(downloadMocks.resolve).not.toHaveBeenCalled()
    expect(wrapper.get('[role="status"]').text()).toContain('下载不代表授权已开通')
  })

  it('uses the secondary style only for the tool-page navigation download', async () => {
    const router = await routerAt('/tools')
    const wrapper = mount(MarketingShell, { props: { showDownload: true }, global: { plugins: [router], stubs: { LandingDesktopHandoff: true } } })
    wrappers.push(wrapper)
    expect(wrapper.get('[data-testid="navigation-experience"]').attributes('href')).toBe('/tools#experience')
    expect(wrapper.getComponent(MarketingDownloadAction).props()).toMatchObject({ variant: 'secondary' })
    expect(wrapper.get('.marketing-shell-download button').classes()).toContain('secondary')
  })

  it('does not introduce a homepage navigation download', async () => {
    const router = await routerAt()
    const wrapper = mount(MarketingShell, { global: { plugins: [router] } })
    wrappers.push(wrapper)
    expect(wrapper.findComponent(MarketingDownloadAction).exists()).toBe(false)
  })

  it('preserves all eight whole-card task links and their visible action labels', async () => {
    const router = await routerAt()
    const wrapper = mount(LandingTaskMap, { global: { plugins: [router] } })
    wrappers.push(wrapper)
    const cards = wrapper.findAll('.landing-task-card')
    expect(cards).toHaveLength(8)
    for (const [index, card] of cards.entries()) {
      expect(card.element.tagName).toBe('A')
      expect(card.attributes('href')).toBe(`/tools#tool-${marketingTasks[index]!.id}`)
      expect(card.get('.landing-task-card-action').text()).toBe('查看工具说明')
      expect(card.findAll('a, button')).toHaveLength(0)
      await card.trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.hash).toBe(`#tool-${marketingTasks[index]!.id}`)
    }
  })

  it('retains the two comparison sequences and the tool introduction link', async () => {
    const router = await routerAt()
    const wrapper = mount(MarketingScoreSupport, { global: { plugins: [router] } })
    wrappers.push(wrapper)
    expect(wrapper.findAll('.score-support-panel')).toHaveLength(2)
    expect(wrapper.findAll('.score-support-manual li')).toHaveLength(3)
    expect(wrapper.findAll('.score-support-assisted li')).toHaveLength(3)
    expect(wrapper.text()).toContain('需要关注的得分细节')
    expect(wrapper.get('a').attributes('href')).toBe('/tools')
    expect(fetch).not.toHaveBeenCalled()
  })
})
