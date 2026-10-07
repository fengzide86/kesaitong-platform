<template>
  <div class="business-layout density-balanced">
    <AppHeader is-business @toggle-sidebar="showSidebar = !showSidebar" />
    <div v-if="showSidebar" class="sidebar-overlay" @click="showSidebar = false"></div>
    <BusinessSidebar :class="{ 'mobile-open': showSidebar }" />
    <main :class="['business-content', { 'is-workspace': route.name === 'BusinessWorkspace' }]">
      <AppNoticeQueue
        :suppress-update="route.name === 'BusinessWorkspace' || store.isActive"
        :hide-announcement-banner="route.name === 'BusinessWorkspace'"
      />
      <router-view v-slot="{ Component }">
        <Suspense><component :is="Component" /></Suspense>
      </router-view>
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import BusinessSidebar from '@/components/BusinessSidebar.vue'
import AppNoticeQueue from '@/features/shell/AppNoticeQueue.vue'
import { useBusinessWorkspaceStore } from '@/stores/businessWorkspace'
import { getCurrentUser } from '@/utils/api'
import { authService } from '@/utils/auth'
import { authenticatedUserSchema } from '@/features/auth/model'
import { provideShellPageHeader } from '@/features/shell/pageHeaderContext'

provideShellPageHeader()
const route = useRoute()
const router = useRouter()
const store = useBusinessWorkspaceStore()
const showSidebar = ref(false)
let removeAfterEach: (() => void) | undefined
let accessTimer: ReturnType<typeof setInterval> | undefined

async function refreshAccess() {
  const currentAuth = authService.getAuth()?.token
  const user = authenticatedUserSchema.parse(await getCurrentUser())
  if (currentAuth !== authService.getAuth()?.token) return false
  const previous = authService.getUser()
  const sameIdentity = previous && String(previous.user_id ?? previous.id) === String(user.user_id ?? user.id)
  authService.setUser(sameIdentity ? { ...previous, ...user } : user)
  const allowed = user?.product_type === 'business'
    && user?.business_workspace_enabled === true
    && user?.entitlements?.batch_execution === true
    && user?.entitlements?.multi_account_workspace === true
  if (!allowed) {
    if (store.isActive) await store.cancelBatch('interrupted').catch(() => {})
    await router.replace('/user/tools')
  }
  return allowed
}

onMounted(async () => {
  try { await store.init() }
  catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'status' in error && error.status === 403) {
      await refreshAccess().catch(() => router.replace('/user/tools'))
    }
    // A transient control-plane failure must not destroy the whole business shell.
  }
  accessTimer = setInterval(() => refreshAccess().catch(() => {}), 30000)
  removeAfterEach = router.afterEach(() => { showSidebar.value = false })
})
onUnmounted(() => {
  if (accessTimer) clearInterval(accessTimer)
  removeAfterEach?.()
  if (store.isActive) void store.cancelBatch('interrupted').finally(() => store.dispose())
  else store.dispose()
})
</script>

<style scoped>
.business-layout{--shell-header-height:88px;min-height:100vh;background:var(--color-canvas);overflow:hidden}.business-layout :deep(.studio-header){width:calc(100% - var(--sidebar-width));margin-left:var(--sidebar-width);box-sizing:border-box}
.business-content{width:calc(100% - var(--sidebar-width));min-width:0;min-height:calc(100vh - var(--shell-header-height));margin-left:var(--sidebar-width);padding:24px clamp(24px,3vw,42px) 48px;box-sizing:border-box;overflow-x:hidden}.business-content:not(.is-workspace)>:deep(*){width:min(1180px,100%);margin-inline:auto}.business-content.is-workspace{height:calc(100vh - var(--shell-header-height));padding:16px 18px 18px;overflow:hidden}
.business-content:focus{outline:none}
.sidebar-overlay{position:fixed;inset:0;z-index:calc(var(--z-sidebar) - 1);background:var(--color-overlay);backdrop-filter:blur(4px)}
@media(max-width:1024px){.business-layout{--shell-header-height:72px}.business-layout :deep(.studio-header),.business-content{width:100%;margin-left:0}.business-content{padding:18px 16px 36px}.business-content.is-workspace{padding:10px;height:calc(100vh - var(--shell-header-height))}}
@media(max-width:767px){.business-layout{--shell-header-height:64px}}
</style>
