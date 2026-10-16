import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import AnnouncementBanner from '@/components/AnnouncementBanner.vue'

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

describe('AnnouncementBanner', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    sessionStorage.setItem('toolbox_role', 'user')
    sessionStorage.setItem('toolbox_auth', JSON.stringify({ token: 'customer-session' }))
    const pinia = createPinia()
    setActivePinia(pinia)
    mocks.getAnnouncementFeed.mockResolvedValue([{
      id: 8,
      title: '重要公告',
      content: '请先阅读公告内容',
      type: 'maintenance',
      audience: 'consumer',
      category: 'maintenance',
      severity: 'critical',
      presentation: 'modal',
      priority: 100,
      revision: 1,
      created_at: '2026-07-21T00:00:00Z',
      is_read: false,
      is_dismissed: false,
    }])
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  it('把重要公告传送到 body，避免被页面工具栏层叠上下文盖住', async () => {
    const wrapper = mount(AnnouncementBanner, {
      attachTo: document.body,
      global: { plugins: [createPinia()] },
    })
    await flushPromises()

    expect(wrapper.find('.announcement-overlay').exists()).toBe(false)
    const overlay = document.body.querySelector('.announcement-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay?.getAttribute('aria-modal')).toBe('true')
    wrapper.unmount()
  })

  it('管理员壳不请求客户公告，也不展示旧客户的重要公告', async () => {
    sessionStorage.setItem('toolbox_role', 'super_admin')
    const wrapper = mount(AnnouncementBanner, { global: { plugins: [createPinia()] } })
    await flushPromises()
    expect(mocks.getAnnouncementFeed).not.toHaveBeenCalled()
    expect(document.body.querySelector('.announcement-overlay')).toBeNull()
    wrapper.unmount()
  })

  it('keeps a long critical notice keyboard-contained and restores the original focus after dismissal', async () => {
    const trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus()
    const [notice] = await mocks.getAnnouncementFeed()
    mocks.getAnnouncementFeed.mockResolvedValue([{ ...notice, content: '长公告'.repeat(3333) + '末' }])
    mocks.dismissAnnouncement.mockResolvedValue({ success: true, data: { announcement_id: 8, revision: 1, action: 'dismiss' } })
    const wrapper = mount(AnnouncementBanner, { attachTo: document.body, global: { plugins: [createPinia()] } })
    await flushPromises()
    const modal = document.body.querySelector('.announcement-modal')!
    expect(modal.querySelector('p')?.textContent).toHaveLength(10000)
    expect(modal.contains(document.activeElement)).toBe(true)
    const focused = document.activeElement
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(focused)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(mocks.dismissAnnouncement).toHaveBeenCalledWith(8, 1)
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })
})
