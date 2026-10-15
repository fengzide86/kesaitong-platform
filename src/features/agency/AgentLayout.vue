<template>
  <div class="agent-shell">
    <aside class="agent-sidebar">
      <BrandLockup
        layout="horizontal"
        subtitle="代理工作台"
      />
      <nav aria-label="代理导航">
        <router-link
          v-for="item in items"
          :key="item.path"
          :to="`/agent/${item.path}`"
          active-class="is-active"
        >
          <component
            :is="item.icon"
            :size="17"
            aria-hidden="true"
          /><span>{{ item.label }}</span>
        </router-link>
      </nav>
      <div class="scope-note">
        <ShieldCheck :size="17" /><span>仅显示归属本代理的客户与业务</span>
      </div>
    </aside>
    <div class="agent-main">
      <header>
        <div><span class="eyebrow">代理工作台</span><strong>{{ route.meta.title }}</strong></div><router-link to="/agent/account">
          {{ displayName }}<span>代理运营</span>
        </router-link>
      </header>
      <main
        tabindex="-1"
        data-route-focus
      >
        <router-view :key="route.path" />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { LayoutDashboard, Users, Receipt, KeyRound, LifeBuoy, CircleUserRound, ShieldCheck, WalletCards } from '@lucide/vue'
import BrandLockup from '@/components/brand/BrandLockup.vue'
import { useAgentProfile } from './useAgentProfile'
const route = useRoute()
const user = useAgentProfile()
const displayName = computed(() => user.value?.display_name || user.value?.username || '代理账号')
const items = [
  { path: 'overview', label: '我的概览', icon: LayoutDashboard }, { path: 'customers', label: '我的客户', icon: Users },
  { path: 'orders', label: '我的订单', icon: Receipt }, { path: 'licenses', label: '我的授权', icon: KeyRound },
  { path: 'requests', label: '售后支持', icon: LifeBuoy }, { path: 'commission', label: '返佣结算', icon: WalletCards },
  { path: 'account', label: '个人账号', icon: CircleUserRound },
]
</script>

<style scoped>
.agent-shell{min-height:100vh;display:flex;background:var(--color-canvas);color:var(--color-text)}.agent-sidebar{position:sticky;top:0;width:218px;height:100vh;flex-shrink:0;padding:28px 18px 22px;border-right:1px solid var(--color-border);background:var(--color-surface);display:flex;flex-direction:column;gap:34px;box-sizing:border-box}.agent-sidebar :deep(.kst-lockup-logo){max-width:160px}.agent-sidebar nav{display:grid;gap:6px}.agent-sidebar nav a{display:flex;align-items:center;gap:12px;padding:13px 14px;border-radius:10px;text-decoration:none;color:var(--color-text-secondary);font-size:14px;transition:background .15s,color .15s}.agent-sidebar nav a:hover{background:var(--color-surface-soft)}.agent-sidebar nav a.is-active{background:var(--color-primary-soft);color:var(--color-primary);font-weight:700}.scope-note{margin-top:auto;display:flex;align-items:flex-start;gap:8px;padding:12px;color:var(--color-text-tertiary);font-size:12px;line-height:1.7}.scope-note svg{flex-shrink:0;margin-top:3px}.agent-main{flex:1;min-width:0}.agent-main header{min-height:90px;border-bottom:1px solid var(--color-border);background:var(--color-surface);padding:18px clamp(20px,3vw,44px);display:flex;justify-content:space-between;align-items:center;gap:16px;box-sizing:border-box}.agent-main header>div{display:grid;gap:5px}.eyebrow{font-size:10px;font-weight:700;letter-spacing:.14em;color:var(--color-text-tertiary)}.agent-main header strong{font-size:20px}.agent-main header>a{display:grid;gap:4px;text-align:right;text-decoration:none;color:var(--color-text);font-size:13px}.agent-main header>a span{color:var(--color-text-tertiary);font-size:11px}.agent-main main{max-width:1480px;padding:30px clamp(20px,3vw,44px) 48px;box-sizing:border-box;margin:auto;outline:none}@media(max-width:760px){.agent-shell{display:block}.agent-sidebar{position:relative;width:100%;height:auto;padding:18px 16px;gap:16px;border-right:0;border-bottom:1px solid var(--color-border)}.agent-sidebar :deep(.kst-brand-lockup){flex-direction:row;align-items:center}.agent-sidebar nav{display:flex;overflow-x:auto;gap:4px}.agent-sidebar nav a{white-space:nowrap;padding:10px;gap:6px}.scope-note{display:none}.agent-main header{min-height:75px}.agent-main main{padding:22px 16px 40px}}
</style>

<style scoped>
.agent-sidebar{padding-top:22px;gap:24px}.agent-sidebar :deep(.kst-lockup-logo){max-width:90px}.scope-note,.eyebrow,.agent-main header>a span{color:var(--color-text-secondary)}.agent-main header>div{min-width:0}.agent-main header strong,.agent-main header>a{overflow-wrap:anywhere}.agent-main header>a{min-width:0;max-width:38%}
</style>
