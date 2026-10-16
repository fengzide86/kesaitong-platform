import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import FeedbackView from '@/views/admin/FeedbackView.vue'
import { mountWithPinia } from '@/tests/helpers'
import { authService } from '@/utils/auth'
import { usePlatformStore } from '@/stores/platform'

const mocks = vi.hoisted(() => ({ page: vi.fn(), replace: vi.fn(), toast: vi.fn() }))
const route = ref({ query: {} as Record<string, string> })
vi.mock('vue-router', () => ({ useRouter: () => ({ currentRoute: route, replace: mocks.replace }) }))
vi.mock('@/utils/api', () => ({ getFeedbacksPage: (...args: unknown[]) => mocks.page(...args), updateFeedback: vi.fn(), API_BASE: '' }))
vi.mock('@/utils', () => ({ showToast: (...args: unknown[]) => mocks.toast(...args) }))

const result = (total = 31) => ({ items: total ? [{ id: 91, title: '物流模板咨询', content: '费用如何设置', status: 'pending' }] : [], total, page: 1, page_size: 20 })
function mountView() {
  return mountWithPinia(FeedbackView, { global: { stubs: {
    PageHeader: true, AdminDetailDrawer: true,
    DataToolbar: { template: '<section><slot/><slot name="summary"/></section>' },
    'el-card': { template: '<section><slot/></section>' },
    'el-table': { props: ['data'], template: '<div data-testid="feedback-table"><p v-for="row in data" :key="row.id">{{ row.title }}</p><slot v-if="!data.length" name="empty"/></div>' },
    'el-table-column': true, 'el-option': true, 'el-tag': true, 'el-image': true,
    'el-form': true, 'el-form-item': true,
    'el-input': { props: ['modelValue'], emits: ['update:modelValue', 'clear'], template: '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"/>' },
    'el-select': true,
    'el-button': { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot/></button>' },
    'el-pagination': { emits: ['current-change'], template: '<button data-testid="page-two" @click="$emit(\'current-change\', 2)">下一页</button>' },
  } } })
}
const findButton = (wrapper: ReturnType<typeof mountView>, label: string) => wrapper.findAll('button').find(button => button.text() === label)!

describe('工单搜索的日常操作与真实结果边界', () => {
  beforeEach(() => {
    vi.resetAllMocks(); authService.setRole('support'); route.value.query = {}
    mocks.page.mockResolvedValue(result())
  })
  afterEach(() => vi.useRealTimers())

  it.each(['物流模板', '费用如何设置', '91'])('查询按钮将关键词 %s 原样交给服务端，而不只过滤本页', async keyword => {
    const wrapper = mountView(); await flushPromises()
    const input = wrapper.get('input[aria-label="搜索标题、内容或工单号"]')
    await input.setValue(`  ${keyword}  `)
    await findButton(wrapper, '查询').trigger('click'); await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith(expect.objectContaining({ keyword, page: 1, page_size: 20 }))
    expect(mocks.replace).toHaveBeenLastCalledWith(expect.objectContaining({ query: expect.objectContaining({ keyword, page: '1' }) }))
    wrapper.unmount()
  })

  it('新关键词的防抖查询回到第一页，并保留状态和平台；翻页保留关键词', async () => {
    const wrapper = mountView(); await flushPromises()
    usePlatformStore().setAdminPlatform('amazon')
    const state = wrapper.vm as unknown as { filterStatus: string }
    state.filterStatus = 'pending'; await flushPromises()
    await wrapper.get('[data-testid="page-two"]').trigger('click'); await flushPromises()
    vi.useFakeTimers()
    await wrapper.get('input[aria-label="搜索标题、内容或工单号"]').setValue('配送')
    await vi.advanceTimersByTimeAsync(250); await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith({ keyword: '配送', status: 'pending', platform_key: 'amazon', page: 1, page_size: 20 })
    await wrapper.get('[data-testid="page-two"]').trigger('click'); await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: '配送', page: 2 }))
    wrapper.unmount()
  })

  it('无匹配明确区别空库，清除搜索后重新查询而不取消原状态筛选', async () => {
    route.value.query = { keyword: '未找到', status: 'pending' }
    mocks.page.mockResolvedValueOnce(result(0)).mockResolvedValueOnce(result(1))
    const wrapper = mountView(); await flushPromises()
    expect(wrapper.text()).toContain('没有找到符合当前条件的工单')
    expect(wrapper.text()).not.toContain('还没有工单')
    await findButton(wrapper, '清除搜索').trigger('click'); await flushPromises()
    expect(mocks.page).toHaveBeenLastCalledWith({ status: 'pending', platform_key: undefined, page: 1, page_size: 20 })
    expect(wrapper.text()).toContain('物流模板咨询')
    wrapper.unmount()
  })

  it('没有任何筛选且目录为空时准确说明尚无工单', async () => {
    mocks.page.mockResolvedValueOnce(result(0))
    const wrapper = mountView(); await flushPromises()
    expect(wrapper.text()).toContain('还没有工单，客户提交问题后会显示在这里')
    expect(wrapper.text()).not.toContain('没有找到符合当前条件')
    wrapper.unmount()
  })

  it('首次查询失败显示可重试错误，不显示无匹配或空库', async () => {
    mocks.page.mockRejectedValueOnce(new Error('搜索服务暂不可用'))
    const wrapper = mountView(); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('搜索服务暂不可用')
    expect(wrapper.find('[data-testid="feedback-table"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('还没有工单')
    expect(wrapper.text()).not.toContain('没有找到符合当前条件')
    await findButton(wrapper, '重新加载').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('物流模板咨询')
    wrapper.unmount()
  })

  it('已有结果后搜索失败保留旧结果并标明可能过期，不冒充新搜索结果为空', async () => {
    const wrapper = mountView(); await flushPromises()
    mocks.page.mockRejectedValueOnce(new Error('本次查询失败'))
    await wrapper.get('input[aria-label="搜索标题、内容或工单号"]').setValue('新条件')
    await findButton(wrapper, '查询').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('数据可能已过期')
    expect(wrapper.text()).toContain('本次查询失败')
    expect(wrapper.text()).toContain('物流模板咨询')
    expect(wrapper.text()).not.toContain('没有找到符合当前条件')
    wrapper.unmount()
  })
})
