<template>
  <div class="app-layout density-compact">
    <AppHeader :is-admin="true" @toggle-sidebar="toggleSidebar" @platform-change="handlePlatformChange" />
    
    <!-- 移动端侧边栏遮罩 -->
    <div
      v-if="showMobileSidebar"
      class="sidebar-overlay"
      @click="closeSidebar"
    ></div>
    
    <div class="layout">
      <AdminSidebar :class="{ 'mobile-open': showMobileSidebar }" />
      <main class="content admin-content">
        <AppNoticeQueue />
        <Breadcrumb />
        <router-view :key="platformKey" v-slot="{ Component }">
          <Suspense>
            <template #default>
              <component :is="Component" />
            </template>
            <template #fallback>
              <LoadingSkeleton :type="skeletonType(route.meta?.skeleton)" />
            </template>
          </Suspense>
        </router-view>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import AdminSidebar from '@/components/AdminSidebar.vue'
import Breadcrumb from '@/components/Breadcrumb.vue'
import LoadingSkeleton from '@/components/LoadingSkeleton.vue'
import AppNoticeQueue from '@/features/shell/AppNoticeQueue.vue'
import { provideShellPageHeader } from '@/features/shell/pageHeaderContext'

provideShellPageHeader()
const router = useRouter()
const route = useRoute()
const showMobileSidebar = ref(false)
const platformKey = ref(0)
let removeAfterEach: (() => void) | undefined

function skeletonType(value: unknown): 'default' | 'dashboard' | 'table' | 'grid' {
  return value === 'dashboard' || value === 'table' || value === 'grid' ? value : 'default'
}

function toggleSidebar() {
  showMobileSidebar.value = !showMobileSidebar.value
  document.body.style.overflow = showMobileSidebar.value ? 'hidden' : ''
}

function closeSidebar() {
  showMobileSidebar.value = false
  document.body.style.overflow = ''
}

function handlePlatformChange() {
  // 切换平台时强制重新渲染子组件，触发数据重新加载
  platformKey.value++
}

// 路由变化时关闭侧边栏
removeAfterEach = router.afterEach(() => {
  closeSidebar()
})

onUnmounted(() => {
  removeAfterEach?.()
  document.body.style.overflow = ''
})
</script>

<style scoped>
.app-layout {
  --shell-header-height: 88px;
  min-height: 100vh;
  background: var(--color-canvas);
  display: flex;
  flex-direction: column;
}

/* Header 左侧留空，为固定侧边栏让位 */
.app-layout :deep(.studio-header) {
  width: calc(100% - var(--sidebar-width, 200px));
  margin-left: var(--sidebar-width, 200px);
  box-sizing: border-box;
}

/* 主布局 - 侧边栏全高，内容区独立 */
.layout {
  flex: 1;
  display: flex;
  min-height: calc(100vh - var(--shell-header-height));
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 0;
  gap: 0;
}

/* 主内容区左侧留空，为固定侧边栏让位 */
.content {
  width: calc(100% - var(--sidebar-width, 200px));
  flex: 0 0 auto;
  min-width: 0;
  padding: 24px clamp(24px, 3vw, 42px) 48px;
  overflow-y: auto;
  overflow-x: hidden;
  margin-left: var(--sidebar-width, 200px);
  max-width: calc(100vw - var(--sidebar-width, 200px));
  box-sizing: border-box;
}

.content:focus,
.admin-content :deep([data-route-focus]:focus) {
  outline: none;
}

/* 移动端：取消 margin-left，侧边栏变为抽屉式 */
@media (max-width: 1024px) {
  .app-layout { --shell-header-height: 72px; }
  .app-layout :deep(.studio-header) {
    width: 100%;
    margin-left: 0;
  }
  .content {
    margin-left: 0;
    width: 100%;
    max-width: 100vw;
  }
}

.content > :deep(*) {
  max-width: var(--content-max-width, 1400px);
  margin-left: auto;
  margin-right: auto;
}

/* 移动端侧边栏遮罩 */
.sidebar-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: var(--color-overlay);
  backdrop-filter: blur(4px);
  z-index: calc(var(--z-sidebar) - 1);
}

@media (max-width: 1024px) {
  .sidebar-overlay {
    display: block;
  }
  .layout {
    flex-direction: column;
  }
  .content {
    padding: var(--space-4, 1rem);
  }
}

/* 后台统一信息密度与视觉骨架 */
.admin-content :deep(> *) { width: min(var(--content-max-width), 100%); }
.admin-content :deep(.page-title),
.admin-content :deep(> div > h2:first-child) {
  margin: 0 0 22px !important;
  padding: 0 !important;
  border: 0 !important;
  color: var(--color-text) !important;
  font-size: var(--type-page) !important;
  line-height: 1.25 !important;
  letter-spacing: -.03em !important;
}
.admin-content :deep(.page-header) {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}
.admin-content :deep(.page-header .page-title) { margin-bottom: 0 !important; }
.admin-content :deep(.stats-row) { gap: 14px; margin-bottom: 18px; }
.admin-content :deep(.stat-card) {
  min-height: 112px;
  padding: 18px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-low);
}
.admin-content :deep(.stat-card:hover) { transform: none; border-color: var(--color-border-strong); box-shadow: var(--shadow-medium); }
.admin-content :deep(.stat-icon) { width: 42px; height: 42px; border-radius: 12px; color: var(--color-primary); background: var(--color-primary-soft) !important; }
.admin-content :deep(.stat-label) { color: var(--color-text-secondary); font-size: var(--type-meta); }
.admin-content :deep(.stat-value) { color: var(--color-text) !important; font-size: 25px; letter-spacing: -.03em; }
.admin-content :deep(.table-card),
.admin-content :deep(.form-card),
.admin-content :deep(.settings-card),
.admin-content :deep(.chart-card),
.admin-content :deep(.panel-section) {
  border: 1px solid var(--color-border) !important;
  border-radius: var(--radius-lg) !important;
  background: var(--color-surface) !important;
  box-shadow: var(--shadow-low) !important;
}
.admin-content :deep(.table-card) { padding: 18px; }
.admin-content :deep(.chart-card) { padding: 20px; }
.admin-content :deep(.card-header),
.admin-content :deep(.table-header) { min-height: 42px; gap: 12px; }
.admin-content :deep(.card-header h3),
.admin-content :deep(.table-header h3),
.admin-content :deep(.chart-header h3) { color: var(--color-text); font-size: 15px; font-weight: 700; }
.admin-content :deep(.filter-bar),
.admin-content :deep(.header-actions) { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.admin-content :deep(.filter-bar) { padding: 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-soft); }
.admin-content :deep(.setting-row) { padding: 16px 0; }
.admin-content :deep(.empty-state) { color: var(--color-text-secondary); }
.admin-content :deep(.mono-text),
.admin-content :deep(.code-link) { color: var(--color-primary); }

@media (max-width: 900px) {
  .admin-content :deep(.stats-row) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .admin-content :deep(.charts-grid) { grid-template-columns: 1fr; }
}

@media (max-width: 560px) {
  .admin-content :deep(.stats-row) { grid-template-columns: 1fr; }
  .admin-content :deep(.page-header) { flex-direction: column; }
}

@media (max-width: 767px) {
  .app-layout { --shell-header-height: 64px; }
}
</style>
