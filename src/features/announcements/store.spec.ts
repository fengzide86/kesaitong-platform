import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAnnouncementStore } from './store'

const api = vi.hoisted(() => ({
  getAnnouncementFeed: vi.fn(),
  markAnnouncementRead: vi.fn(),
  dismissAnnouncement: vi.fn(),
}))

vi.mock('@/utils/api', () => api)

const announcement = {
  id: 1,
  title: '维护通知',
  content: '请保存当前工作',
  type: 'maintenance',
  audience: 'business',
  category: 'maintenance',
  severity: 'critical',
  presentation: 'modal',
  priority: 100,
  revision: 2,
  created_at: '2026-07-15T12:00:00',
  is_read: false,
  is_dismissed: false,
}

describe('announcement center store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sessionStorage.clear()
    localStorage.clear()
    sessionStorage.setItem('toolbox_role', 'user')
    sessionStorage.setItem('toolbox_auth', JSON.stringify({ token: 'customer-session' }))
    sessionStorage.setItem('toolbox_user', JSON.stringify({ auth_code_id: 1, device_id: 'device-one' }))
    vi.clearAllMocks()
    api.getAnnouncementFeed.mockResolvedValue([announcement])
    api.markAnnouncementRead.mockResolvedValue({ success: true })
    api.dismissAnnouncement.mockResolvedValue({ success: true })
  })

  it('derives unread and critical state only from server receipts', async () => {
    const store = useAnnouncementStore()
    await store.load()
    expect(store.unreadCount).toBe(1)
    expect(store.critical?.revision).toBe(2)
  })

  it('marks and dismisses the exact announcement revision in local state', async () => {
    const store = useAnnouncementStore()
    await store.load()
    const item = store.items[0]
    expect(item).toBeDefined()
    if (!item) return

    await store.dismiss(item)

    expect(api.dismissAnnouncement).toHaveBeenCalledWith(1)
    expect(store.unreadCount).toBe(0)
    expect(store.critical).toBeNull()
  })

  it.each(['super_admin', 'operator', 'support', 'agent'])('does not request the customer feed for %s', async role => {
    sessionStorage.setItem('toolbox_role', role)
    const store = useAnnouncementStore()
    await store.load(true)
    expect(api.getAnnouncementFeed).not.toHaveBeenCalled()
    expect(store.items).toEqual([])
  })

  it('discards an old customer response after switching to staff', async () => {
    let resolve!: (value: unknown) => void
    api.getAnnouncementFeed.mockReturnValue(new Promise(done => { resolve = done }))
    const store = useAnnouncementStore()
    const pending = store.load()
    sessionStorage.setItem('toolbox_role', 'super_admin')
    window.dispatchEvent(new Event('toolbox:user-updated'))
    resolve([announcement])
    await pending
    expect(store.items).toEqual([])
    expect(store.critical).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('clears customer notices on logout and fetches only the new customer scope', async () => {
    const store = useAnnouncementStore()
    await store.load()
    sessionStorage.clear()
    window.dispatchEvent(new Event('toolbox:auth-cleared'))
    expect(store.items).toEqual([])
    sessionStorage.setItem('toolbox_role', 'user')
    sessionStorage.setItem('toolbox_auth', JSON.stringify({ token: 'other-session' }))
    sessionStorage.setItem('toolbox_user', JSON.stringify({ auth_code_id: 2, device_id: 'device-two' }))
    api.getAnnouncementFeed.mockResolvedValue([{ ...announcement, id: 2, title: '新客户公告' }])
    await store.load()
    expect(store.items.map(item => item.id)).toEqual([2])
    expect(api.getAnnouncementFeed).toHaveBeenCalledTimes(2)
  })

  it('does not acknowledge an old notice after the customer identity changes', async () => {
    const store = useAnnouncementStore()
    await store.load()
    const item = store.items[0]!
    sessionStorage.setItem('toolbox_auth', JSON.stringify({ token: 'changed-session' }))
    await store.dismiss(item)
    expect(api.dismissAnnouncement).not.toHaveBeenCalled()
    expect(store.items).toEqual([])
  })
})
