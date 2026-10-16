import { computed, onScopeDispose, ref } from 'vue'
import { defineStore } from 'pinia'

import { dismissAnnouncement, getAnnouncementFeed, markAnnouncementRead } from '@/utils/api'
import { authService } from '@/utils/auth'
import { announcementFeedSchema, type Announcement } from './model'

export const useAnnouncementStore = defineStore('announcement-center', () => {
  const items = ref<Announcement[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref('')
  let request: Promise<void> | null = null
  let revision = 0
  let sessionOwner: string | null = null
  // Server receipts survive restarts; this session cache prevents an older
  // in-flight feed from resurrecting a successfully closed announcement.
  const acknowledged = new Map<string, 'read' | 'dismiss'>()
  const receiptKey = (item: Announcement): string => `${item.id}:${item.revision}`

  function currentCustomer(): string | null {
    if (authService.getRole() !== 'user') return null
    const auth = authService.getAuth()
    const token = auth?.token || sessionStorage.getItem('toolbox_token') || localStorage.getItem('toolbox_token')
    if (!token) return null
    const user = authService.getUser()
    // Kept in memory only, never persisted or logged. A response/receipt from
    // another license, device or login session cannot enter this notice list.
    return JSON.stringify([user?.auth_code_id, user?.device_id, user?.product_type, token])
  }

  function synchronizeSession(): string | null {
    const owner = currentCustomer()
    if (owner !== sessionOwner) {
      revision += 1
      sessionOwner = owner
      items.value = []
      loaded.value = false
      error.value = ''
      loading.value = false
      request = null
      acknowledged.clear()
    }
    return owner
  }

  const unreadCount = computed(() => items.value.filter(item => !item.is_read).length)
  // A receipt is scoped by the API to announcement id + revision + customer
  // identity/device. Only an unread modal is allowed to interrupt the user;
  // once it was read in Message Center it remains available there without
  // blocking every subsequent visit to the user workspace.
  const banner = computed(() => items.value.find(item => (item.presentation === 'banner' || item.severity !== 'critical') && !item.is_dismissed) ?? null)
  const critical = computed(() => items.value.find(item => item.severity === 'critical' && item.presentation === 'modal' && !item.is_dismissed && !item.is_read) ?? null)

  function applyReceipts(): void {
    for (const item of items.value) {
      const action = acknowledged.get(receiptKey(item))
      if (!action) continue
      item.is_read = true
      if (action === 'dismiss') item.is_dismissed = true
    }
  }

  async function load(force = false): Promise<void> {
    const owner = synchronizeSession()
    if (!owner) return
    if (request) return request
    if (loaded.value && !force) return
    loading.value = true
    error.value = ''
    const sequence = revision
    request = (async () => {
      const payload: unknown = await getAnnouncementFeed()
      if (sequence === revision && owner === currentCustomer()) {
        items.value = announcementFeedSchema.parse(payload)
        applyReceipts()
        loaded.value = true
      }
    })().catch((cause: unknown) => {
      if (sequence === revision && owner === currentCustomer()) error.value = '消息暂时无法读取，请重试。'
      throw cause
    }).finally(() => {
      if (sequence === revision) {
        loading.value = false
        request = null
      }
    })
    return request
  }

  async function saveReceipt(item: Announcement, action: 'read' | 'dismiss'): Promise<void> {
    const owner = synchronizeSession()
    if (!owner || !items.value.includes(item)) return
    if (action === 'read' && item.is_read) return
    const sequence = revision
    const viewed = { id: item.id, revision: item.revision, key: receiptKey(item) }
    try {
      const response = await (action === 'read' ? markAnnouncementRead : dismissAnnouncement)(viewed.id, viewed.revision)
      if (sequence !== revision || owner !== currentCustomer()) return
      const receipt = response?.data
      if (!response?.success || !receipt || receipt.announcement_id !== viewed.id || receipt.revision !== viewed.revision || receipt.action !== action) {
        throw Object.assign(new Error('公告确认结果与刚才阅读的内容不一致，请重新读取后确认。'), { status: 409 })
      }
      if (action === 'dismiss' || !acknowledged.has(viewed.key)) acknowledged.set(viewed.key, action)
      applyReceipts()
    } catch (cause) {
      if (sequence === revision && owner === currentCustomer() && typeof cause === 'object' && cause !== null && 'status' in cause && cause.status === 409) {
        // Finish any older feed first; joining it alone could leave the stale
        // revision visible after a publication conflict.
        if (request) await request.catch(() => undefined)
        if (sequence === revision && owner === currentCustomer()) {
          try {
            await load(true)
            if (sequence === revision && owner === currentCustomer()) error.value = '公告内容已更新，请阅读最新内容后再确认。'
          } catch { /* load already keeps the retryable feed error visible */ }
        }
      }
      throw cause
    }
  }

  const read = (item: Announcement): Promise<void> => saveReceipt(item, 'read')
  const dismiss = (item: Announcement): Promise<void> => saveReceipt(item, 'dismiss')

  const refreshSession = (): void => { synchronizeSession() }
  window.addEventListener('toolbox:user-updated', refreshSession)
  window.addEventListener('toolbox:auth-cleared', refreshSession)
  onScopeDispose(() => {
    revision += 1
    window.removeEventListener('toolbox:user-updated', refreshSession)
    window.removeEventListener('toolbox:auth-cleared', refreshSession)
  })

  return { items, loading, loaded, error, unreadCount, banner, critical, load, read, dismiss }
})
