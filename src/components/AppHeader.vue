<template>
  <header class="studio-header">
    <div class="header-inner">
      <div class="header-leading">
        <button class="hamburger-btn" type="button" aria-label="打开导航菜单" title="打开导航菜单" @click="$emit('toggle-sidebar')">
          <Menu :size="18" />
        </button>
        <BrandMark class="mobile-brand-mark" :size="28" compact decorative />
        <div class="shell-page-copy" data-testid="shell-page-header">
          <span v-if="currentPageEyebrow" class="shell-page-eyebrow">{{ currentPageEyebrow }}</span>
          <h1>{{ currentPageTitle }}</h1>
          <p v-if="currentPageDescription">{{ currentPageDescription }}</p>
        </div>
      </div>

      <div class="header-tools">
        <div id="shell-page-actions" class="shell-page-actions" aria-label="页面操作"></div>

        <div v-if="showPlatformSwitcher" class="platform-switcher" data-testid="platform-switcher">
          <el-select v-model="currentPlatformModel" aria-label="切换平台" size="small" class="platform-select" @change="handlePlatformSelect">
            <el-option
              v-for="platform in availablePlatformsForUser"
              :key="platform.key"
              :label="platform.short_name || platform.name"
              :value="platform.key"
              :disabled="!hasPermission(platform.key)"
            />
          </el-select>
        </div>

        <div class="header-right">
          <span v-if="!isAdmin && planBadge" :class="['plan-badge', { business: isBusiness }]">{{ planBadge }}</span>
          <MessageCenter v-if="!isAdmin" />
          <UpdateStatusEntry :details-disabled="isBusiness && route.name === 'BusinessWorkspace'" />
          <span v-if="isAdmin" class="admin-badge">{{ backofficeLabel }}</span>

          <el-dropdown trigger="click" placement="bottom-end" @command="handleCommand">
            <button class="avatar-wrapper" type="button" :title="displayName" :aria-label="`${displayName}账号菜单`">
              <span class="avatar-circle" :class="{ 'admin-avatar': isAdmin }">
                <Crown v-if="isAdmin && backofficeRole === 'super_admin'" :size="15" />
                <ShieldCheck v-else-if="isAdmin" :size="15" />
                <span v-else>{{ userInitial }}</span>
              </span>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <template v-if="!isAdmin && !isBusiness">
                  <el-dropdown-item command="devices" :icon="Monitor">设备换绑</el-dropdown-item>
                  <el-dropdown-item command="plans" :icon="PriceTag">续费中心</el-dropdown-item>
                </template>
                <el-dropdown-item v-else-if="isBusiness" command="business-license" :icon="PriceTag">授权信息</el-dropdown-item>
                <el-dropdown-item v-if="isAdmin" command="change-password" :icon="Lock">修改密码</el-dropdown-item>
                <el-dropdown-item v-if="updateStore.supported" command="check-update" :icon="Refresh">检查更新</el-dropdown-item>
                <el-dropdown-item divided command="logout" :icon="SwitchButton" class="logout-item">退出系统</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>
    <div v-if="updateStore.state.status === 'downloading'" class="header-download-progress" aria-hidden="true">
      <span :style="{ width: `${updateStore.state.percent ?? 0}%` }" />
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Lock, Monitor, PriceTag, Refresh, SwitchButton } from '@element-plus/icons-vue'
import { Crown, Menu, ShieldCheck } from '@lucide/vue'

import MessageCenter from '@/features/announcements/MessageCenter.vue'
import UpdateStatusEntry from '@/features/updates/UpdateStatusEntry.vue'
import BrandMark from '@/components/brand/BrandMark.vue'
import { useUpdateStore } from '@/features/updates/store'
import { Auth } from '@/utils'
import { usePlatformStore } from '@/stores/platform'
import { authService } from '@/utils/auth'
import { staffRoleLabel } from '@/features/auth/permissions'
import { logoutStaff } from '@/utils/api'
import { useShellPageHeader } from '@/features/shell/pageHeaderContext'
import { licensePlanCode, readStoredLicense } from '@/features/user/model'

const props = withDefaults(defineProps<{ isAdmin?: boolean; isBusiness?: boolean }>(), { isAdmin: false, isBusiness: false })
const emit = defineEmits<{ 'toggle-sidebar': []; 'platform-change': [platformKey: string] }>()
interface PlatformOption { key: string; short_name: string; name: string; status: string }

const router = useRouter()
const route = useRoute()
const shellPageHeader = useShellPageHeader()
const platformStore = usePlatformStore()
const updateStore = useUpdateStore()
const currentUser = ref(authService.getUser())
const refreshProfile = () => { currentUser.value = authService.getUser() }
const backofficeRole = computed(() => authService.getRole())
const backofficeLabel = computed(() => staffRoleLabel(backofficeRole.value))
const currentPageTitle = computed(() => shellPageHeader?.current.value?.title || String(route.meta?.title || (props.isAdmin ? '管理后台' : '跨境电商效率工具')))
const currentPageDescription = computed(() => shellPageHeader?.current.value?.description || '')
const currentPageEyebrow = computed(() => shellPageHeader?.current.value?.eyebrow || '')
const showPlatformSwitcher = computed(() => availablePlatformsForUser.value.length > 1)
const currentPlatform = computed(() => platformStore.currentPlatform)
const adminPlatform = computed(() => platformStore.adminPlatform)

const displayName = computed(() => {
  if (props.isAdmin) return currentUser.value?.display_name || currentUser.value?.username || staffRoleLabel(backofficeRole.value)
  try {
    const user = currentUser.value || {}
    return user.username || user.name || '用户'
  } catch { return '用户' }
})
const userInitial = computed(() => displayName.value.charAt(0).toUpperCase())
const currentPlatformModel = computed({
  get: () => props.isAdmin ? adminPlatform.value : currentPlatform.value,
  set: value => handlePlatformSelect(value),
})
const availablePlatformsForUser = computed<PlatformOption[]>(() => {
  if (props.isAdmin) {
    const allOption = { key: 'all', short_name: '全部平台', name: '全部平台', status: 'available' }
    return [allOption, ...(platformStore.availablePlatforms as PlatformOption[]).filter(platform => platform.status === 'available')]
  }
  return platformStore.getAvailablePlatformsForUser(getPlatformScope()) as PlatformOption[]
})
const planBadge = computed(() => {
  try {
    if (props.isBusiness) return '专业版'
    const code = licensePlanCode(readStoredLicense())
    return code === 'Y999' ? '陪跑包' : code === 'Y199' ? '冲刺包' : ''
  } catch { return '' }
})

function getPlatformScope(): string | null {
  try {
    const scope = localStorage.getItem('toolbox_platform_scope')
    if (scope) {
      const parsed: unknown = JSON.parse(scope)
      if (Array.isArray(parsed)) return parsed.join(',')
    }
  } catch { /* Ignore invalid legacy values. */ }
  try {
    const authData = JSON.parse(localStorage.getItem('toolbox_auth') || '{}')
    if (authData.platform_scope) return Array.isArray(authData.platform_scope) ? authData.platform_scope.join(',') : authData.platform_scope
  } catch { /* Ignore invalid legacy values. */ }
  return null
}
function hasPermission(platformKey: string): boolean {
  return props.isAdmin || platformStore.hasPlatformPermission(getPlatformScope(), platformKey)
}
function handlePlatformSelect(platformKey: string): void {
  if (!hasPermission(platformKey)) return
  if (props.isAdmin) platformStore.setAdminPlatform(platformKey)
  else platformStore.setPlatform(platformKey)
  emit('platform-change', platformKey)
}
function handleCommand(command: string): void {
  if (command === 'logout') void handleLogout()
  else if (command === 'devices') void router.push(props.isAdmin ? '/admin/dashboard' : '/user/devices')
  else if (command === 'plans') void router.push(props.isAdmin ? '/admin/orders' : '/user/plans')
  else if (command === 'business-license') void router.push('/business/license')
  else if (command === 'change-password') void router.push('/admin/change-password')
  else if (command === 'check-update') void updateStore.checkManually()
}
async function handleLogout(): Promise<void> {
  try {
    if (props.isAdmin) await logoutStaff()
  } catch {
    // 服务端不可达时仍需清理本地会话。
  } finally {
    Auth.clear()
    for (const key of ['toolbox_role', 'toolbox_user', 'toolbox_current_platform', 'toolbox_admin_platform', 'toolbox_platform_scope']) localStorage.removeItem(key)
    await router.push(props.isAdmin ? '/admin/login' : '/user/login')
  }
}

onMounted(() => platformStore.loadPlatforms())
onMounted(() => window.addEventListener('toolbox:user-updated', refreshProfile))
onBeforeUnmount(() => window.removeEventListener('toolbox:user-updated', refreshProfile))
</script>

<style scoped>
.studio-header {
  position: sticky;
  top: 0;
  z-index: var(--z-header);
  height: var(--shell-header-height, 88px);
  margin: 0;
  border-bottom: 1px solid var(--color-border);
  background: rgba(252, 252, 253, .96);
  backdrop-filter: blur(18px);
}

.header-inner {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 0 clamp(24px, 3vw, 42px);
}

.header-leading,
.header-tools,
.header-right {
  display: flex;
  align-items: center;
}

.header-leading {
  min-width: 0;
  flex: 1 1 auto;
  gap: 12px;
}

.shell-page-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.shell-page-eyebrow {
  overflow: hidden;
  color: var(--color-primary);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .14em;
  line-height: 1.2;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.shell-page-copy h1 {
  margin: 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: 23px;
  font-weight: 750;
  letter-spacing: -.035em;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.shell-page-copy p {
  max-width: 660px;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  font-size: var(--type-meta);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-tools {
  min-width: 0;
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: 12px;
}

.shell-page-actions {
  min-width: 0;
  flex: 0 0 auto;
}

.shell-page-actions :deep(button),
.shell-page-actions :deep(a) {
  white-space: nowrap;
  flex-shrink: 0;
}

.shell-page-actions:empty { display: none; }
.shell-page-actions:not(:empty) {
  padding-right: 12px;
  border-right: 1px solid var(--color-border);
}

.header-right {
  flex-shrink: 0;
  gap: 9px;
}

.hamburger-btn {
  display: none;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  place-items: center;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  cursor: pointer;
}

.mobile-brand-mark { display: none; }

.platform-switcher { flex: 0 1 150px; }
.platform-select { width: 150px; }
:deep(.platform-select .el-select__wrapper),
:deep(.platform-select .el-input__wrapper) {
  min-height: 36px;
  background: var(--color-surface-soft) !important;
  box-shadow: 0 0 0 1px var(--color-border) inset !important;
}
:deep(.platform-select .el-input__inner) { font-size: var(--type-control); }

.plan-badge,
.admin-badge {
  padding: 5px 9px;
  border: 1px solid rgba(169, 133, 82, .2);
  border-radius: 999px;
  color: var(--color-premium);
  background: var(--color-premium-soft);
  font-size: var(--type-micro);
  font-weight: 750;
  letter-spacing: .03em;
  white-space: nowrap;
}

.admin-badge {
  border-color: rgba(45, 95, 202, .16);
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.avatar-wrapper {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

.avatar-circle {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  color: var(--color-text-secondary);
  background: var(--color-surface-soft);
  font-size: var(--type-control);
  font-weight: 750;
  transition: background var(--motion-fast), color var(--motion-fast), border-color var(--motion-fast);
}

.avatar-wrapper:hover .avatar-circle {
  border-color: rgba(45, 95, 202, .18);
  color: var(--color-primary);
  background: var(--color-primary-soft);
}
.avatar-circle.admin-avatar { border-color: transparent; color: #fff; background: var(--color-primary); }
.header-download-progress { position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; overflow: hidden; background: var(--color-primary-soft); }
.header-download-progress span { display: block; height: 100%; background: var(--color-primary); transition: width var(--motion-fast); }
.logout-item { color: var(--color-danger) !important; }

@media (max-width: 1180px) {
  .shell-page-copy p { max-width: 440px; }
  .shell-page-actions:not(:empty) { padding-right: 8px; }
  .header-tools { gap: 8px; }
}

@media (max-width: 1024px) {
  .hamburger-btn { display: grid; }
  .mobile-brand-mark { display: inline-grid; }
  .header-inner { gap: 16px; padding: 0 18px; }
  .shell-page-copy p { display: none; }
  .shell-page-copy h1 { font-size: 20px; }
  .plan-badge { display: none; }
}

@media (max-width: 860px) {
  .shell-page-eyebrow { display: none; }
  .shell-page-actions:not(:empty) { max-width: 280px; }
}

@media (max-width: 767px) {
  .header-inner { gap: 10px; padding: 0 12px; }
  .header-leading { gap: 8px; }
  .shell-page-copy h1 { max-width: 38vw; font-size: 16px; letter-spacing: -.02em; }
  .platform-switcher { flex: 0 1 112px; }
  .platform-select { width: 112px; }
  .header-right { gap: 4px; }
}

@media (max-width: 520px) {
  .platform-switcher { display: none; }
  .shell-page-copy h1 { max-width: 48vw; }
  .admin-badge { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .header-download-progress span { transition: none; }
}
</style>
