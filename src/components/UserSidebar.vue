<template>
  <aside class="studio-user-sidebar" aria-label="用户导航">
    <!-- 品牌区 -->
    <div class="sidebar-brand-zone">
      <BrandLockup audience="consumer" layout="horizontal" />
    </div>

    <!-- 导航菜单 -->
    <nav class="sidebar-menu-nav">
      <router-link to="/user/tools" class="menu-nav-item" active-class="is-active" :aria-current="isActive('/user/tools') ? 'page' : undefined">
        <Zap :size="16" class="menu-icon" aria-hidden="true" />
        <span class="menu-label">工具箱</span>
      </router-link>
      <router-link to="/user/logs" class="menu-nav-item" active-class="is-active" :aria-current="isActive('/user/logs') ? 'page' : undefined">
        <ClipboardList :size="16" class="menu-icon" aria-hidden="true" />
        <span class="menu-label">执行记录</span>
      </router-link>
      <router-link to="/user/plans" class="menu-nav-item" active-class="is-active" :aria-current="isActive('/user/plans') ? 'page' : undefined">
        <ShieldCheck :size="16" class="menu-icon" aria-hidden="true" />
        <span class="menu-label">套餐与授权</span>
      </router-link>
      <router-link to="/user/devices" class="menu-nav-item" active-class="is-active" :aria-current="isActive('/user/devices') ? 'page' : undefined">
        <Monitor :size="16" class="menu-icon" aria-hidden="true" />
        <span class="menu-label">设备授权</span>
      </router-link>
      <router-link to="/user/ai-chat" class="menu-nav-item" active-class="is-active" :aria-current="isActive('/user/ai-chat') ? 'page' : undefined">
        <MessageCircle :size="16" class="menu-icon" aria-hidden="true" />
        <span class="menu-label">工具帮助</span>
      </router-link>
    </nav>

  </aside>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { Zap, ClipboardList, ShieldCheck, Monitor, MessageCircle } from '@lucide/vue'
import BrandLockup from '@/components/brand/BrandLockup.vue'

const route = useRoute()

function isActive(path: string) {
  return route.path === path || route.path.startsWith(`${path}/`)
}

</script>

<style scoped>
.studio-user-sidebar {
  width: var(--sidebar-width);
  height: 100vh;
  background: rgba(252, 252, 253, .97);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  user-select: none;
  flex-shrink: 0;
  position: fixed;
  top: 0;
  left: 0;
  z-index: var(--z-sidebar);
  backdrop-filter: blur(18px);
}

.sidebar-brand-zone {
  height: var(--shell-header-height, 88px);
  display: flex;
  align-items: center;
  padding: 0 8px 0 20px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

/* Enlarge the original horizontal lockup without moving its subtitle below
   the logo or changing the 224px navigation rail. */
.sidebar-brand-zone :deep(.kst-brand-lockup.is-horizontal) {
  align-items: center;
  gap: 4px;
}
.sidebar-brand-zone :deep(.kst-brand-lockup.is-horizontal .kst-lockup-logo) {
  width: 104px;
  height: 34px;
}
.sidebar-brand-zone :deep(.kst-brand-lockup.is-horizontal .kst-lockup-subtitle) {
  padding-left: 4px;
  font-size: 11.5px;
  line-height: 1.45;
}

.sidebar-menu-nav {
  flex-grow: 1;
  padding: 22px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  overflow-y: auto;
}

.menu-nav-item {
  min-height: 42px;
  display: flex;
  align-items: center;
  padding: 0 13px;
  gap: 11px;
  border-radius: 10px;
  cursor: pointer;
  position: relative;
  transition: color var(--motion-fast), background var(--motion-fast), transform var(--motion-press);
  text-decoration: none;
  border: none;
  background: transparent;
  width: 100%;
  box-sizing: border-box;
}

.menu-icon {
  width: 16px;
  height: 16px;
  color: var(--color-text-tertiary);
  stroke-width: 1.8px;
  transition: color var(--motion-fast);
  flex-shrink: 0;
}

.menu-label {
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 600;
  transition: color var(--motion-fast);
  white-space: nowrap;
}

.menu-nav-item:hover { background: #f2f4f7; }

.menu-nav-item:hover .menu-icon,
.menu-nav-item:hover .menu-label { color: var(--color-text); }

.menu-nav-item.is-active { background: var(--color-primary-soft); }
.menu-nav-item.is-active { box-shadow: inset 0 0 0 1px rgba(45, 95, 202, .045); }

.menu-nav-item.is-active .menu-icon,
.menu-nav-item.is-active .menu-label {
  color: var(--color-primary);
  font-weight: 700;
}

.menu-nav-item.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 3px;
  background: var(--color-primary);
  border-radius: 0 3px 3px 0;
}

@media (max-width: 1024px) {
  .studio-user-sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: min(280px, 86vw);
    z-index: var(--z-sidebar);
    box-shadow: var(--shadow-overlay);
    transform: translateX(-100%);
    transition: transform var(--motion-slow) var(--ease-emphasized);
  }

  .studio-user-sidebar.mobile-open {
    transform: translateX(0);
  }

  .sidebar-brand-zone :deep(.kst-brand-lockup.is-horizontal .kst-lockup-logo) {
    width: 126px;
    height: 44px;
  }
}
</style>
