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
    api.markAnnouncementRead.mockImplementation(async (id, revision) => ({ success: true, data: { announcement_id: id, revision, action: 'read' } }))
    api.dismissAnnouncement.mockImplementation(async (id, revision) => ({ success: true, data: { announcement_id: id, revision, action: 'dismiss' } }))
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

    expect(api.dismissAnnouncement).toHaveBeenCalledWith(1, 2)
    expect(store.unreadCount).toBe(0)
    expect(store.critical).toBeNull()
  })

  it('does not block the workspace again after the same modal was read', async () => {
    const store = useAnnouncementStore()
    await store.load()
    expect(store.critical).not.toBeNull()
    await store.read(store.items[0]!)
    expect(api.markAnnouncementRead).toHaveBeenCalledWith(1, 2)
    expect(store.critical).toBeNull()
    expect(store.items[0]?.is_read).toBe(true)
  })

  it.each(['super_admin', 'operator', 'support', 'agent'])('does not request the customer feed for %s', async role => {
    sessionStorage.setItem('toolbox_role', role)
    const store = useAnnouncementStore()
    await store.load(true)
    expect(api.getAnnouncementFeed).not.toHaveBeenCalled()
    expect(store.items).toEqual([])
  })

  it('shows ordinary modal-configured announcements without blocking work', async () => {
    api.getAnnouncementFeed.mockResolvedValue([{ ...announcement, severity: 'info' }])
    const store = useAnnouncementStore()
    await store.load()
    expect(store.critical).toBeNull()
    expect(store.banner?.id).toBe(announcement.id)
    expect(store.unreadCount).toBe(1)
  })

  it('does not resurrect a closed announcement from a stale in-flight feed', async () => {
    const store = useAnnouncementStore()
    await store.load()
    let resolve!: (value: unknown) => void
    api.getAnnouncementFeed.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const pending = store.load(true)
    await store.dismiss(store.items[0]!)
    resolve([announcement])
    await pending
    expect(store.critical).toBeNull()
    expect(store.items[0]?.is_dismissed).toBe(true)
  })

  it('uses persisted server receipts after reopening, but shows a new revision', async () => {
    api.getAnnouncementFeed.mockResolvedValue([{ ...announcement, is_read: true, is_dismissed: true }])
    const store = useAnnouncementStore()
    await store.load()
    expect(store.critical).toBeNull()
    api.getAnnouncementFeed.mockResolvedValue([{ ...announcement, revision: 3 }])
    await store.load(true)
    expect(store.critical?.revision).toBe(3)
  })

  it('keeps an unread announcement when saving the receipt fails', async () => {
    const store = useAnnouncementStore()
    await store.load()
    api.dismissAnnouncement.mockRejectedValueOnce(new Error('offline'))
    await expect(store.dismiss(store.items[0]!)).rejects.toThrow('offline')
    expect(store.critical?.id).toBe(announcement.id)
    expect(store.items[0]?.is_read).toBe(false)
  })

  it.each(['read', 'dismiss'] as const)('refreshes a published revision after a conflicting %s without acknowledging it', async action => {
    const store = useAnnouncementStore(); await store.load()
    const receipt = action === 'read' ? api.markAnnouncementRead : api.dismissAnnouncement
    receipt.mockRejectedValueOnce(Object.assign(new Error('公告内容已更新'), { status: 409 }))
    api.getAnnouncementFeed.mockResolvedValue([{ ...announcement, revision: 3, content: '新版内容' }])
    await expect(store[action](store.items[0]!)).rejects.toThrow('公告内容已更新')
    expect(receipt).toHaveBeenCalledWith(1, 2)
    expect(store.critical?.revision).toBe(3)
    expect(store.items[0]?.is_read).toBe(false)
    expect(store.items[0]?.is_dismissed).toBe(false)
    expect(store.error).toContain('请阅读最新内容后再确认')
  })

  it('waits for an older in-flight feed before refreshing after a revision conflict', async () => {
    const store = useAnnouncementStore(); await store.load()
    let resolve!: (value: unknown) => void
    api.getAnnouncementFeed.mockReturnValueOnce(new Promise(done => { resolve = done }))
    api.getAnnouncementFeed.mockResolvedValueOnce([{ ...announcement, revision: 3 }])
    const pendingFeed = store.load(true)
    api.dismissAnnouncement.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
    const pendingReceipt = expect(store.dismiss(store.items[0]!)).rejects.toThrow('conflict')
    resolve([announcement]); await pendingFeed; await pendingReceipt
    expect(api.getAnnouncementFeed).toHaveBeenCalledTimes(3)
    expect(store.critical?.revision).toBe(3)
    expect(store.items[0]?.is_read).toBe(false)
  })

  it.each([
    { announcement_id: 99, revision: 2, action: 'dismiss' },
    { announcement_id: 1, revision: 3, action: 'dismiss' },
    { announcement_id: 1, revision: 2, action: 'read' },
  ])('does not acknowledge a mismatched receipt: %j', async receipt => {
    const store = useAnnouncementStore(); await store.load()
    api.dismissAnnouncement.mockResolvedValueOnce({ success: true, data: receipt })
    await expect(store.dismiss(store.items[0]!)).rejects.toThrow('公告确认结果')
    expect(store.critical?.revision).toBe(2)
    expect(store.items[0]?.is_dismissed).toBe(false)
  })

  it('does not apply a delayed old-revision receipt to a newly loaded revision', async () => {
    const store = useAnnouncementStore(); await store.load()
    let resolve!: (value: unknown) => void
    api.dismissAnnouncement.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const pending = store.dismiss(store.items[0]!)
    api.getAnnouncementFeed.mockResolvedValue([{ ...announcement, revision: 3 }]); await store.load(true)
    resolve({ success: true, data: { announcement_id: 1, revision: 2, action: 'dismiss' } }); await pending
    expect(store.critical?.revision).toBe(3)
    expect(store.items[0]?.is_read).toBe(false)
  })

  it('ignores a delayed receipt after switching to another customer', async () => {
    const store = useAnnouncementStore(); await store.load()
    let resolve!: (value: unknown) => void
    api.dismissAnnouncement.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const pending = store.dismiss(store.items[0]!)
    sessionStorage.setItem('toolbox_auth', JSON.stringify({ token: 'other-session' }))
    sessionStorage.setItem('toolbox_user', JSON.stringify({ auth_code_id: 2, device_id: 'device-two' }))
    window.dispatchEvent(new Event('toolbox:user-updated'))
    await store.load()
    resolve({ success: true, data: { announcement_id: 1, revision: 2, action: 'dismiss' } }); await pending
    expect(store.critical?.revision).toBe(2)
    expect(store.items[0]?.is_read).toBe(false)
    expect(store.items[0]?.is_dismissed).toBe(false)
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
