import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import MessageCenter from '@/features/announcements/MessageCenter.vue'

const mocks = vi.hoisted(() => ({
  getAnnouncementFeed: vi.fn(),
  markAnnouncementRead: vi.fn(),
  dismissAnnouncement: vi.fn(),
}))

vi.mock('@/utils/api', () => ({
  getAnnouncementFeed: mocks.getAnnouncementFeed,
  markAnnouncementRead: mocks.markAnnouncementRead,
  dismissAnnouncement: mocks.dismissAnnouncement,
}))

describe('MessageCenter', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem('toolbox_role', 'user')
    sessionStorage.setItem('toolbox_auth', JSON.stringify({ token: 'test-session' }))
    const pinia = createPinia()
    setActivePinia(pinia)
    mocks.getAnnouncementFeed.mockResolvedValue([])
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('把抽屉传送到 body，避免被头部层叠上下文压住', async () => {
    const wrapper = mount(MessageCenter, {
      attachTo: document.body,
      global: { plugins: [createPinia()] },
    })
    await flushPromises()

    await wrapper.find('.message-trigger').trigger('click')
    await flushPromises()

    expect(wrapper.find('.drawer-layer').exists()).toBe(false)
    expect(document.body.querySelector('.drawer-layer')).not.toBeNull()
    expect(document.body.querySelector('.message-drawer')?.getAttribute('aria-modal')).toBe('true')
    wrapper.unmount()
  }, 15_000)

  it('shows failure distinctly from no messages and recovers on retry', async () => {
    mocks.getAnnouncementFeed.mockRejectedValue(new Error('offline'))
    const wrapper = mount(MessageCenter, { attachTo: document.body, global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.get('.message-trigger').trigger('click'); await flushPromises()
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('重新读取')
    expect(document.body.textContent).not.toContain('这里暂时没有消息')
    mocks.getAnnouncementFeed.mockResolvedValue([])
    document.body.querySelector<HTMLButtonElement>('.message-error button')!.click()
    await flushPromises()
    expect(document.body.textContent).toContain('这里暂时没有消息')
    wrapper.unmount()
  })

  it('expands all 10000 characters before recording read and restores focus on Escape', async () => {
    mocks.getAnnouncementFeed.mockResolvedValue([{ id: 1, title: '长公告', content: '正文'.repeat(5000), type: 'info', audience: 'all', category: 'system', severity: 'info', presentation: 'banner', priority: 1, revision: 1, is_read: false, is_dismissed: false }])
    const wrapper = mount(MessageCenter, { attachTo: document.body, global: { plugins: [createPinia()] } })
    await flushPromises()
    const trigger = wrapper.get<HTMLButtonElement>('.message-trigger')
    trigger.element.focus()
    await trigger.trigger('click'); await flushPromises()
    expect(document.body.querySelector('.message-drawer')?.contains(document.activeElement)).toBe(true)
    expect(mocks.markAnnouncementRead).not.toHaveBeenCalled()
    const expand = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.message-list button')).find(item => item.textContent === '阅读全文')!
    expand.click(); await flushPromises()
    expect(document.body.querySelector('.expanded p')?.textContent).toHaveLength(10000)
    expect(mocks.markAnnouncementRead).toHaveBeenCalledWith(1)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(document.body.querySelector('.message-drawer')).toBeNull()
    expect(document.activeElement).toBe(trigger.element)
    wrapper.unmount()
  })
})
