/* eslint-disable vue/one-component-per-file -- These small components are isolated table test stubs. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { computed, defineComponent, h, inject, provide, type PropType, type Ref } from 'vue'
import AuthCodesView from '@/views/admin/AuthCodesView.vue'
import { mountWithPinia } from '@/tests/helpers'
import { authService } from '@/utils/auth'
import type { AdminAuthCode } from '@/features/admin/model'

const mocks = vi.hoisted(() => ({ page: vi.fn(), detail: vi.fn(), users: vi.fn(), update: vi.fn(), remove: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ currentRoute: { value: { query: {}, fullPath: '/admin/authcodes' } }, replace: vi.fn() }) }))
vi.mock('@/utils/api', () => ({
  getAuthCodesPage: (...args: unknown[]) => mocks.page(...args),
  getAuthCode: (...args: unknown[]) => mocks.detail(...args),
  getUsersPage: (...args: unknown[]) => mocks.users(...args),
  getPlansAdmin: vi.fn().mockResolvedValue([]), batchGenerateAuthCodes: vi.fn(), unbindDevice: vi.fn(),
  updateAuthCode: (...args: unknown[]) => mocks.update(...args), deleteAuthCode: (...args: unknown[]) => mocks.remove(...args),
}))
vi.mock('@/utils', () => ({ showToast: vi.fn() }))

// Render each real column slot with its API rows; generic table stubs otherwise
// hide the compact-layout regression and authorization-code attributes.
const Table = defineComponent({
  props: { data: { type: Array as PropType<AdminAuthCode[]>, default: () => [] } },
  setup(props, { slots }) {
    provide('identity-test-rows', computed(() => props.data as AdminAuthCode[]))
    return () => h('div', { 'data-testid': 'auth-table' }, slots.default?.())
  },
})
const Column = defineComponent({
  props: { label: { type: String, required: true } },
  setup(props, { slots }) {
    const rows = inject<Ref<AdminAuthCode[]>>('identity-test-rows')!
    return () => h('section', { 'data-column': props.label }, rows.value.map(row => h('div', { key: row.id }, slots.default?.({ row }))))
  },
})
const Dropdown = defineComponent({
  name: 'ElDropdown', emits: ['command'],
  template: '<div class="dropdown-stub"><slot/><slot name="dropdown"/></div>',
})
const code = {
  id: 12, code: 'PRIVATE-AUTHORIZATION-0012', status: 'active', devices: [], platform_scope: ['amazon'],
  customer_name: '星海学校张老师', user_name: '旧用户姓名', user_id: 91,
  project_id: '跨境课程项目', order_no: 'ORDER-20261016-0012', responsible: '李老师',
  max_devices: 2, seat_limit: 2, product_type: 'consumer',
}
function mountView(width = 1024) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: width <= 1024, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  return mountWithPinia(AuthCodesView, { global: { directives: { loading: {} }, stubs: {
    RouterLink: true, PageHeader: true, AsyncStateNotice: true, AdminDetailDrawer: true,
    DataToolbar: { template: '<div><slot/><slot name="summary"/></div>' },
    'el-card': { template: '<div><slot name="header"/><slot/></div>' },
    'el-table': Table, 'el-table-column': Column,
    'el-select': true, 'el-option': true, 'el-input': true, 'el-input-number': true, 'el-dialog': true, 'el-pagination': true,
    'el-tag': { template: '<span><slot/></span>' },
    'el-button': { emits: ['click'], template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot/></button>' },
    'el-dropdown': Dropdown, 'el-dropdown-menu': { template: '<div><slot/></div>' },
    'el-dropdown-item': { props: ['command', 'disabled'], template: '<button :data-command="command" :disabled="disabled"><slot/></button>' },
  } } })
}
function rows(value: Record<string, unknown>) {
  mocks.page.mockResolvedValue({ items: [value], total: 1, page: 1, page_size: 20 })
}

describe('授权列表优先显示客户身份', () => {
  beforeEach(() => {
    vi.clearAllMocks(); authService.setRole('super_admin'); rows(code)
    mocks.detail.mockResolvedValue(code); mocks.users.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10 })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it.each([1024, 1440])('%spx 首列始终显示客户与授权码，并保留项目、订单、负责人', async width => {
    const wrapper = mountView(width); await flushPromises()
    expect(wrapper.findAll('[data-column]')[0]!.attributes('data-column')).toBe('客户 / 授权码')
    const identity = wrapper.get('[data-testid="auth-code-identity-12"]')
    expect(identity.get('.auth-customer-name').text()).toBe('星海学校张老师')
    expect(identity.get('.code-link').text()).toBe(code.code)
    const context = wrapper.get('[data-testid="auth-code-context-12"]')
    expect(context.text()).toContain('项目：跨境课程项目')
    expect(context.text()).toContain('订单：ORDER-20261016-0012')
    expect(context.text()).toContain('负责人：李老师')
    expect(wrapper.get('[data-testid="auth-code-actions-12"]').findAll('button').slice(0, 2).map(button => button.text())).toEqual(['详情', '更多'])
    expect(wrapper.findAllComponents(Dropdown)).toHaveLength(1)
    expect(wrapper.find('[data-column="套餐"]').exists()).toBe(width > 1024)
    wrapper.unmount()
  })

  it.each([
    [{ customer_name: null }, '旧用户姓名'],
    [{ customer_name: null, user_name: null }, '用户 #91'],
    [{ customer_name: null, user_name: null, user_id: null }, '尚未分配'],
  ])('身份缺少资料时使用原有回退，不合并不同授权 (%j)', async (overrides, expected) => {
    rows({ ...code, ...overrides })
    const wrapper = mountView(); await flushPromises()
    expect(wrapper.get('.auth-customer-name').text()).toBe(expected)
    await wrapper.get('.code-link').trigger('click'); await flushPromises()
    expect(mocks.detail).toHaveBeenCalledWith(12, {})
    expect(mocks.users).toHaveBeenCalledWith({ auth_code_id: 12, page: 1, page_size: 10 })
    wrapper.unmount()
  })

  it.each([1024, 1440])('%spx 客服首列与属性仅显示尾号，且没有更多操作', async width => {
    authService.setRole('support')
    const wrapper = mountView(width); await flushPromises()
    const identity = wrapper.get('[data-testid="auth-code-identity-12"]')
    expect(identity.get('.code-link').text()).toBe('••••0012')
    expect(identity.get('.code-link').attributes('title')).toBe('••••0012')
    expect(wrapper.html()).not.toContain(code.code)
    expect(identity.text()).toContain('星海学校张老师')
    expect(wrapper.get('[data-testid="auth-code-actions-12"]').text()).toBe('详情')
    expect(wrapper.findComponent(Dropdown).exists()).toBe(false)
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each([
    ['expired', true, false, false],
    ['deleted', false, true, true],
    ['frozen', false, false, false],
  ])('桌面运营更多菜单保持 %s 状态的原动作与禁用条件', async (status, freezeDisabled, extendDisabled, deleteDisabled) => {
    authService.setRole('operator'); rows({ ...code, status })
    const wrapper = mountView(1440); await flushPromises()
    expect(wrapper.get('[data-command="freeze"]').attributes('disabled') !== undefined).toBe(freezeDisabled)
    expect(wrapper.get('[data-command="extend"]').attributes('disabled') !== undefined).toBe(extendDisabled)
    expect(wrapper.get('[data-command="delete"]').attributes('disabled') !== undefined).toBe(deleteDisabled)
    expect(wrapper.get('[data-command="freeze"]').text()).toBe(status === 'frozen' ? '解冻' : '冻结')
    if (status !== 'deleted') {
      wrapper.getComponent(Dropdown).vm.$emit('command', 'extend'); await flushPromises()
      expect((wrapper.vm as unknown as { showExtendModal: boolean }).showExtendModal).toBe(true)
    }
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
