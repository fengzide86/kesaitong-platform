import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import AuthCodesView from '@/views/admin/AuthCodesView.vue'
import { mountWithPinia } from '@/tests/helpers'
import { usePlatformStore } from '@/stores/platform'
import { authService } from '@/utils/auth'
import type { AdminAuthCode } from '@/features/admin/model'

const mocks = vi.hoisted(() => ({ page: vi.fn(), plans: vi.fn(), replace: vi.fn(), toast: vi.fn() }))
const route = ref({ query: {} as Record<string, string>, fullPath: '/admin/authcodes' })
vi.mock('vue-router', () => ({ useRouter: () => ({ currentRoute: route, replace: mocks.replace }) }))
vi.mock('@/utils/api', () => ({ getAuthCodes: vi.fn().mockResolvedValue([]), getAuthCodesPage: (...a: unknown[]) => mocks.page(...a), getPlansAdmin: (...a: unknown[]) => mocks.plans(...a), getAuthCode: vi.fn(), getUsersPage: vi.fn(), batchGenerateAuthCodes: vi.fn(), updateAuthCode: vi.fn(), deleteAuthCode: vi.fn(), unbindDevice: vi.fn() }))
vi.mock('@/utils', () => ({ showToast: (...a: unknown[]) => mocks.toast(...a) }))
const result = (id: number, total = 106) => ({ items: [{ id, code: `ROW-${id}`, status: 'active', devices: [] }], total, page: 1, page_size: 20 })
function mountView() {
  return mountWithPinia(AuthCodesView, { global: { directives: { loading: {} }, stubs: {
    RouterLink: true, PageHeader: true, AsyncStateNotice: true, AdminDetailDrawer: true,
    DataToolbar: { template: '<div><slot/><slot name="summary"/></div>' },
    'el-card': { template: '<div><slot name="header"/><slot/></div>' },
    'el-table': true, 'el-table-column': true, 'el-select': true, 'el-option': true, 'el-input': true, 'el-input-number': true, 'el-dialog': true, 'el-button': true, 'el-tag': true, 'el-dropdown': true, 'el-dropdown-menu': true, 'el-dropdown-item': true,
    'el-pagination': { props: ['currentPage', 'pageSize', 'total'], template: '<button data-testid="page-six" @click="$emit(\'current-change\', 6)">第六页</button>' },
  } } })
}
interface State { page: number; total: number; authCodes: AdminAuthCode[]; loadError: string; filterStatus: string; filterProductType: string; searchText: string; changePage: (page: number) => void; applyKeyword: () => void }

describe('授权全库筛选和分页', () => {
  beforeEach(() => { vi.resetAllMocks(); authService.setRole('support'); route.value.query = {}; mocks.page.mockResolvedValue(result(1)); mocks.plans.mockResolvedValue([]) })
  it('显示后端总数106而非本页数量，并可去第六页', async () => {
    const wrapper = mountView(); await flushPromises()
    expect(wrapper.text()).toContain('共 106 个授权 · 本页 1 个')
    await wrapper.get('[data-testid="page-six"]').trigger('click'); await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith(expect.objectContaining({ page: 6, page_size: 20 }))
    wrapper.unmount()
  })
  it('产品、有效状态、关键词交给后端全库组合筛选，变更后回第一页', async () => {
    route.value.query = { page: '6' }
    const wrapper = mountView(); await flushPromises()
    const state = wrapper.vm as unknown as State
    state.filterStatus = 'expired'; state.filterProductType = 'business'; state.searchText = '第101条'; state.applyKeyword()
    await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith({ page: 1, page_size: 20, status: 'expired', product_type: 'business', keyword: '第101条' })
    expect(state.page).toBe(1)
    wrapper.unmount()
  })
  it('初始化和同路由返回恢复第六页与组合筛选', async () => {
    route.value.query = { page: '6', status: 'active', product: 'consumer', keyword: '保留关键词' }
    const wrapper = mountView(); await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith({ page: 6, page_size: 20, status: 'active', product_type: 'consumer', keyword: '保留关键词' })
    route.value.query = { page: '4', status: 'expired', product: 'business', keyword: '旧搜索' }; await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith({ page: 4, page_size: 20, status: 'expired', product_type: 'business', keyword: '旧搜索' })
    wrapper.unmount()
  })
  it.each(['resolve', 'reject'])('切平台时旧列表的迟到%s不覆盖新平台页码与结果', async outcome => {
    let resolve!: (value: ReturnType<typeof result>) => void
    let reject!: (error: Error) => void
    mocks.page.mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no })).mockResolvedValueOnce(result(2, 1))
    const wrapper = mountView(); usePlatformStore().setAdminPlatform('aliexpress'); await flushPromises()
    if (outcome === 'resolve') resolve(result(1)); else reject(new Error('旧请求失败'))
    await flushPromises()
    const state = wrapper.vm as unknown as State
    expect(state.authCodes[0]?.id).toBe(2); expect(state.total).toBe(1); expect(state.loadError).toBe('')
    expect(mocks.page).toHaveBeenLastCalledWith(expect.objectContaining({ platform_key: 'aliexpress', page: 1 }))
    wrapper.unmount()
  })
  it('删除最后一页记录后校正到仍存在的页码', async () => {
    route.value.query = { page: '6' }
    mocks.page.mockResolvedValueOnce({ ...result(0, 100), items: [] }).mockResolvedValueOnce(result(100, 100))
    const wrapper = mountView(); await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith(expect.objectContaining({ page: 5 }))
    expect((wrapper.vm as unknown as State).page).toBe(5)
    wrapper.unmount()
  })
})
