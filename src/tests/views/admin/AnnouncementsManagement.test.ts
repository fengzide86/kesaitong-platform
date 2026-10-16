import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import AnnouncementsView from '@/views/admin/AnnouncementsView.vue'
import { authService } from '@/utils/auth'

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }))
vi.mock('@/utils/api', () => ({ getAnnouncements: mocks.list, createAnnouncement: mocks.create, updateAnnouncement: mocks.update, deleteAnnouncement: mocks.remove }))
const records = [
  { id: 1, title: '物流模板使用提醒', content: '先确认配送地区', audience: 'consumer', category: 'system', severity: 'info', presentation: 'banner', status: 'published', revision: 2 },
  { id: 2, title: '维护时间安排', content: '周六维护', audience: 'business', category: 'maintenance', severity: 'important', presentation: 'modal', status: 'draft', revision: 1 },
]
let wrapper: VueWrapper | undefined
function mountView() {
  wrapper = mount(AnnouncementsView, { global: { directives: { loading: () => undefined }, stubs: {
    PageHeader: { template: '<header><slot name="actions"/></header>' },
    AppSurface: { template: '<section><slot/></section>' },
    // Use the actual DataToolbar: its named slot is part of the regression.
    'el-table': { props: ['data'], template: '<section data-testid="rows"><p v-for="row in data" :key="row.id">{{row.title}}</p><slot v-if="!data.length" name="empty"/></section>' },
    'el-table-column': true, 'el-drawer': true, AdminDetailDrawer: true,
    'el-dropdown': true, 'el-dropdown-menu': true, 'el-dropdown-item': true,
    'el-segmented': true, 'el-form': true, 'el-form-item': true, 'el-date-picker': true,
    'el-input': { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"/>' },
    'el-select': { props: ['modelValue'], emits: ['update:modelValue'], template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="">全部</option><slot/></select>' },
    'el-option': { props: ['value', 'label'], template: '<option :value="value">{{label}}</option>' },
    'el-button': { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot/></button>' },
  } } })
  return wrapper
}
beforeEach(() => { vi.clearAllMocks(); authService.setRole('super_admin'); mocks.list.mockResolvedValue(records) })
afterEach(() => { wrapper?.unmount() })

describe('公告管理按查找与投放组织', () => {
  it('实际工具栏显示数量并支持标题、正文和受众组合筛选', async () => {
    const view = mountView(); await flushPromises()
    expect(view.get('.data-toolbar-v6__summary').text()).toBe('共 2 条公告')
    await view.get('[aria-label="搜索公告"]').setValue('配送地区')
    expect(view.get('.data-toolbar-v6__summary').text()).toBe('找到 1 条 · 共 2 条')
    expect(view.get('[data-testid="rows"]').text()).toBe('物流模板使用提醒')
    await view.get('[aria-label="公告人群"]').setValue('business')
    expect(view.get('[data-testid="rows"]').text()).toContain('没有匹配的公告')
    expect(view.text()).not.toContain('还没有公告')
    await view.findAll('button').find(button => button.text() === '清除筛选')!.trigger('click')
    expect(view.get('.data-toolbar-v6__summary').text()).toBe('共 2 条公告')
    expect(view.get('[data-testid="rows"]').findAll('p')).toHaveLength(2)
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('真正空库和加载失败不是同一种提示', async () => {
    mocks.list.mockResolvedValueOnce([])
    const view = mountView(); await flushPromises()
    expect(view.text()).toContain('还没有公告')
    expect(view.text()).not.toContain('清除筛选')
    mocks.list.mockRejectedValueOnce(new Error('连接暂时中断'))
    await view.findAll('button').find(button => button.text() === '刷新')!.trigger('click'); await flushPromises()
    expect(view.text()).toContain('连接暂时中断')
    expect(view.text()).not.toContain('还没有公告')
    expect(view.text()).not.toContain('共 0 条公告')
  })
  it('无写入权限时仍可查找，但不出现新建操作', async () => {
    authService.setRole('operator')
    const view = mountView(); await flushPromises()
    expect(view.find('[aria-label="搜索公告"]').exists()).toBe(true)
    expect(view.findAll('button').some(button => button.text() === '新建公告')).toBe(false)
    expect(view.get('[aria-label="公告人群"]').text()).toContain('个人工具箱')
    expect(view.get('[aria-label="公告人群"]').text()).toContain('批量工作台')
  })
})
