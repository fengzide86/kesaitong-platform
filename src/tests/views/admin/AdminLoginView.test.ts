/**
 * AdminLoginView 组件测试
 * 测试管理员登录页面功能
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import AdminLoginView from '@/views/admin/AdminLoginView.vue'
import { mountWithPinia } from '@/tests/helpers'

// Mock vue-router
const mockPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ path: '/admin/login' })
}))

// Mock utils
const mockShowToast = vi.fn()
vi.mock('@/utils', () => ({
  Auth: { set: vi.fn(), clear: vi.fn() },
  showToast: (...args) => mockShowToast(...args)
}))

// Mock api
const mockAdminLogin = vi.fn()
vi.mock('@/utils/api', () => ({
  adminLogin: (...args) => mockAdminLogin(...args)
}))

describe('AdminLoginView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('渲染测试', () => {
    it('应该正确渲染登录页面', () => {
      const wrapper = mountWithPinia(AdminLoginView)
      expect(wrapper.find('.login-container').exists()).toBe(true)
      expect(wrapper.find('.login-card').exists()).toBe(true)
    })

    it('应该显示标题"管理端登录"', () => {
      const wrapper = mountWithPinia(AdminLoginView)
      expect(wrapper.find('h1').text()).toBe('管理端登录')
    })

    it('应该显示课赛通管理端品牌且移除临时 AMZ 标志', () => {
      const wrapper = mountWithPinia(AdminLoginView)
      const brand = wrapper.find('.context-brand [data-testid="kst-brand-lockup"]')
      expect(brand.attributes('aria-label')).toBe('课赛通 KST，团队工作台')
      expect(wrapper.find('.context-mark').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Automation Suite')
    })

    it('应该显示管理端能力说明与权限提示', () => {
      const wrapper = mountWithPinia(AdminLoginView)
      expect(wrapper.find('.context-capabilities').exists()).toBe(true)
      expect(wrapper.find('.context-security').text()).toContain('登录后按账号权限开放对应功能')
      expect(wrapper.find('.brand-product-scene').exists()).toBe(false)
    })

    it('应该显示副标题提示', () => {
      const wrapper = mountWithPinia(AdminLoginView)
      expect(wrapper.text()).toContain('面向运营、客服与代理的协作入口。')
    })

    it('应该渲染密码输入框', () => {
      const wrapper = mountWithPinia(AdminLoginView)
      const input = wrapper.find('#adminPassword')
      expect(input.exists()).toBe(true)
      expect(input.attributes('type')).toBe('password')
    })

    it('应该渲染登录按钮', () => {
      const wrapper = mountWithPinia(AdminLoginView)
      const btn = wrapper.find('.btn-login')
      expect(btn.exists()).toBe(true)
      expect(btn.text()).toContain('登录并进入工作台')
    })

    it('应该渲染返回用户登录链接', () => {
      const wrapper = mountWithPinia(AdminLoginView)
      const link = wrapper.find('.footer-links a')
      expect(link.exists()).toBe(true)
      expect(link.text()).toContain('返回用户登录')
    })

    it('应该渲染密码显示/隐藏按钮', () => {
      const wrapper = mountWithPinia(AdminLoginView)
      const toggleBtn = wrapper.find('.toggle-password')
      expect(toggleBtn.exists()).toBe(true)
    })
  })

  describe('表单验证测试', () => {
    it('空账号提交应该显示错误提示', async () => {
      const wrapper = mountWithPinia(AdminLoginView)
      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      expect(mockShowToast).toHaveBeenCalledWith('请输入管理账号', 'error')
      expect(mockAdminLogin).not.toHaveBeenCalled()
    })

    it('只有空格的密码应该被视为空', async () => {
      const wrapper = mountWithPinia(AdminLoginView)
      await wrapper.find('#adminUsername').setValue('owner')
      const input = wrapper.find('#adminPassword')
      await input.setValue('   ')
      
      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      expect(mockShowToast).toHaveBeenCalledWith('请输入密码', 'error')
    })
  })

  describe('登录流程测试', () => {
    it('登录成功应该保存 token 并跳转', async () => {
      mockAdminLogin.mockResolvedValue({
        success: true,
        message: '登录成功',
        data: { token: 'test-jwt-token', role: 'super_admin', username: 'owner', force_password_reset: false }
      })

      const wrapper = mountWithPinia(AdminLoginView)
      await wrapper.find('#adminUsername').setValue('owner')
      const input = wrapper.find('#adminPassword')
      await input.setValue('Test-only-pass-123')

      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      expect(mockAdminLogin).toHaveBeenCalledWith('owner', 'Test-only-pass-123')
      
      // 管理员令牌仅保存在当前会话
      expect(sessionStorage.getItem('toolbox_role')).toBe('super_admin')
      expect(sessionStorage.getItem('toolbox_token')).toBe('test-jwt-token')
      
      // 成功后立即导航，由全局光轨承担一次克制确认
      expect(wrapper.find('.success-message').exists()).toBe(false)
      expect(mockShowToast).not.toHaveBeenCalledWith('登录成功！', 'success')
      expect(mockPush).toHaveBeenCalledWith('/admin/dashboard')
    })

    it('登录失败应该显示错误信息', async () => {
      mockAdminLogin.mockResolvedValue({
        success: false,
        message: '密码错误'
      })

      const wrapper = mountWithPinia(AdminLoginView)
      await wrapper.find('#adminUsername').setValue('owner')
      const input = wrapper.find('#adminPassword')
      await input.setValue('wrong-password')

      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      expect(wrapper.find('.error-message').classes()).toContain('show')
      expect(wrapper.find('.error-message span').text()).toBe('密码错误')
      expect(mockShowToast).toHaveBeenCalledWith('密码错误', 'error')
    })

    it('网络错误应该显示连接失败信息', async () => {
      mockAdminLogin.mockRejectedValue(new Error('Network error'))

      const wrapper = mountWithPinia(AdminLoginView)
      await wrapper.find('#adminUsername').setValue('owner')
      const input = wrapper.find('#adminPassword')
      await input.setValue('Test-only-pass-123')

      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      expect(wrapper.find('.error-message').classes()).toContain('show')
      expect(wrapper.find('.error-message span').text()).toContain('Network error')
    })

    it('登录过程中按钮应该显示加载状态', async () => {
      let resolvePromise
      mockAdminLogin.mockReturnValue(new Promise(resolve => { resolvePromise = resolve }))

      const wrapper = mountWithPinia(AdminLoginView)
      await wrapper.find('#adminUsername').setValue('owner')
      const input = wrapper.find('#adminPassword')
      await input.setValue('Test-only-pass-123')

      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      // 按钮应该禁用并显示加载文字
      const btn = wrapper.find('.btn-login')
      expect(btn.attributes('disabled')).toBeDefined()
      expect(btn.text()).toContain('验证中...')

      // 完成登录
      resolvePromise({ success: true, message: '登录成功', data: { token: 'test', role: 'super_admin', username: 'owner' } })
      await flushPromises()
    })
  })

  describe('密码显示/隐藏测试', () => {
    it('点击切换按钮应该显示密码', async () => {
      const wrapper = mountWithPinia(AdminLoginView)
      const toggleBtn = wrapper.find('.toggle-password')
      const input = wrapper.find('#adminPassword')

      expect(input.attributes('type')).toBe('password')
      
      await toggleBtn.trigger('click')
      expect(input.attributes('type')).toBe('text')
    })

    it('再次点击应该隐藏密码', async () => {
      const wrapper = mountWithPinia(AdminLoginView)
      const toggleBtn = wrapper.find('.toggle-password')
      const input = wrapper.find('#adminPassword')

      await toggleBtn.trigger('click')
      expect(input.attributes('type')).toBe('text')
      
      await toggleBtn.trigger('click')
      expect(input.attributes('type')).toBe('password')
    })

    it('切换按钮应该有正确的 aria-label', async () => {
      const wrapper = mountWithPinia(AdminLoginView)
      const toggleBtn = wrapper.find('.toggle-password')
      expect(toggleBtn.attributes('aria-label')).toBe('显示密码')
      
      await toggleBtn.trigger('click')
      expect(toggleBtn.attributes('aria-label')).toBe('隐藏密码')
    })
  })

  describe('导航测试', () => {
    it('点击返回用户登录应该跳转', async () => {
      const wrapper = mountWithPinia(AdminLoginView)
      const link = wrapper.find('.footer-links a')
      await link.trigger('click')
      
      expect(mockPush).toHaveBeenCalledWith('/user/login')
    })
  })

  describe('无障碍测试', () => {
    it('密码输入框应该有关联的 label', () => {
      const wrapper = mountWithPinia(AdminLoginView)
      const label = wrapper.find('label[for="adminPassword"]')
      expect(label.exists()).toBe(true)
      expect(label.text()).toBe('密码')
    })

    it('错误消息应该有 role="alert"', () => {
      const wrapper = mountWithPinia(AdminLoginView)
      const errorMsg = wrapper.find('.error-message')
      expect(errorMsg.attributes('role')).toBe('alert')
    })

    it('不应渲染重复的成功消息', () => {
      const wrapper = mountWithPinia(AdminLoginView)
      const successMsg = wrapper.find('.success-message')
      expect(successMsg.exists()).toBe(false)
    })

    it('登录按钮应该在加载时设置 aria-busy', async () => {
      mockAdminLogin.mockReturnValue(new Promise(() => {})) // 永不 resolve

      const wrapper = mountWithPinia(AdminLoginView)
      await wrapper.find('#adminUsername').setValue('owner')
      const input = wrapper.find('#adminPassword')
      await input.setValue('Test-only-pass-123')

      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      const btn = wrapper.find('.btn-login')
      expect(btn.attributes('aria-busy')).toBe('true')
    })

    it('密码输入框应该有 autocomplete 属性', () => {
      const wrapper = mountWithPinia(AdminLoginView)
      const input = wrapper.find('#adminPassword')
      expect(input.attributes('autocomplete')).toBe('current-password')
    })
  })
})
