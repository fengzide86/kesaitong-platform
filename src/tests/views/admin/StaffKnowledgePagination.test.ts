import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import StaffAccountsView from '@/views/admin/StaffAccountsView.vue'
import KnowledgeView from '@/views/admin/KnowledgeView.vue'
import { mountWithPinia } from '@/tests/helpers'
import { usePlatformStore } from '@/stores/platform'

const mocks = vi.hoisted(() => ({ staff: vi.fn(), knowledge: vi.fn() }))
vi.mock('@/utils/api/staff', () => ({ getStaffAccountsPage: mocks.staff }))
vi.mock('@/utils/api', () => ({
  createStaffAccount: vi.fn(), resetStaffPassword: vi.fn(), updateStaffAccount: vi.fn(),
  getKnowledgeList: mocks.knowledge, getKnowledgeCategories: vi.fn().mockResolvedValue([]), getKnowledgeStats: vi.fn().mockResolvedValue({}),
  createKnowledge: vi.fn(), updateKnowledge: vi.fn(), deleteKnowledge: vi.fn(),
}))
vi.mock('@/features/agency/api', () => ({ agencyApi: { agencies: vi.fn() } }))
vi.mock('@/utils', () => ({ showToast: vi.fn() }))
const stubs = Object.fromEntries(['PageHeader', 'AsyncStateNotice', 'AdminDetailDrawer', 'DataToolbar', 'ElCard', 'ElTable', 'ElTableColumn', 'ElSelect', 'ElOption', 'ElInput', 'ElDialog', 'ElForm', 'ElFormItem', 'ElButton', 'ElTag', 'ElRadio', 'ElRadioGroup', 'ElPagination', 'ElDropdown', 'ElDropdownMenu', 'ElDropdownItem', 'ElIcon'].map(name => [name, true]))
type StaffState = { page: number; keyword: string; total: number; accounts: { id: number }[]; loadAccounts: () => Promise<void>; searchAccounts: () => void }
type KnowledgeState = { page: number; searchKeyword: string; filterCategory: string; total: number; list: { id: number }[]; loadData: () => Promise<void>; applyFilters: () => void }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { resolve, promise } }
const staff = (id: number) => ({ id, username: `staff${id}`, display_name: `账号${id}`, role: 'support', status: 'active' })
const knowledge = (id: number) => ({ id, title: `条目${id}`, content: '内容', category: '其他', status: 'active', priority: 'medium' })
describe('server pagination, filters and stale results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.staff.mockResolvedValue({ items: [staff(1)], total: 121, page: 1, page_size: 20 })
    mocks.knowledge.mockResolvedValue({ items: [knowledge(1)], total: 41 })
  })
  it('staff reaches beyond 100 and searches the server from page 1', async () => {
    const wrapper = mountWithPinia(StaffAccountsView, { global: { stubs, directives: { loading: {} } } }); await flushPromises()
    const state = wrapper.vm as unknown as StaffState
    state.page = 6; await state.loadAccounts()
    expect(mocks.staff).toHaveBeenLastCalledWith({ page: 6, page_size: 20, q: undefined })
    mocks.staff.mockResolvedValue({ items: [staff(121)], total: 1, page: 1, page_size: 20 })
    state.keyword = 'staff121'; state.searchAccounts(); await flushPromises()
    expect(mocks.staff).toHaveBeenLastCalledWith({ page: 1, page_size: 20, q: 'staff121' })
    expect(state.accounts[0]?.id).toBe(121)
    wrapper.unmount()
  })
  it('staff late page cannot overwrite the selected search and shrinking pages return to valid page', async () => {
    const wrapper = mountWithPinia(StaffAccountsView, { global: { stubs, directives: { loading: {} } } }); await flushPromises()
    const state = wrapper.vm as unknown as StaffState
    const old = deferred<unknown>(); mocks.staff.mockReturnValueOnce(old.promise)
    const pending = state.loadAccounts()
    mocks.staff.mockResolvedValue({ items: [staff(99)], total: 1, page: 1, page_size: 20 })
    state.page = 6; await state.loadAccounts()
    old.resolve({ items: [staff(1)], total: 121, page: 1, page_size: 20 }); await pending
    expect(state.page).toBe(1); expect(state.accounts[0]?.id).toBe(99)
    wrapper.unmount()
  })
  it('knowledge filter/search changes reset page and shrinking totals recover', async () => {
    const wrapper = mountWithPinia(KnowledgeView, { global: { stubs } }); await flushPromises()
    const state = wrapper.vm as unknown as KnowledgeState
    state.page = 3; state.filterCategory = '其他'; state.searchKeyword = '条目'
    state.applyFilters(); await flushPromises()
    expect(mocks.knowledge).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, category: '其他', keyword: '条目' }))
    state.page = 3; mocks.knowledge.mockResolvedValue({ items: [knowledge(8)], total: 1 })
    await state.loadData()
    expect(state.page).toBe(1); expect(state.list[0]?.id).toBe(8)
    wrapper.unmount()
  })
  it('knowledge ignores previous-platform responses', async () => {
    const wrapper = mountWithPinia(KnowledgeView, { global: { stubs } }); await flushPromises()
    const state = wrapper.vm as unknown as KnowledgeState
    const old = deferred<unknown>(); mocks.knowledge.mockReturnValueOnce(old.promise)
    const pending = state.loadData()
    mocks.knowledge.mockResolvedValue({ items: [knowledge(8)], total: 1 })
    usePlatformStore().adminPlatform = 'aliexpress'; await flushPromises()
    old.resolve({ items: [knowledge(1)], total: 41 }); await pending
    expect(state.list[0]?.id).toBe(8)
    wrapper.unmount()
  })
})
