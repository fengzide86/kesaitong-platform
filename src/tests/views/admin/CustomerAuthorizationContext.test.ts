import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import UsersView from '@/views/admin/UsersView.vue'
import AuthCodesView from '@/views/admin/AuthCodesView.vue'
import { mountWithPinia } from '@/tests/helpers'
import { usePlatformStore } from '@/stores/platform'
import { authService } from '@/utils/auth'
import type { AdminAuthCode, AdminUser } from '@/features/admin/model'
import { supportSourcePath } from '@/features/admin/supportContext'

const mocks = vi.hoisted(() => ({ users: vi.fn(), user: vi.fn(), update: vi.fn(), codes: vi.fn(), code: vi.fn(), plans: vi.fn(), push: vi.fn(), replace: vi.fn(), toast: vi.fn() }))
const route = ref({ path: '/admin/users', fullPath: '/admin/users?user_id=91&page=3&keyword=客户', query: {} as Record<string, string> })
vi.mock('vue-router', () => ({ useRouter: () => ({ currentRoute: route, push: mocks.push, replace: mocks.replace }) }))
vi.mock('@/utils/api', () => ({ getUsersPage: (...a: unknown[]) => mocks.users(...a), getUser: (...a: unknown[]) => mocks.user(...a), getAuthCodesPage: (...a: unknown[]) => mocks.codes(...a), getAuthCode: (...a: unknown[]) => mocks.code(...a), getPlansAdmin: (...a: unknown[]) => mocks.plans(...a), updateUser: (...a: unknown[]) => mocks.update(...a), batchGenerateAuthCodes: vi.fn(), updateAuthCode: vi.fn(), deleteAuthCode: vi.fn(), unbindDevice: vi.fn() }))
vi.mock('@/utils', () => ({ showToast: (...a: unknown[]) => mocks.toast(...a) }))
const user = { id: 91, name: '客户九十一', auth_code_id: 12, total_seats: 1, extra_devices: 0 }
const code = { id: 12, code: 'QA-CONTEXT-12', status: 'active', devices: [], platform_scope: ['amazon'], max_devices: 2, seat_limit: 2, product_type: 'consumer' }
const stubs = {
  PageHeader: true, AsyncStateNotice: true, RouterLink: true,
  DataToolbar: { template: '<div><slot/><slot name="summary"/></div>' },
  AdminDetailDrawer: { props: ['modelValue'], template: '<aside v-if="modelValue"><slot/><slot name="footer"/></aside>' },
  'el-card': { template: '<div><slot name="header"/><slot/></div>' },
  'el-table': true, 'el-table-column': true, 'el-select': true, 'el-option': true, 'el-pagination': true,
  'el-input': true, 'el-input-number': true, 'el-icon': true, 'el-dialog': true, 'el-dropdown': true, 'el-dropdown-menu': true, 'el-dropdown-item': true,
  'el-tag': { template: '<span><slot/></span>' },
  'el-button': { template: '<button @click="$emit(\'click\')"><slot/></button>' },
}
function mountUsers() { return mountWithPinia(UsersView, { global: { stubs } }) }
function mountCodes() { return mountWithPinia(AuthCodesView, { global: { stubs, directives: { loading: {} } } }) }

describe('客户与授权独立详情和稳定关联', () => {
  beforeEach(() => {
    vi.resetAllMocks(); authService.setRole('support')
    route.value.query = { user_id: '91', page: '3', keyword: '客户' }
    mocks.users.mockResolvedValue({ items: [], total: 80, page: 3, page_size: 20 })
    mocks.user.mockResolvedValue(user)
    mocks.codes.mockResolvedValue({ items: [], total: 80, page: 1, page_size: 20 })
    mocks.code.mockResolvedValue(code)
    mocks.plans.mockResolvedValue([])
  })
  it('不在当前页的用户仍可直达并跳到真实关联授权，来源带原筛选', async () => {
    const wrapper = mountUsers(); await flushPromises()
    expect(mocks.users).toHaveBeenCalledWith({ keyword: '客户', page: 3, page_size: 20 })
    expect(mocks.user).toHaveBeenCalledWith(91, {})
    expect(wrapper.text()).toContain('客户九十一')
    await (wrapper.vm as unknown as { openAuthorization: () => void }).openAuthorization()
    expect(mocks.push).toHaveBeenCalledWith({ path: '/admin/authcodes', query: { auth_code_id: '12', return_to: supportSourcePath(route.value.fullPath) } })
    wrapper.unmount()
  })
  it('用户详情旧请求失败不会清掉新对象', async () => {
    let reject!: (e: Error) => void
    mocks.user.mockReturnValueOnce(new Promise((_, no) => { reject = no }))
    const wrapper = mountUsers(); await flushPromises()
    const state = wrapper.vm as unknown as { openUser: (id: number) => Promise<void>; detailUser: AdminUser; detailError: string }
    mocks.user.mockResolvedValue({ ...user, id: 92 })
    await state.openUser(92); reject(new Error('旧请求失败')); await flushPromises()
    expect(state.detailUser.id).toBe(92)
    expect(state.detailError).toBe('')
    wrapper.unmount()
  })
  it('切平台清空用户详情及编辑对象，不复用旧关联', async () => {
    const wrapper = mountUsers(); await flushPromises()
    usePlatformStore().setAdminPlatform('aliexpress'); await flushPromises()
    expect((wrapper.vm as unknown as { detailUser: unknown }).detailUser).toBeNull()
    expect(mocks.users).toHaveBeenLastCalledWith({ platform_key: 'aliexpress', keyword: '客户', page: 1, page_size: 20 })
    wrapper.unmount()
  })
  it('授权详情独立读取，反查只能用auth_code_id并提供关联工单', async () => {
    route.value.query = { auth_code_id: '12', status: 'active', return_to: '/admin/dashboard' }
    mocks.users.mockResolvedValue({ items: [user], total: 1, page: 1, page_size: 10 })
    const wrapper = mountCodes(); await flushPromises()
    expect(mocks.code).toHaveBeenCalledWith(12, {})
    expect(mocks.users).toHaveBeenCalledWith({ auth_code_id: 12, page: 1, page_size: 10 })
    expect(wrapper.text()).toContain('客户九十一')
    await (wrapper.vm as unknown as { openRelatedFeedback: (id: number) => void }).openRelatedFeedback(91)
    expect(mocks.push).toHaveBeenLastCalledWith({ path: '/admin/feedback', query: { user_id: '91', return_to: supportSourcePath(route.value.fullPath) } })
    wrapper.unmount()
  })
  it('授权筛选初始化和同路由返回能恢复状态、产品与搜索', async () => {
    route.value.query = { status: 'expired', product: 'consumer', keyword: '保留搜索' }
    const wrapper = mountCodes(); await flushPromises()
    const state = wrapper.vm as unknown as { filterStatus: string; filterProductType: string; searchText: string }
    expect([state.filterStatus, state.filterProductType, state.searchText]).toEqual(['expired', 'consumer', '保留搜索'])
    route.value.query = { status: 'active', product: 'business', keyword: '后退搜索' }; await flushPromises()
    expect([state.filterStatus, state.filterProductType, state.searchText]).toEqual(['active', 'business', '后退搜索'])
    route.value.query = { status: 'bad-status', product: 'bad-product' }; await flushPromises()
    expect([state.filterStatus, state.filterProductType]).toEqual(['', ''])
    wrapper.unmount()
  })
  it('用户列表同路由后退恢复关键词和原页码，不重置成第一页', async () => {
    const wrapper = mountUsers(); await flushPromises()
    route.value.query = { keyword: '后退搜索', page: '2' }; await flushPromises()
    expect(mocks.users).toHaveBeenLastCalledWith({ keyword: '后退搜索', page: 2, page_size: 20 })
    wrapper.unmount()
  })
  it('用户详情显示真实项目编号，并用可理解的授权状态', async () => {
    mocks.user.mockResolvedValue({ ...user, project_id: '2026秋季实训', plan_name: '实训完整工具包', status: 'frozen' })
    const wrapper = mountUsers(); await flushPromises()
    expect(wrapper.text()).toContain('2026秋季实训')
    expect(wrapper.text()).toContain('已冻结')
    expect(wrapper.text()).not.toContain('frozen')
    wrapper.unmount()
  })
  it('统一侧栏保存仍限定为四个可编辑字段，成功后回读', async () => {
    authService.setRole('super_admin')
    const wrapper = mountUsers(); await flushPromises()
    const state = wrapper.vm as unknown as { openUser: (id: number, editing: boolean) => Promise<void>; detailUser: AdminUser; drawerEditing: boolean; saveDrawerUser: () => Promise<void> }
    await state.openUser(91, true)
    state.detailUser.name = '修改后的用户'
    state.detailUser.phone = '13800000000'
    state.detailUser.extra_devices = 2
    mocks.user.mockResolvedValue({ ...user, name: '修改后的用户', phone: '13800000000', extra_devices: 2 })
    await state.saveDrawerUser()
    expect(mocks.update).toHaveBeenCalledWith(91, { name: '修改后的用户', phone: '13800000000', total_seats: 1, extra_devices: 2 })
    expect(state.drawerEditing).toBe(false)
    expect(state.detailUser.name).toBe('修改后的用户')
    wrapper.unmount()
  })
  it('只读客服无法通过打开编辑侧栏或保存绕过权限', async () => {
    const wrapper = mountUsers(); await flushPromises()
    const state = wrapper.vm as unknown as { openUser: (id: number, editing: boolean) => Promise<void>; drawerEditing: boolean; saveDrawerUser: () => Promise<void> }
    await state.openUser(91, true)
    expect(state.drawerEditing).toBe(false)
    await state.saveDrawerUser()
    expect(mocks.update).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('授权反查失败不是空列表成功，界面给出可重试错误', async () => {
    route.value.query = { auth_code_id: '12' }
    mocks.users.mockRejectedValue(new Error('暂时不可用'))
    const wrapper = mountCodes(); await flushPromises()
    expect(wrapper.text()).toContain('关联用户读取失败')
    expect(wrapper.text()).not.toContain('暂无当前关联用户')
    wrapper.unmount()
  })
  it('授权详情迟到响应不能写入新平台', async () => {
    route.value.query = { auth_code_id: '12' }
    let resolve!: (value: typeof code) => void
    mocks.code.mockReturnValueOnce(new Promise(yes => { resolve = yes }))
    const wrapper = mountCodes(); await flushPromises()
    usePlatformStore().setAdminPlatform('aliexpress'); await flushPromises()
    resolve(code); await flushPromises()
    expect((wrapper.vm as unknown as { detailData: AdminAuthCode | null }).detailData).toBeNull()
    expect(mocks.users).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
