import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import FeedbackView from '@/views/admin/FeedbackView.vue'
import { mountWithPinia } from '@/tests/helpers'
import { authService } from '@/utils/auth'
import { usePlatformStore } from '@/stores/platform'
import { contextId, supportReturnPath, supportSourcePath } from '@/features/admin/supportContext'

const mocks = vi.hoisted(() => ({ page: vi.fn(), detail: vi.fn(), user: vi.fn(), update: vi.fn(), push: vi.fn(), replace: vi.fn(), toast: vi.fn() }))
const route = ref({ path: '/admin/feedback', fullPath: '/admin/feedback?ticket_id=91&page=3&status=pending', query: {} as Record<string, string> })
vi.mock('vue-router', () => ({ useRouter: () => ({ currentRoute: route, push: mocks.push, replace: mocks.replace }) }))
vi.mock('@/utils/api', () => ({ getFeedbacksPage: (...a: unknown[]) => mocks.page(...a), getFeedback: (...a: unknown[]) => mocks.detail(...a), getUser: (...a: unknown[]) => mocks.user(...a), updateFeedback: (...a: unknown[]) => mocks.update(...a), API_BASE: '' }))
vi.mock('@/utils', () => ({ showToast: (...a: unknown[]) => mocks.toast(...a) }))
const ticket = (id: number) => ({ id, user_id: 7, title: `详情${id}`, content: '完整问题内容', status: 'pending', admin_reply: '', screenshots: '["/uploads/example.png"]' })
function mountView() {
  return mountWithPinia(FeedbackView, { global: { stubs: {
    PageHeader: true, AsyncStateNotice: true, RouterLink: true,
    DataToolbar: { template: '<div><slot/><slot name="summary"/></div>' },
    AdminDetailDrawer: { props: ['modelValue'], template: '<aside v-if="modelValue"><slot/><slot name="footer"/></aside>' },
    'el-card': { template: '<div><slot/></div>' }, 'el-table': true, 'el-table-column': true,
    'el-select': true, 'el-option': true, 'el-pagination': true, 'el-alert': true,
    'el-form': { template: '<form><slot/></form>' }, 'el-form-item': { template: '<label><slot/></label>' },
    'el-input': true, 'el-image': true, 'el-tag': { template: '<span><slot/></span>' },
    'el-button': { template: '<button @click="$emit(\'click\')"><slot/></button>' },
  } } })
}

describe('连续处理客户、授权和工单', () => {
  beforeEach(() => {
    vi.resetAllMocks(); authService.setRole('support')
    route.value.query = { ticket_id: '91', page: '3', status: 'pending' }
    mocks.page.mockResolvedValue({ items: [], total: 80, page: 3, page_size: 20 })
    mocks.detail.mockImplementation(async (id: number) => ticket(id))
    mocks.user.mockResolvedValue({ id: 7, auth_code_id: 15 })
    mocks.update.mockResolvedValue({})
  })
  it('从首页之外的工单直达完整详情，回复后仍在详情并保留筛选页码', async () => {
    const wrapper = mountView(); await flushPromises()
    expect(mocks.detail).toHaveBeenCalledWith(91, {})
    expect(wrapper.text()).toContain('完整问题内容')
    const state = wrapper.vm as unknown as { replyContent: string; replyStatus: string; submitReply: () => Promise<void>; showDetailModal: boolean; page: number }
    state.replyContent = '已核对并处理'; state.replyStatus = 'resolved'
    mocks.detail.mockResolvedValue({ ...ticket(91), status: 'resolved', admin_reply: '已核对并处理' })
    await state.submitReply(); await flushPromises()
    expect(mocks.update).toHaveBeenCalledWith(91, { status: 'resolved', admin_reply: '已核对并处理' })
    expect(state.showDetailModal).toBe(true)
    expect(state.page).toBe(3)
    expect(wrapper.text()).toContain('已核对并处理')
    wrapper.unmount()
  })
  it('切平台即清空原详情，迟到详情不得覆盖当前上下文', async () => {
    let resolve!: (value: ReturnType<typeof ticket>) => void
    mocks.detail.mockReturnValueOnce(new Promise((yes) => { resolve = yes }))
    const wrapper = mountView(); await flushPromises()
    usePlatformStore().setAdminPlatform('aliexpress'); await flushPromises()
    resolve(ticket(91)); await flushPromises()
    expect((wrapper.vm as unknown as { currentFeedback: unknown }).currentFeedback).toBeNull()
    expect(wrapper.text()).not.toContain('完整问题内容')
    wrapper.unmount()
  })
  it('切换工单后，旧回复完成不能把新工单替换成旧内容', async () => {
    const wrapper = mountView(); await flushPromises()
    let resolve!: () => void
    mocks.update.mockReturnValueOnce(new Promise<void>(yes => { resolve = yes }))
    const state = wrapper.vm as unknown as { replyContent: string; submitReply: () => Promise<void>; openTicket: (id: number) => Promise<void>; currentFeedback: { id: number } }
    state.replyContent = '回复旧工单'
    const saving = state.submitReply()
    await state.openTicket(92); resolve(); await saving; await flushPromises()
    expect(state.currentFeedback.id).toBe(92)
    wrapper.unmount()
  })
  it('来源仅允许有权限的既有后台路径，ID拒绝混淆输入', () => {
    expect(supportReturnPath('/admin/users?page=3', 'support')).toBe('/admin/users?page=3')
    for (const path of ['https://example.com', '//example.com', '/admin/unknown', '/admin/agency']) expect(supportReturnPath(path, 'support')).toBeUndefined()
    expect(contextId('23')).toBe(23)
    expect(contextId('23x')).toBeUndefined()
    expect(contextId(['23', '45'])).toBeUndefined()
  })
  it('工单列表同路由后退恢复用户、状态和第三页', async () => {
    const wrapper = mountView(); await flushPromises()
    route.value.query = { status: 'resolved', page: '3', user_id: '7' }; await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith({ platform_key: undefined, status: 'resolved', page: 3, page_size: 20, user_id: 7 })
    wrapper.unmount()
  })
  it('连续二十次切换关联对象，来源参数不递归增长且保留原筛选页码', () => {
    let current = '/admin/users?user_id=91&page=3&keyword=%E5%AE%A2%E6%88%B7'
    for (let index = 0; index < 20; index++) {
      current = `/admin/users?user_id=91&page=3&keyword=%E5%AE%A2%E6%88%B7&return_to=${encodeURIComponent(supportSourcePath(current))}`
      expect(supportSourcePath(current)).toBe('/admin/users?user_id=91&page=3&keyword=%E5%AE%A2%E6%88%B7')
      expect(current.length).toBeLessThan(250)
    }
  })
})
