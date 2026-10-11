import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import AuthCodesView from '@/views/admin/AuthCodesView.vue'
import { mountWithPinia } from '@/tests/helpers'
import { authService } from '@/utils/auth'

const mocks = vi.hoisted(() => ({
  getAuthCodes: vi.fn(),
  getPlansAdmin: vi.fn(),
  apiGet: vi.fn(),
  updateAuthCode: vi.fn(),
  deleteAuthCode: vi.fn(),
  unbindDevice: vi.fn(),
  confirmAction: vi.fn(),
  prompt: vi.fn(),
  showToast: vi.fn(),
  routerReplace: vi.fn(),
}))

vi.mock('@/utils/api', () => ({
  getAuthCodesPage: (...args: unknown[]) => mocks.getAuthCodes(...args),
  getAuthCode: (...args: unknown[]) => mocks.apiGet(...args),
  getUsersPage: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 }),
  getPlansAdmin: (...args: unknown[]) => mocks.getPlansAdmin(...args),
  batchGenerateAuthCodes: vi.fn(),
  updateAuthCode: (...args: unknown[]) => mocks.updateAuthCode(...args),
  deleteAuthCode: (...args: unknown[]) => mocks.deleteAuthCode(...args),
  unbindDevice: (...args: unknown[]) => mocks.unbindDevice(...args),
  api: { get: (...args: unknown[]) => mocks.apiGet(...args) },
}))

vi.mock('@/utils', () => ({
  showToast: (...args: unknown[]) => mocks.showToast(...args),
}))

vi.mock('@/shared/ui/confirm', () => ({
  confirmAction: (...args: unknown[]) => mocks.confirmAction(...args),
}))

vi.mock('element-plus', () => ({
  ElMessageBox: { prompt: (...args: unknown[]) => mocks.prompt(...args) },
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    currentRoute: { value: { query: {} } },
    replace: mocks.routerReplace,
  }),
}))

const code = {
  id: 5,
  code: 'SUPPORT-DEVICE-001',
  plan_id: 1,
  plan_name: '演示套餐',
  max_devices: 2,
  status: 'active',
  devices: [{ id: 17, device_id: 'device-17', device_name: '客服测试设备', created_at: '2026-07-18T00:00:00Z' }],
  platform_scope: ['amazon'],
  seat_limit: 1,
  seat_used: 1,
  device_used: 1,
  product_type: 'consumer',
  entitlements: {},
}

function mountAuthCodesView() {
  return mountWithPinia(AuthCodesView, {
    global: {
      stubs: {
        RouterLink: true,
        PageHeader: { template: '<header><slot name="actions"/><slot/></header>' },
        DataToolbar: { template: '<div><slot/><slot name="summary"/><slot name="actions"/></div>' },
        AdminDetailDrawer: { template: '<section><slot/><slot name="footer"/></section>' },
        'el-card': { template: '<section><slot name="header"/><slot/></section>' },
        'el-table': true,
        'el-table-column': true,
        'el-pagination': true,
        'el-dialog': true,
        'el-select': true,
        'el-option': true,
        'el-input': true,
        'el-input-number': true,
        'el-dropdown': true,
        'el-dropdown-menu': true,
        'el-dropdown-item': true,
        'el-tag': { template: '<span><slot/></span>' },
        'el-button': {
          emits: ['click'],
          template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot/></button>',
        },
      },
      directives: { loading: {} },
    },
  })
}

describe('授权码详情设备解绑 UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authService.setRole('support')
    mocks.getAuthCodes.mockResolvedValue({ items: [code], total: 1, page: 1, page_size: 20 })
    mocks.getPlansAdmin.mockResolvedValue([])
    mocks.apiGet.mockResolvedValue(code)
    mocks.updateAuthCode.mockResolvedValue({ ...code, status: 'frozen' })
    mocks.deleteAuthCode.mockResolvedValue({ success: true })
    mocks.unbindDevice.mockResolvedValue({ success: true })
    mocks.confirmAction.mockResolvedValue(true)
    mocks.prompt.mockResolvedValue({ value: '客户换机' })
  })

  it('客服可在详情中填写原因并解绑，随后刷新列表和详情', async () => {
    const wrapper = mountWithPinia(AuthCodesView, {
      global: {
        stubs: {
          RouterLink: true,
          PageHeader: { template: '<header><slot name="actions"/><slot/></header>' },
          DataToolbar: { template: '<div><slot/><slot name="summary"/><slot name="actions"/></div>' },
          AdminDetailDrawer: { template: '<section><slot/><slot name="footer"/></section>' },
          'el-card': { template: '<section><slot name="header"/><slot/></section>' },
          'el-table': true,
          'el-table-column': true,
          'el-pagination': true,
          'el-dialog': true,
          'el-select': true,
          'el-option': true,
          'el-input': true,
          'el-input-number': true,
          'el-dropdown': true,
          'el-dropdown-menu': true,
          'el-dropdown-item': true,
          'el-tag': { template: '<span><slot/></span>' },
          'el-button': {
            emits: ['click'],
            template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot/></button>',
          },
        },
        directives: {
          loading: {},
        },
      },
    })
    await flushPromises()

    await (wrapper.vm as unknown as { openDetail: (value: unknown) => Promise<void> }).openDetail(code)
    await flushPromises()
    const button = wrapper.find('[data-testid="unbind-device-17"]')
    expect(button.exists()).toBe(true)

    await button.trigger('click')
    await flushPromises()

    expect(mocks.prompt).toHaveBeenCalled()
    expect(mocks.unbindDevice).toHaveBeenCalledWith(17, '客户换机')
    expect(mocks.getAuthCodes).toHaveBeenCalledTimes(2)
    expect(mocks.apiGet).toHaveBeenCalledTimes(2)
    expect(mocks.showToast).toHaveBeenCalledWith('设备已解绑', 'success')
  })

  it('运营可以冻结和删除授权码', async () => {
    authService.setRole('operator')
    const wrapper = mountAuthCodesView()
    await flushPromises()
    const view = wrapper.vm as unknown as {
      toggleFreeze: (value: unknown) => Promise<void>
      deleteCode: (id: string | number) => Promise<void>
    }

    await view.toggleFreeze(code)
    expect(mocks.updateAuthCode).toHaveBeenCalledWith(code.id, { status: 'frozen' })

    await view.deleteCode(code.id)
    expect(mocks.confirmAction).toHaveBeenCalled()
    expect(mocks.deleteAuthCode).toHaveBeenCalledWith(code.id)
  })

  it('C 端授权码生成后可以直接交接到普通工具箱登录', async () => {
    authService.setRole('operator')
    const wrapper = mountAuthCodesView()
    await flushPromises()
    const view = wrapper.vm as unknown as {
      generatedCodes: string[]
      loginWithGeneratedCode: () => Promise<void>
    }
    view.generatedCodes = ['CONSUMER-LOGIN-001']
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('用此码登录普通工具箱')
    await view.loginWithGeneratedCode()

    expect(sessionStorage.getItem('toolbox_login_handoff_code')).toBe('CONSUMER-LOGIN-001')
    expect(mocks.routerReplace).toHaveBeenCalledWith('/user/login')
  })
})
