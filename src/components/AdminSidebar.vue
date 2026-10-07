<template>
  <aside class="studio-admin-sidebar" aria-label="管理员导航">
    <!-- 品牌区 -->
    <div class="sidebar-brand-zone">
      <BrandLockup audience="admin" layout="horizontal" />
    </div>

    <!-- 导航菜单 -->
    <nav v-if="role !== 'agent'" class="sidebar-menu-nav">
      <router-link to="/admin/dashboard" class="menu-nav-item" active-class="is-active">
        <LayoutDashboard :size="14" class="menu-icon" />
        <span class="menu-label">行动中心</span>
      </router-link>
      <section v-for="group in navigationGroups" :key="group.id" class="menu-group" :aria-labelledby="`admin-nav-${group.id}`">
        <h2 :id="`admin-nav-${group.id}`" class="menu-group-title">{{ group.title }}</h2>
        <router-link v-for="item in group.items" :key="item.path" :to="item.path" class="menu-nav-item" active-class="is-active">
          <component :is="item.icon" :size="14" class="menu-icon" />
          <span class="menu-label">{{ item.label }}</span>
        </router-link>
      </section>
    </nav>

  </aside>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import { authService } from '@/utils/auth'
import { hasStaffPermission, type StaffPermission } from '@/features/auth/permissions'
import BrandLockup from '@/components/brand/BrandLockup.vue'
import {
  LayoutDashboard, Key, BriefcaseBusiness, Receipt, Percent, Users, Wrench,
  BookOpen, MessageSquare, Megaphone, PackageCheck, Settings, ShieldUser, Truck, WalletCards
} from '@lucide/vue'

const role = computed(() => authService.getRole())
const can = (permission: StaffPermission): boolean => hasStaffPermission(role.value, permission)

interface NavigationItem {
  path: string
  label: string
  icon: Component
  visible?: boolean
}

const navigationGroups = computed(() => {
  const groups: { id: string; title: string; items: NavigationItem[] }[] = [
    { id: 'delivery', title: '客户交付', items: [
      { path: '/admin/authcodes', label: '授权码管理', icon: Key },
      { path: '/admin/business-access', label: '专业工作台', icon: BriefcaseBusiness, visible: role.value !== 'support' },
      { path: '/admin/orders', label: '订单与套餐', icon: Receipt },
      { path: '/admin/users', label: '用户管理', icon: Users },
      { path: '/admin/agency', label: '代理与交付', icon: BriefcaseBusiness, visible: can('agency.manage') },
    ] },
    { id: 'support', title: '客户支持', items: [
      { path: '/admin/feedback', label: '工单管理', icon: Wrench },
      { path: '/admin/knowledge', label: '知识库管理', icon: BookOpen },
      { path: '/admin/ai-chat', label: '客服规则管理', icon: MessageSquare, visible: can('rules.write') },
      { path: '/admin/announcements', label: '公告管理', icon: Megaphone },
    ] },
    { id: 'finance', title: '经营结算', items: [
      { path: '/admin/profit', label: '分润管理', icon: Percent, visible: can('profit.read') },
      { path: '/admin/expenses', label: '公账支出', icon: WalletCards, visible: can('expenses.read') },
    ] },
    { id: 'configuration', title: '平台配置', items: [
      { path: '/admin/updates', label: '应用更新', icon: PackageCheck, visible: can('updates.manage') },
      { path: '/admin/freight-rates', label: '物流费率中心', icon: Truck, visible: can('settings.manage') },
      { path: '/admin/settings', label: '系统设置', icon: Settings, visible: can('settings.manage') },
      { path: '/admin/staff-accounts', label: '后台账号管理', icon: ShieldUser, visible: can('staff.manage') },
    ] },
  ]
  return groups.map(group => ({ ...group, items: group.items.filter(item => item.visible !== false) }))
    .filter(group => group.items.length > 0)
})
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
  padding: 18px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow-y: auto;
}

.menu-nav-item {
  min-height: 38px;
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

.menu-group { display: grid; gap: 3px; }
.menu-group-title { margin: 14px 12px 5px; color: var(--color-text-secondary); font-size: var(--type-meta); font-weight: 700; line-height: 1.5; }

.menu-icon { width: 15px; height: 15px; color: var(--color-text-tertiary); stroke-width: 1.8px; transition: color var(--motion-fast); flex-shrink: 0; }

.menu-label { color: var(--color-text-secondary); font-size:var(--type-meta); font-weight: 600; transition: color var(--motion-fast); white-space: nowrap; }

.menu-nav-item:hover { background: #f2f4f7; }

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
