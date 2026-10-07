/**
 * LoginView 用户登录页面测试
 * 测试授权码登录、设备绑定、弹窗交互等功能
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import LoginView from '@/views/user/LoginView.vue'
import { mountWithPinia } from '@/tests/helpers'

// Mock vue-router
const mockPush = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useRoute: () => ({ path: '/user/login' })
}))

// Mock utils
const mockShowToast = vi.fn()
vi.mock('@/utils', () => ({
  Auth: { set: vi.fn(), clear: vi.fn() },
  showToast: (...args) => mockShowToast(...args),
  getDeviceId: () => 'test-device-id-001',
  getDeviceName: () => 'Test-PC'
}))

// Mock api
const mockVerifyAuthCode = vi.fn()
const mockGetSettings = vi.fn().mockResolvedValue([])
vi.mock('@/utils/api', () => ({
  verifyAuthCode: (...args) => mockVerifyAuthCode(...args),
  getSettings: () => mockGetSettings()
}))

describe('LoginView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockGetSettings.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('渲染测试', () => {
    it('应该正确渲染登录页面', () => {
      const wrapper = mountWithPinia(LoginView)
      expect(wrapper.find('.login-page').exists()).toBe(true)
      expect(wrapper.find('.login-form-card').exists()).toBe(true)
    })

    it('应该显示应用标题', () => {
      const wrapper = mountWithPinia(LoginView)
      expect(wrapper.find('h1').attributes('aria-label')).toBe('课赛通 KST · 跨境电商赛训效率平台')
      expect(wrapper.find('[data-testid="kst-brand-lockup"]').attributes('aria-hidden')).toBe('true')
    })

    it('授权卡应该使用装饰性品牌图形', () => {
      const wrapper = mountWithPinia(LoginView)
      const mark = wrapper.find('.logo-section [data-testid="kst-brand-mark"]')
      expect(mark.exists()).toBe(true)
      expect(mark.attributes('aria-hidden')).toBe('true')
    })

    it('展示八类任务入口和当前开放边界，不将入口数量宣传为已验收工具或并发能力', () => {
      const wrapper = mountWithPinia(LoginView)
      const units = wrapper.findAll('.stat-unit').map(item => item.text())
      const values = wrapper.findAll('.stat-number').map(item => item.text())
      expect(units).toEqual(['端', '端', '类'])
      expect(values).toEqual(['C', 'B', '8'])
      expect(wrapper.text()).toContain('任务入口 · 以当前开放状态为准')
      expect(wrapper.text()).not.toMatch(/批量演示上限|非真实账号并发|8.*已验收工具/)
      expect(wrapper.text()).not.toContain('秒级响应')
      wrapper.unmount()
    })

    it('功能标签只展示当前产品能力，不宣传未落地的自动化脚本', () => {
      const wrapper = mountWithPinia(LoginView)
      const featureTags = wrapper.findAll('.feature-tag').map(tag => tag.text())
      expect(featureTags).toEqual(['物流模板', '运费比较', '个人工具箱', '批量工作台', '人工接手', '执行记录'])
      expect(wrapper.text()).not.toMatch(/广告脚本|自动上品|自动发货|FBA \/ AGL/)
    })

    it('应该显示授权码提示', () => {
      const wrapper = mountWithPinia(LoginView)
      expect(wrapper.text()).toContain('请输入授权码激活您的工具箱')
    })

    it('应该渲染授权码输入框', () => {
      const wrapper = mountWithPinia(LoginView)
      const input = wrapper.find('#authCode')
      expect(input.exists()).toBe(true)
      expect(input.attributes('type')).toBe('text')
    })

    it('应该显示设备信息区域', () => {
      const wrapper = mountWithPinia(LoginView)
      const deviceInfo = wrapper.find('.device-info')
      expect(deviceInfo.exists()).toBe(true)
      expect(deviceInfo.text()).toContain('已检测到设备')
    })

    it('应该渲染登录按钮', () => {
      const wrapper = mountWithPinia(LoginView)
      const btn = wrapper.find('.btn-login')
      expect(btn.exists()).toBe(true)
      expect(btn.text()).toContain('验证并登录')
    })

    it('应该渲染底部链接', () => {
      const wrapper = mountWithPinia(LoginView)
      const links = wrapper.findAll('.footer-link')
      expect(links.length).toBe(4) // 使用帮助、联系客服、服务条款、管理员登录
    })
  })

  describe('授权码验证测试', () => {
    it('空授权码应该显示错误', async () => {
      const wrapper = mountWithPinia(LoginView)
      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      expect(mockShowToast).toHaveBeenCalledWith('请输入授权码', 'error')
      expect(mockVerifyAuthCode).not.toHaveBeenCalled()
    })

    it('授权码长度小于4应该显示格式错误', async () => {
      const wrapper = mountWithPinia(LoginView)
      const input = wrapper.find('#authCode')
      await input.setValue('AB')
      
      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      expect(mockShowToast).toHaveBeenCalledWith('授权码格式不正确，请检查后重试', 'error')
    })

    it('包含非法字符的授权码应该显示错误', async () => {
      const wrapper = mountWithPinia(LoginView)
      const input = wrapper.find('#authCode')
      await input.setValue('TEST@CODE!')
      
      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      expect(mockShowToast).toHaveBeenCalledWith('授权码只能包含字母、数字和连字符', 'error')
    })

    it('合法授权码应该调用验证接口', async () => {
      mockVerifyAuthCode.mockResolvedValue({ success: true, data: { token: 'test' } })
      
      const wrapper = mountWithPinia(LoginView)
      const input = wrapper.find('#authCode')
      await input.setValue('TEST-CODE-1234')
      
      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      expect(mockVerifyAuthCode).toHaveBeenCalledWith(
        'TEST-CODE-1234',
        'test-device-id-001',
        'Test-PC'
      )
    })
  })

  describe('登录流程测试', () => {
    it('登录成功应该保存信息并跳转', async () => {
      const routeTrackListener = vi.fn()
      window.addEventListener('toolbox:route-track', routeTrackListener, { once: true })
      const mockUserData = { token: 'jwt-token', name: 'TestUser' }
      mockVerifyAuthCode.mockResolvedValue({
        success: true,
        data: mockUserData
      })

      const wrapper = mountWithPinia(LoginView)
      const input = wrapper.find('#authCode')
      await input.setValue('VALID-CODE-1234')

      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      expect(sessionStorage.getItem('toolbox_role')).toBe('user')
      expect(sessionStorage.getItem('toolbox_token')).toBe('jwt-token')
      expect(wrapper.find('.success-message').exists()).toBe(false)
      expect(wrapper.find('.btn-login').text()).toContain('验证通过')
      await vi.advanceTimersByTimeAsync(160)
      await flushPromises()
      expect(routeTrackListener).toHaveBeenCalledOnce()
      expect(routeTrackListener.mock.calls[0]?.[0]).toMatchObject({ detail: { duration: 780 } })
      await vi.advanceTimersByTimeAsync(270)
      await flushPromises()
      expect(mockPush).toHaveBeenCalledWith('/user/tools')
      expect(mockShowToast).not.toHaveBeenCalledWith(expect.stringContaining('正在跳转'), 'success')
    })

    it('登录失败应该显示错误信息', async () => {
      mockVerifyAuthCode.mockResolvedValue({
        success: false,
        message: '授权码无效或已过期'
      })

      const wrapper = mountWithPinia(LoginView)
      const input = wrapper.find('#authCode')
      await input.setValue('INVALID-CODE')

      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      expect(wrapper.find('.error-message').classes()).toContain('show')
      expect(wrapper.find('.error-message span').text()).toBe('授权码无效或已过期')
    })

    it('网络错误应该显示连接失败', async () => {
      mockVerifyAuthCode.mockRejectedValue(new Error('Network error'))

      const wrapper = mountWithPinia(LoginView)
      const input = wrapper.find('#authCode')
      await input.setValue('TEST-CODE-1234')

      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      expect(wrapper.find('.error-message').classes()).toContain('show')
      expect(wrapper.find('.error-message span').text()).toContain('网络暂时无法连接')
    })

    it('登录过程中按钮应该显示加载状态', async () => {
      let resolvePromise
      mockVerifyAuthCode.mockReturnValue(new Promise(resolve => { resolvePromise = resolve }))

      const wrapper = mountWithPinia(LoginView)
      const input = wrapper.find('#authCode')
      await input.setValue('TEST-CODE-1234')

      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      const btn = wrapper.find('.btn-login')
      expect(btn.attributes('disabled')).toBeDefined()
      expect(btn.text()).toContain('验证中...')

      resolvePromise({ success: true, data: { token: 'test' } })
      await flushPromises()
    })
  })

  describe('帮助弹窗测试', () => {
    it('按当前工具开放状态解释真实工具与演示，不把所有授权说成仅能体验演示', async () => {
      const wrapper = mountWithPinia(LoginView)
      await wrapper.findAll('.footer-link')[0].trigger('click')
      const helpText = wrapper.get('.help-steps').text()
      expect(helpText).toContain('当前套餐包含的工具和工作台')
      expect(helpText).toContain('当前开放状态')
      expect(helpText).toContain('真实工具只操作比赛模拟平台')
      expect(helpText).toContain('演示工具使用本地沙盒')
      expect(helpText).not.toContain('当前套餐包含的演示工具')
      wrapper.unmount()
    })

    it('设备绑定说明兼容浏览器使用，不声称只能绑定 Windows', async () => {
      const wrapper = mountWithPinia(LoginView)
      await wrapper.findAll('.footer-link')[0].trigger('click')
      const helpText = wrapper.get('.help-steps').text()
      expect(helpText).toContain('系统会自动绑定您当前使用的设备')
      expect(helpText).not.toContain('Windows')
    })

    it('点击使用帮助应该显示弹窗', async () => {
      const wrapper = mountWithPinia(LoginView)
      const helpLink = wrapper.findAll('.footer-link')[0]
      await helpLink.trigger('click')

      expect(wrapper.find('.modal-overlay').classes()).toContain('show')
      expect(wrapper.find('.modal h3').text()).toContain('如何使用')
    })

    it('点击关闭按钮应该关闭弹窗', async () => {
      const wrapper = mountWithPinia(LoginView)
      // 先打开弹窗
      const helpLink = wrapper.findAll('.footer-link')[0]
      await helpLink.trigger('click')
      expect(wrapper.find('.modal-overlay').classes()).toContain('show')

      // 点击关闭
      const closeBtn = wrapper.find('.modal-close')
      await closeBtn.trigger('click')
      expect(wrapper.find('.modal-overlay').classes()).not.toContain('show')
    })

    it('点击"我知道了"应该关闭弹窗', async () => {
      const wrapper = mountWithPinia(LoginView)
      const helpLink = wrapper.findAll('.footer-link')[0]
      await helpLink.trigger('click')

      const confirmBtn = wrapper.find('.btn-confirm')
      await confirmBtn.trigger('click')
      expect(wrapper.find('.modal-overlay').classes()).not.toContain('show')
    })

    it('点击遮罩层应该关闭弹窗', async () => {
      const wrapper = mountWithPinia(LoginView)
      const helpLink = wrapper.findAll('.footer-link')[0]
      await helpLink.trigger('click')

      const overlay = wrapper.find('.modal-overlay')
      await overlay.trigger('click')
      expect(wrapper.find('.modal-overlay').classes()).not.toContain('show')
    })

    it('按 Escape 键应该关闭弹窗', async () => {
      const wrapper = mountWithPinia(LoginView)
      const helpLink = wrapper.findAll('.footer-link')[0]
      await helpLink.trigger('click')

      expect(wrapper.find('.modal-overlay').classes()).toContain('show')
      
      // 模拟点击遮罩层关闭（组件通过 @click.self 实现）
      const overlay = wrapper.find('.modal-overlay')
      await overlay.trigger('click')
      
      expect(wrapper.find('.modal-overlay').classes()).not.toContain('show')
    })
  })

  describe('联系客服测试', () => {
    it('点击联系客服应该打开弹窗', async () => {
      const wrapper = mountWithPinia(LoginView)
      const contactLink = wrapper.findAll('.footer-link')[1]
      await contactLink.trigger('click')
      
      // 检查弹窗是否显示
      const modal = wrapper.find('.modal')
      expect(modal.exists()).toBe(true)
    })
  })

  describe('无障碍测试', () => {
    it('空闲登录按钮只向辅助技术展示验证并登录', () => {
      const wrapper = mountWithPinia(LoginView)
      expect(wrapper.get('.btn-content').attributes('aria-hidden')).toBe('false')
      expect(wrapper.get('.btn-content').text()).toBe('验证并登录')
      expect(wrapper.get('.btn-loading').attributes('aria-hidden')).toBe('true')
      wrapper.unmount()
    })

    it('验证中的登录按钮只向辅助技术展示加载文案', async () => {
      mockVerifyAuthCode.mockReturnValue(new Promise(() => {}))
      const wrapper = mountWithPinia(LoginView)
      await wrapper.get('#authCode').setValue('TEST-CODE-1234')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(wrapper.get('.btn-content').attributes('aria-hidden')).toBe('true')
      expect(wrapper.get('.btn-loading').attributes('aria-hidden')).toBe('false')
      expect(wrapper.get('.btn-loading').text()).toBe('验证中...')
      wrapper.unmount()
    })

    it('验证通过后的登录按钮不向辅助技术保留加载文案', async () => {
      mockVerifyAuthCode.mockResolvedValue({ success: true, data: { token: 'test' } })
      const wrapper = mountWithPinia(LoginView)
      await wrapper.get('#authCode').setValue('TEST-CODE-1234')
      await wrapper.get('form').trigger('submit')
      await flushPromises()

      expect(wrapper.get('.btn-content').attributes('aria-hidden')).toBe('false')
      expect(wrapper.get('.btn-content').text()).toBe('验证通过，正在进入')
      expect(wrapper.get('.btn-loading').attributes('aria-hidden')).toBe('true')
      wrapper.unmount()
    })

    it('授权码输入框应该有关联的 label', () => {
      const wrapper = mountWithPinia(LoginView)
      const label = wrapper.find('label[for="authCode"]')
      expect(label.exists()).toBe(true)
      expect(label.text()).toBe('授权码')
    })

    it('关闭按钮应该有 aria-label', () => {
      const wrapper = mountWithPinia(LoginView)
      const closeBtn = wrapper.find('.modal-close')
      expect(closeBtn.attributes('aria-label')).toBe('关闭')
    })

    it('底部导航应该有 aria-label', () => {
      const wrapper = mountWithPinia(LoginView)
      const nav = wrapper.find('nav.footer-links')
      expect(nav.attributes('aria-label')).toBe('其他操作')
    })

    it('登录按钮应该在加载时设置 aria-busy', async () => {
      mockVerifyAuthCode.mockReturnValue(new Promise(() => {}))

      const wrapper = mountWithPinia(LoginView)
      const input = wrapper.find('#authCode')
      await input.setValue('TEST-CODE-1234')

      const form = wrapper.find('form')
      await form.trigger('submit')
      await flushPromises()

      const btn = wrapper.find('.btn-login')
      expect(btn.attributes('aria-busy')).toBe('true')
    })
  })
})
