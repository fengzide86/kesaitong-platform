import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { authService } from '@/utils/auth'
import { hasBusinessWorkspaceAccess } from '@/features/auth/model'
import type { BackofficeRole } from '@/features/auth/model'
import { getRuntimeCapabilities } from '@/runtime/capabilities'

// A build-time branch keeps the website, its photographs and its simulation
// out of the Windows package. The separate marketing build owns those pages.
const landingRoutes: RouteRecordRaw[] = import.meta.env.VITE_DESKTOP_BUILD ? [
  { path: '/', name: 'Landing', redirect: { name: 'UserLogin' } },
] : [
  {
    path: '/',
    name: 'Landing',
    component: () => import('@/views/LandingView.vue'),
    meta: { title: '跨境电商赛训效率平台', public: true }
  },
]

const routes: RouteRecordRaw[] = [
  ...landingRoutes,
  {
    path: '/user/login',
    name: 'UserLogin',
    component: () => import('@/views/user/LoginView.vue'),
    meta: { title: '授权登录' }
  },
  {
    path: '/user/terms',
    name: 'UserTerms',
    component: () => import('@/views/user/TermsView.vue'),
    meta: { title: '服务条款' }
  },
  // 管理员登录路由
  {
    path: '/admin/login',
    alias: '/agent/login',
    name: 'AdminLogin',
    component: () => import('@/views/admin/AdminLoginView.vue'),
    meta: { title: '后台账号登录' }
  },
  {
    path: '/user',
    component: () => import('@/layouts/UserLayout.vue'),
    redirect: { name: 'UserTools' },
    children: [
      {
        path: 'dashboard',
        name: 'UserDashboard',
        redirect: { name: 'UserTools' },
        meta: { title: '工具箱' }
      },
      {
        path: 'tools',
        name: 'UserTools',
        component: () => import('@/views/user/ToolsView.vue'),
        meta: { title: '工具箱', skeleton: 'grid' }
      },
      {
        path: 'logs',
        name: 'UserLogs',
        component: () => import('@/views/user/LogsView.vue'),
        meta: { title: '执行记录', skeleton: 'table' }
      },
      {
        path: 'faq',
        name: 'UserFaq',
        redirect: { name: 'UserAIChat' }
      },
      {
        path: 'plans',
        name: 'UserPlans',
        component: () => import('@/views/user/PlansView.vue'),
        meta: { title: '套餐与授权', skeleton: 'grid' }
      },
      {
        path: 'devices',
        name: 'UserDevices',
        component: () => import('@/views/user/DevicesView.vue'),
        meta: { title: '设备授权', skeleton: 'table' }
      },
      {
        path: 'ai-chat',
        name: 'UserAIChat',
        component: () => import('@/views/user/AIChatView.vue'),
        meta: { title: '工具帮助', skeleton: 'default' }
      }
    ]
  },
  {
    path: '/admin/change-password',
    name: 'AdminChangePassword',
    component: () => import('@/views/admin/ChangePasswordView.vue'),
    meta: { title: '修改后台密码', roles: ['super_admin', 'operator', 'support', 'agent'] },
  },
  {
    path: '/agent',
    component: () => import('@/features/agency/AgentLayout.vue'),
    redirect: { name: 'AgentOverview' },
    meta: { roles: ['agent'] },
    children: [
      { path: 'overview', name: 'AgentOverview', component: () => import('@/features/agency/AgentOverviewView.vue'), meta: { title: '我的概览' } },
      { path: 'customers', name: 'AgentCustomers', component: () => import('@/features/agency/AgencyRecordsView.vue'), props: { section: 'customers' }, meta: { title: '我的客户' } },
      { path: 'orders', name: 'AgentOrders', component: () => import('@/features/agency/AgencyRecordsView.vue'), props: { section: 'orders' }, meta: { title: '我的订单' } },
      { path: 'licenses', name: 'AgentLicenses', component: () => import('@/features/agency/AgencyRecordsView.vue'), props: { section: 'licenses' }, meta: { title: '我的授权' } },
      { path: 'requests', name: 'AgentRequests', component: () => import('@/features/agency/AgencyRecordsView.vue'), props: { section: 'requests' }, meta: { title: '售后支持' } },
      { path: 'commission', name: 'AgentCommission', component: () => import('@/features/agency/AgentCommissionView.vue'), meta: { title: '返佣结算' } },
      { path: 'account', name: 'AgentAccount', component: () => import('@/features/agency/AgentAccountView.vue'), meta: { title: '个人账号' } },
    ],
  },
  {
    path: '/business',
    component: () => import('@/layouts/BusinessLayout.vue'),
    redirect: { name: 'BusinessOverview' },
    meta: { productType: 'business', entitlement: 'batch_execution' },
    children: [
      {
        path: 'overview',
        name: 'BusinessOverview',
        component: () => import('@/views/business/OverviewView.vue'),
        meta: { title: '工作概览', productType: 'business', entitlement: 'batch_execution' },
      },
      {
        path: 'workspace',
        name: 'BusinessWorkspace',
        component: () => import('@/views/business/WorkspaceView.vue'),
        meta: { title: '批量工作台', productType: 'business', entitlement: 'batch_execution' },
      },
      {
        path: 'records',
        name: 'BusinessRecords',
        component: () => import('@/views/business/RecordsView.vue'),
        meta: { title: '批量执行记录', productType: 'business', entitlement: 'batch_execution' },
      },
      {
        path: 'license',
        name: 'BusinessLicense',
        component: () => import('@/views/business/LicenseView.vue'),
        meta: { title: '授权与席位', productType: 'business', entitlement: 'batch_execution' },
      },
    ],
  },
  // 管理后台路由
  {
    path: '/admin',
    component: () => import('@/layouts/AdminLayout.vue'),
    redirect: '/admin/dashboard',
    children: [
      {
        path: 'agency',
        name: 'AdminAgency',
        component: () => import('@/features/agency/AgencyManagementView.vue'),
        meta: { title: '代理与交付', roles: ['super_admin'] },
      },
      {
        path: 'dashboard',
        name: 'AdminDashboard',
        component: () => import('@/views/admin/DashboardView.vue'),
        meta: { title: '行动中心', skeleton: 'dashboard', roles: ['super_admin', 'operator', 'support'] }
      },
      {
        path: 'authcodes',
        name: 'AdminAuthCodes',
        component: () => import('@/views/admin/AuthCodesView.vue'),
        meta: { title: '授权码管理', skeleton: 'table', roles: ['super_admin', 'operator', 'support'] }
      },
      {
        path: 'business-access',
        name: 'AdminBusinessAccess',
        component: () => import('@/views/admin/BusinessAccessView.vue'),
        meta: { title: '工作台开放', skeleton: 'dashboard', roles: ['super_admin', 'operator'] }
      },
      {
        path: 'orders',
        name: 'AdminOrders',
        component: () => import('@/views/admin/OrdersView.vue'),
        meta: { title: '订单管理', skeleton: 'table', roles: ['super_admin', 'operator', 'support'] }
      },
      {
        path: 'profit',
        name: 'AdminProfit',
        component: () => import('@/views/admin/ProfitView.vue'),
        meta: { title: '分润管理', skeleton: 'table', roles: ['super_admin', 'operator'] }
      },
      {
        path: 'expenses',
        name: 'AdminExpenses',
        component: () => import('@/views/admin/ExpensesView.vue'),
        meta: { title: '公账支出', skeleton: 'dashboard', roles: ['super_admin', 'operator'] }
      },
      {
        path: 'settings',
        name: 'AdminSettings',
        component: () => import('@/views/admin/SettingsView.vue'),
        meta: { title: '系统设置', skeleton: 'default', roles: ['super_admin'] }
      },
      {
        path: 'users',
        name: 'AdminUsers',
        component: () => import('@/views/admin/UsersView.vue'),
        meta: { title: '用户管理', skeleton: 'table', roles: ['super_admin', 'operator', 'support'] }
      },
      {
        path: 'feedback',
        name: 'AdminFeedback',
        component: () => import('@/views/admin/FeedbackView.vue'),
        meta: { title: '工单管理', skeleton: 'table', roles: ['super_admin', 'operator', 'support'] }
      },
      {
        path: 'knowledge',
        name: 'AdminKnowledge',
        component: () => import('@/views/admin/KnowledgeView.vue'),
        meta: { title: '知识库管理', skeleton: 'table', roles: ['super_admin', 'operator', 'support'] }
      },
      {
        path: 'ai-chat',
        name: 'AdminAIChat',
        component: () => import('@/views/admin/AIChatView.vue'),
        meta: { title: '客服规则管理', skeleton: 'default', roles: ['super_admin', 'operator', 'support'] }
      },
      {
        path: 'announcements',
        name: 'AdminAnnouncements',
        component: () => import('@/views/admin/AnnouncementsView.vue'),
        meta: { title: '公告管理', skeleton: 'table', roles: ['super_admin', 'operator', 'support'] }
      },
      {
        path: 'target-reviews',
        name: 'AdminTargetReviews',
        component: () => import('@/views/admin/TargetReviewsView.vue'),
        meta: { title: '平台入口审核', skeleton: 'default', roles: ['super_admin'] },
      },
      {
        path: 'updates',
        name: 'AdminUpdates',
        component: () => import('@/views/admin/UpdateReleasesView.vue'),
        meta: { title: '应用更新', skeleton: 'table', roles: ['super_admin'] }
      },
      {
        path: 'freight-rates',
        name: 'AdminFreightRates',
        component: () => import('@/views/admin/FreightRatesView.vue'),
        meta: { title: '物流费率中心', skeleton: 'default', roles: ['super_admin'] }
      },
      {
        path: 'staff-accounts',
        name: 'AdminStaffAccounts',
        component: () => import('@/views/admin/StaffAccountsView.vue'),
        meta: { title: '后台账号管理', skeleton: 'table', roles: ['super_admin'] }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: '页面未找到', public: true },
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) return { el: to.hash, top: 88 }
    return { top: 0 }
  }
})

// 路由守卫 - 使用 AuthService 统一管理
router.beforeEach((to, from, next) => {
  try {
    const isAuthenticated = authService.isAuthenticated()
    const isBackoffice = authService.isBackoffice()
    const role = authService.getRole()
    const staffHome = role === 'agent' ? 'AgentOverview' : 'AdminDashboard'
    const user = authService.getUser() || {}
    const hasBusinessAccess = hasBusinessWorkspaceAccess(user)
    // The website markets the product; the installed app still opens its
    // existing login/workspace flow, including remembered-license recovery.
    if (to.name === 'Landing' && getRuntimeCapabilities().isDesktop) {
      next({ name: 'UserLogin' })
      return
    }
    
    // 登录页不需要验证
    if (to.meta.public || to.name === 'UserTerms' || to.name === 'NotFound') {
      next()
      return
    }
    if (to.name === 'UserLogin' || to.name === 'AdminLogin') {
      if (isAuthenticated) {
        // 已登录，根据角色跳转
        next({ name: isBackoffice ? (user.force_password_reset ? 'AdminChangePassword' : staffHome) : hasBusinessAccess ? 'BusinessOverview' : 'UserTools' })
      } else {
        next()
      }
      return
    }
    
    if (to.path.startsWith('/agent')) {
      if (!isAuthenticated) next({ name: 'AdminLogin' })
      else if (role !== 'agent') next({ name: isBackoffice ? 'AdminDashboard' : hasBusinessAccess ? 'BusinessOverview' : 'UserTools' })
      else if (user.force_password_reset) next({ name: 'AdminChangePassword' })
      else next()
      return
    }

    // Agent accounts never enter the internal console (except shared password change).
    if (isAuthenticated && role === 'agent' && to.name !== 'AdminChangePassword') {
      next({ name: 'AgentOverview' })
      return
    }

    // 管理后台需要管理员角色
    if (to.path.startsWith('/admin')) {
      if (!isAuthenticated) {
        next({ name: 'AdminLogin' })
        return
      }
      if (!isBackoffice) {
        next({ name: 'UserTools' })
        return
      }
      if (user.force_password_reset && to.name !== 'AdminChangePassword') {
        next({ name: 'AdminChangePassword' })
        return
      }
      const allowedRoles = Array.isArray(to.meta.roles) ? to.meta.roles as BackofficeRole[] : ['super_admin', 'operator', 'support']
      if (!allowedRoles.includes(role)) {
        next({ name: staffHome, query: { access: 'role-required' } })
        return
      }
      next()
      return
    }

    if (to.path.startsWith('/business')) {
      if (!isAuthenticated) {
        next({ name: 'UserLogin' })
        return
      }
      if (isBackoffice) {
        next({ name: 'AdminDashboard' })
        return
      }
      if (!hasBusinessAccess) {
        next({ name: 'UserTools', query: { access: 'business-required' } })
        return
      }
      next()
      return
    }
    
    // 用户端页面需要验证
    if (!isAuthenticated) {
      next({ name: 'UserLogin' })
      return
    }
    if (!isBackoffice && hasBusinessAccess && to.path.startsWith('/user')) {
      next({ name: to.name === 'UserPlans' ? 'BusinessLicense' : 'BusinessOverview' })
      return
    }
    
    next()
  } catch (err) {
    console.error('Router guard error:', err)
    // 发生错误时，清除认证信息并跳转到登录页
    authService.clear()
    next({ name: 'UserLogin' })
  }
})

router.afterEach((to) => {
  if (typeof document === 'undefined') return
  document.title = `${String(to.meta.title || '课赛通 KST')} · 课赛通 KST`
  const focusRoute = () => {
    const target = document.querySelector<HTMLElement>('[data-route-focus], main')
    if (!target) return
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
    target.focus({ preventScroll: true })
  }
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(focusRoute)
  else setTimeout(focusRoute, 0)
})

export default router
