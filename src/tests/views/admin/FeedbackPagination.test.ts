import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import FeedbackView from '@/views/admin/FeedbackView.vue'
import { mountWithPinia } from '@/tests/helpers'
import { usePlatformStore } from '@/stores/platform'
import type { AdminFeedback } from '@/features/admin/model'
vi.mock('vue-router', () => ({ useRouter: () => ({ currentRoute: { value: { query: {} } }, replace: vi.fn() }) }))

const mocks = vi.hoisted(() => ({ page: vi.fn(), toast: vi.fn() }))
vi.mock('@/utils/api', () => ({ getFeedbacksPage: (...args: unknown[]) => mocks.page(...args), updateFeedback: vi.fn(), API_BASE: '' }))
vi.mock('@/utils', () => ({ showToast: (...args: unknown[]) => mocks.toast(...args) }))
const result = (id: number, total = 26) => ({ items: [{ id, title: `工单${id}`, status: 'pending' }], total, page: 1, page_size: 20 })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function mountFeedback() {
  return mountWithPinia(FeedbackView, { global: { stubs: {
    PageHeader: true, AsyncStateNotice: true, AdminDetailDrawer: true, 'el-dialog': true,
    DataToolbar: { template: '<div><slot/><slot name="summary"/></div>' },
    'el-card': { template: '<section><slot/></section>' }, 'el-table': true, 'el-table-column': true,
    'el-select': true, 'el-option': true, 'el-button': true, 'el-tag': true, 'el-image': true, 'el-form': true, 'el-form-item': true, 'el-input': true,
    'el-pagination': { props: ['currentPage', 'total', 'pageSize'], emits: ['current-change'], template: '<button data-testid="next-page" @click="$emit(\'current-change\', 2)">下一页</button>' },
  } } })
}
interface State { feedbacks: AdminFeedback[]; total: number; page: number; filterStatus: string; loadError: string; changePage: (page: number) => void }

describe('后台工单完整分页和筛选', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.page.mockResolvedValue(result(1)) })
  it('显示服务端总数并能翻页', async () => {
    const wrapper = mountFeedback()
    await flushPromises()
    expect(wrapper.text()).toContain('共 26 个工单 · 本页 1 个')
    await wrapper.get('[data-testid="next-page"]').trigger('click')
    await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, page_size: 20 }))
    wrapper.unmount()
  })
  it('状态筛选和切平台重置页码，并由服务端筛选全部工单', async () => {
    const wrapper = mountFeedback()
    await flushPromises()
    const state = wrapper.vm as unknown as State
    state.changePage(2)
    await flushPromises()
    state.filterStatus = 'pending'
    usePlatformStore().setAdminPlatform('amazon')
    await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith({ page: 1, page_size: 20, status: 'pending', platform_key: 'amazon' })
    wrapper.unmount()
  })
  it.each(['resolve', 'reject'])('逆序的旧响应 %s 不覆盖当前结果', async (outcome) => {
    const slow = deferred<ReturnType<typeof result>>()
    mocks.page.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(result(2, 1))
    const wrapper = mountFeedback()
    usePlatformStore().setAdminPlatform('aliexpress')
    await flushPromises()
    if (outcome === 'resolve') slow.resolve(result(1))
    else slow.reject(new Error('旧请求错误'))
    await flushPromises()
    const state = wrapper.vm as unknown as State
    expect(state.feedbacks[0]?.id).toBe(2)
    expect(state.total).toBe(1)
    expect(state.loadError).toBe('')
    wrapper.unmount()
  })
  it('页面销毁后不接收旧请求', async () => {
    const slow = deferred<ReturnType<typeof result>>()
    mocks.page.mockReturnValueOnce(slow.promise)
    const wrapper = mountFeedback()
    const state = wrapper.vm as unknown as State
    wrapper.unmount()
    slow.resolve(result(1))
    await flushPromises()
    expect(state.feedbacks).toEqual([])
  })
})
