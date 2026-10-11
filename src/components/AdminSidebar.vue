<template>
  <aside class="studio-admin-sidebar" aria-label="管理员导航">
    <!-- 品牌区 -->
    <div class="sidebar-brand-zone">
      <BrandLockup audience="admin" layout="horizontal" />
    </div>

    <!-- 导航菜单 -->
    <nav v-if="areas.length" class="sidebar-menu-nav" aria-label="管理工作区">
      <router-link
        v-for="area in areas"
        :key="area.id"
        :to="selection?.area.id === area.id ? route.fullPath : area.items[0]!.to"
        class="menu-nav-item"
        :class="{ 'is-active': selection?.area.id === area.id }"
        active-class=""
        exact-active-class=""
        :aria-current="selection?.area.id === area.id ? 'location' : undefined"
      >
        <component :is="areaIcons[area.id]" :size="16" class="menu-icon" />
        <span class="menu-label">{{ area.label }}</span>
      </router-link>
    </nav>

  </aside>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { useAdminNavigation } from '@/features/admin/useAdminNavigation'
import type { AdminAreaId } from '@/features/admin/navigation'
import BrandLockup from '@/components/brand/BrandLockup.vue'
import { LayoutDashboard, Users, Receipt, LifeBuoy, WalletCards, Settings } from '@lucide/vue'

const { route, areas, selection } = useAdminNavigation()
const areaIcons: Record<AdminAreaId, Component> = {
  action: LayoutDashboard, customers: Users, orders: Receipt,
  support: LifeBuoy, finance: WalletCards, system: Settings,
}
</script>

<style scoped>
.studio-admin-sidebar {
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
  padding: 0 20px;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.sidebar-menu-nav {
  flex-grow: 1;
  padding: 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
}

.menu-nav-item {
  min-height: 44px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 10px;
  border-radius: 9px;
  cursor: pointer;
  position: relative;
  transition: color var(--motion-fast), background var(--motion-fast), transform var(--motion-press);
  text-decoration: none;
  border: none;
  background: transparent;
  width: 100%;
  box-sizing: border-box;
}

.menu-icon { width: 16px; height: 16px; color: var(--color-text-tertiary); stroke-width: 1.8px; transition: color var(--motion-fast); flex-shrink: 0; }

.menu-label { color: var(--color-text-secondary); font-size:var(--type-meta); font-weight: 600; transition: color var(--motion-fast); white-space: nowrap; }

.menu-nav-item:hover { background: #f2f4f7; }
.menu-nav-item:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }

.menu-nav-item:hover .menu-icon,
.menu-nav-item:hover .menu-label { color: var(--color-text); }

.menu-nav-item.is-active { background: var(--color-primary-soft); }
.menu-nav-item.is-active { box-shadow: inset 0 0 0 1px rgba(45, 95, 202, .045); }

.menu-nav-item.is-active .menu-icon,
.menu-nav-item.is-active .menu-label { color: var(--color-primary); font-weight: 700; }

.menu-nav-item.is-active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 9px;
  bottom: 9px;
  width: 3px;
  background: var(--color-primary);
  border-radius: 0 3px 3px 0;
}

@media (max-width: 1024px) {
  .studio-admin-sidebar {
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

  .studio-admin-sidebar.mobile-open {
    transform: translateX(0);
  }
}
</style>
