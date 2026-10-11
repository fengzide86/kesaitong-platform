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
    }
    return owner
  }

  const unreadCount = computed(() => items.value.filter(item => !item.is_read).length)
  const banner = computed(() => items.value.find(item => item.presentation === 'banner' && !item.is_dismissed) ?? null)
  const critical = computed(() => items.value.find(item => item.presentation === 'modal' && !item.is_dismissed) ?? null)

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

  async function read(item: Announcement): Promise<void> {
    const owner = synchronizeSession()
    if (!owner || !items.value.includes(item)) return
    if (item.is_read) return
    await markAnnouncementRead(item.id)
    if (owner === currentCustomer() && items.value.includes(item)) item.is_read = true
  }

  async function dismiss(item: Announcement): Promise<void> {
    const owner = synchronizeSession()
    if (!owner || !items.value.includes(item)) return
    await dismissAnnouncement(item.id)
    if (owner !== currentCustomer() || !items.value.includes(item)) return
    item.is_read = true
    item.is_dismissed = true
  }

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
