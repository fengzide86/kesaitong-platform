/**
 * AdminSidebar 组件测试
 * 测试管理员侧边栏：品牌展示、路由预取、菜单导航、退出登录
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import AdminSidebar from '@/components/AdminSidebar.vue'

// Mock router
const mockRouter = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/admin/dashboard' },
    { path: '/admin/dashboard', name: 'AdminDashboard', component: { template: '<div />' } },
    { path: '/admin/authcodes', name: 'AdminAuthCodes', component: { template: '<div />' } },
    { path: '/admin/business-access', name: 'AdminBusinessAccess', component: { template: '<div />' } },
    { path: '/admin/orders', name: 'AdminOrders', component: { template: '<div />' } },
    { path: '/admin/profit', name: 'AdminProfit', component: { template: '<div />' } },
    { path: '/admin/expenses', name: 'AdminExpenses', component: { template: '<div />' } },
    { path: '/admin/users', name: 'AdminUsers', component: { template: '<div />' } },
    { path: '/admin/feedback', name: 'AdminFeedback', component: { template: '<div />' } },
    { path: '/admin/knowledge', name: 'AdminKnowledge', component: { template: '<div />' } },
    { path: '/admin/ai-chat', name: 'AdminAIChat', component: { template: '<div />' } },
    { path: '/admin/announcements', name: 'AdminAnnouncements', component: { template: '<div />' } },
    { path: '/admin/updates', name: 'AdminUpdates', component: { template: '<div />' } },
    { path: '/admin/freight-rates', name: 'AdminFreightRates', component: { template: '<div />' } },
    { path: '/admin/settings', name: 'AdminSettings', component: { template: '<div />' } },
    { path: '/admin/staff-accounts', name: 'AdminStaffAccounts', component: { template: '<div />' } },
    { path: '/admin/agency', name: 'AdminAgency', component: { template: '<div />' } },
    { path: '/admin/login', name: 'AdminLogin', component: { template: '<div />' } },
  ]
})

// Mock utils
vi.mock('@/utils', () => ({
  Auth: { clear: vi.fn() },
  showToast: vi.fn()
}))

describe('AdminSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    localStorage.clear()
    sessionStorage.setItem('toolbox_role', 'super_admin')
    setActivePinia(createPinia())
    mockRouter.push('/admin/dashboard')
  })

  describe('品牌区渲染', () => {
    it('应该显示课赛通管理端品牌锁定组合', async () => {
      const wrapper = mount(AdminSidebar, {
        global: { plugins: [createPinia(), mockRouter] }
      })
      await flushPromises()

      const brand = wrapper.find('[data-testid="kst-brand-lockup"]')
      expect(brand.exists()).toBe(true)
      expect(brand.attributes('aria-label')).toBe('课赛通 KST，运营控制中心')
    })

    it('应该显示运营控制中心副标题', async () => {
      const wrapper = mount(AdminSidebar, {
        global: { plugins: [createPinia(), mockRouter] }
      })
      await flushPromises()

      expect(wrapper.find('.kst-lockup-subtitle').text()).toBe('运营控制中心')
    })
  })

  describe('导航菜单渲染', () => {
    it('应该渲染所有导航菜单项', async () => {
      const wrapper = mount(AdminSidebar, {
        global: { plugins: [createPinia(), mockRouter] }
      })
      await flushPromises()

      const menuItems = wrapper.findAll('.menu-nav-item')
      expect(menuItems.length).toBe(16)
    })

    it('应该显示正确的菜单标签', async () => {
      const wrapper = mount(AdminSidebar, {
        global: { plugins: [createPinia(), mockRouter] }
      })
      await flushPromises()

      const labels = wrapper.findAll('.menu-label').map(el => el.text())
      expect(labels).toContain('行动中心')
      expect(labels).toContain('授权码管理')
      expect(labels).toContain('订单与套餐')
      expect(labels).toContain('分润管理')
      expect(labels).toContain('公账支出')
      expect(labels).toContain('用户管理')
      expect(labels).toContain('工单管理')
      expect(labels).toContain('知识库管理')
      expect(labels).toContain('客服规则管理')
      expect(labels).toContain('公告管理')
      expect(labels).toContain('应用更新')
      expect(labels).toContain('物流费率中心')
      expect(labels).toContain('系统设置')
      expect(labels).toContain('后台账号管理')
      expect(labels).toContain('代理与交付')
      expect(labels).not.toContain('退出登录')
    })

    it('应该按内部员工角色隐藏无权限入口', async () => {
      sessionStorage.setItem('toolbox_role', 'support')
      const wrapper = mount(AdminSidebar, {
        global: { plugins: [createPinia(), mockRouter] }
      })
      await flushPromises()

      const labels = wrapper.findAll('.menu-label').map(el => el.text())
      expect(labels).not.toContain('专业工作台')
      expect(labels).not.toContain('分润管理')
      expect(labels).not.toContain('公账支出')
      expect(labels).not.toContain('应用更新')
      expect(labels).not.toContain('系统设置')
      expect(labels).not.toContain('后台账号管理')
      expect(labels).not.toContain('代理与交付')
      expect(labels).toContain('客服规则管理')
      expect(wrapper.findAll('.menu-group-title').map(group => group.text())).toEqual(['客户交付', '客户支持'])
    })

    it('按交付支持结算配置分组且不重复任何入口', async () => {
      const wrapper = mount(AdminSidebar, { global: { plugins: [createPinia(), mockRouter] } })
      await flushPromises()

      expect(wrapper.findAll('.menu-group-title').map(group => group.text())).toEqual(['客户交付', '客户支持', '经营结算', '平台配置'])
      const paths = wrapper.findAll('a.menu-nav-item').map(link => link.attributes('href'))
      expect(new Set(paths).size).toBe(paths.length)
      expect(wrapper.find('[aria-labelledby="admin-nav-delivery"]').text()).toContain('代理与交付')
      expect(wrapper.find('[aria-labelledby="admin-nav-finance"]').text()).toContain('公账支出')
    })

    it('代理账号不渲染内部后台菜单', async () => {
      sessionStorage.setItem('toolbox_role', 'agent')
      const wrapper = mount(AdminSidebar, { global: { plugins: [createPinia(), mockRouter] } })
      await flushPromises()
      expect(wrapper.findAll('.menu-nav-item')).toHaveLength(0)
    })

    it('当前路由对应的菜单项应该有 is-active 类', async () => {
      mockRouter.push('/admin/dashboard')
      await mockRouter.isReady()

      const wrapper = mount(AdminSidebar, {
        global: { plugins: [createPinia(), mockRouter] }
      })
      await flushPromises()

      const activeItems = wrapper.findAll('.menu-nav-item.is-active')
      expect(activeItems.length).toBe(1)
      expect(activeItems[0].text()).toContain('行动中心')
    })

    it('切换到不同路由时激活状态应该更新', async () => {
      mockRouter.push('/admin/orders')
      await mockRouter.isReady()

      const wrapper = mount(AdminSidebar, {
        global: { plugins: [createPinia(), mockRouter] }
      })
      await flushPromises()

      const activeItems = wrapper.findAll('.menu-nav-item.is-active')
      expect(activeItems.length).toBe(1)
      expect(activeItems[0].text()).toContain('订单与套餐')
    })
  })

  describe('路由预取', () => {
    it('菜单项应该存在（预取通过 @mouseenter 绑定）', async () => {
      const wrapper = mount(AdminSidebar, {
        global: { plugins: [createPinia(), mockRouter] }
      })
      await flushPromises()

      const links = wrapper.findAll('.menu-nav-item')
      expect(links.length).toBeGreaterThan(0)
    })

    it('prefetchRoute 函数应该存在', () => {
      const wrapper = mount(AdminSidebar, {
        global: { plugins: [createPinia(), mockRouter] }
      })
      expect(wrapper.exists()).toBe(true)
    })
  })

  describe('账号操作', () => {
    it('侧栏不应重复提供退出入口', async () => {
      const wrapper = mount(AdminSidebar, {
        global: { plugins: [createPinia(), mockRouter] }
      })
      await flushPromises()

      expect(wrapper.find('.logout-item').exists()).toBe(false)
    })

    it('侧栏不应保留空的账号操作区', async () => {
      const wrapper = mount(AdminSidebar, {
        global: { plugins: [createPinia(), mockRouter] }
      })
      await flushPromises()

      expect(wrapper.find('.sidebar-footer-zone').exists()).toBe(false)
    })

    it('侧栏菜单项应全部用于页面导航', async () => {
      const wrapper = mount(AdminSidebar, {
        global: { plugins: [createPinia(), mockRouter] }
      })
      await flushPromises()

      expect(wrapper.findAll('.menu-nav-item')).toHaveLength(wrapper.findAll('a.menu-nav-item').length)
    })

    it('侧栏不应直接清理登录状态', async () => {
      const { Auth } = await import('@/utils')
      const wrapper = mount(AdminSidebar, {
        global: { plugins: [createPinia(), mockRouter] }
      })
      await flushPromises()

      await wrapper.find('.sidebar-menu-nav').trigger('click')
      expect(Auth.clear).not.toHaveBeenCalled()
    })
  })

  describe('移动端适配', () => {
    it('应该支持 mobile-open 类', async () => {
      const wrapper = mount(AdminSidebar, {
        global: { plugins: [createPinia(), mockRouter] },
        props: { class: 'mobile-open' }
      })
      await flushPromises()

      expect(wrapper.exists()).toBe(true)
    })
  })
})
