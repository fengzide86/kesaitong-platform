import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, watch } from 'vue'
import MySupportTickets from '@/components/MySupportTickets.vue'

const mocks = vi.hoisted(() => ({ getMyFeedbacks: vi.fn() }))
vi.mock('@/utils/api', () => ({ getMyFeedbacks: mocks.getMyFeedbacks }))
vi.mock('@/features/ai/presentation', () => ({ formatChatTime: (value?: string) => value || '—' }))

// Simulate the drawer lifecycle without Element Plus animation/teleport timing;
// the component's event handler and real buttons still drive every request.
const drawer = defineComponent({
  props: { modelValue: Boolean, title: String },
  emits: ['open', 'update:modelValue'],
  setup(props, { emit }) {
    watch(() => props.modelValue, value => { if (value) emit('open') }, { immediate: true })
  },
  template: '<section v-if="modelValue" role="dialog"><h2>{{title}}</h2><slot /><slot name="footer" /></section>',
})
interface Ticket {
  id: number
  title: string
  content: string
  status: string
  admin_reply?: string | null
  created_at?: string
  replied_at?: string | null
  updated_at?: string | null
}
const ticket = (id: number, overrides: Partial<Ticket> = {}): Ticket => ({
  id, title: `安装问题 ${id}`, content: `需要说明安装步骤 ${id}`, status: 'pending',
  created_at: '2026-09-21T02:00:00Z', ...overrides,
})
function deferred() {
  let resolve!: (value: Ticket[]) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<Ticket[]>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const wrappers: Array<{ unmount(): void }> = []
function render(open = true) {
  const wrapper = mount(MySupportTickets, { props: { modelValue: open }, global: { stubs: { ElDrawer: drawer } } })
  wrappers.push(wrapper)
  return wrapper
}
function button(wrapper: ReturnType<typeof render>, text: string) {
  const matched = wrapper.findAll('button').find(item => item.text() === text)
  if (!matched) throw new Error(`Missing button: ${text}`)
  return matched
}
beforeEach(() => { vi.resetAllMocks(); mocks.getMyFeedbacks.mockResolvedValue([]) })
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

describe('my support ticket drawer', () => {
  it('shows a shared ticket number and server reply time without treating a reply as resolution', async () => {
    mocks.getMyFeedbacks.mockResolvedValue([ticket(42, { status: 'processing', admin_reply: '请核对设备', replied_at: '2026-10-11T03:30:00Z' })])
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get('.support-ticket').text()).toContain('工单 #42')
    expect(wrapper.get('.support-ticket').text()).toContain('最近回复：2026-10-11T03:30:00Z')
    expect(wrapper.get('.support-ticket').text()).toContain('处理中')
    expect(wrapper.get('.support-ticket').text()).not.toContain('已解决')
  })

  it('loads only after opening and separates loading from the empty state', async () => {
    const pending = deferred()
    mocks.getMyFeedbacks.mockReturnValue(pending.promise)
    const wrapper = render(false)
    expect(mocks.getMyFeedbacks).not.toHaveBeenCalled()
    await wrapper.setProps({ modelValue: true })
    expect(mocks.getMyFeedbacks).toHaveBeenCalledWith({ page: 1, page_size: 10 })
    expect(wrapper.get('[role="status"]').text()).toBe('正在加载工单…')
    expect(button(wrapper, '刷新').attributes('disabled')).toBeDefined()
    pending.resolve([])
    await flushPromises()
    expect(wrapper.text()).toContain('暂无工单')
    expect(button(wrapper, '上一页').attributes('disabled')).toBeDefined()
    expect(button(wrapper, '下一页').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('displays staff replies and distinguishes unanswered, processing and resolved tickets', async () => {
    mocks.getMyFeedbacks.mockResolvedValue([
      ticket(1, { status: 'resolved', admin_reply: '已提供安装指引\n请按步骤重试。' }),
      ticket(2, { status: 'processing', admin_reply: null }),
      ticket(3, { status: 'pending' }),
      ticket(4, { status: 'custom-status' }),
    ])
    const wrapper = render()
    await flushPromises()
    const entries = wrapper.findAll('.support-ticket')
    expect(entries).toHaveLength(4)
    expect(entries[0]!.get('.staff-reply').text()).toContain('已提供安装指引\n请按步骤重试。')
    expect(entries[0]!.text()).toContain('已解决')
    expect(entries[1]!.text()).toContain('处理中')
    expect(entries[1]!.get('.staff-reply').text()).toContain('尚未回复，请稍后刷新查看。')
    expect(entries[2]!.text()).toContain('待处理')
    expect(entries[3]!.text()).toContain('custom-status')
    expect(entries[0]!.get('details p').text()).toBe('需要说明安装步骤 1')
    expect(entries[0]!.get('small').text()).toBe('2026-09-21T02:00:00Z')
  })

  it('retries an API error and clears the error once records arrive', async () => {
    mocks.getMyFeedbacks.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([ticket(1)])
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('工单加载失败，请重试')
    expect(wrapper.text()).not.toContain('暂无工单')
    await button(wrapper, '重试').trigger('click')
    await flushPromises()
    expect(mocks.getMyFeedbacks).toHaveBeenLastCalledWith({ page: 1, page_size: 10 })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.findAll('.support-ticket')).toHaveLength(1)
  })

  it('treats malformed API content as a recoverable error instead of rendering it', async () => {
    mocks.getMyFeedbacks.mockResolvedValue([{ id: 1, title: 'missing content and status' }])
    const wrapper = render()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('工单加载失败，请重试')
    expect(wrapper.text()).not.toContain('missing content and status')
  })

  it('supports next, previous and current-page refresh without appending wrong-page records', async () => {
    const firstPage = Array.from({ length: 10 }, (_, index) => ticket(index + 1))
    mocks.getMyFeedbacks.mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([ticket(11)])
      .mockResolvedValueOnce([ticket(11, { admin_reply: '刚刚回复' })])
      .mockResolvedValueOnce(firstPage)
    const wrapper = render()
    await flushPromises()
    expect(button(wrapper, '上一页').attributes('disabled')).toBeDefined()
    expect(button(wrapper, '下一页').attributes('disabled')).toBeUndefined()
    await button(wrapper, '下一页').trigger('click')
    await flushPromises()
    expect(mocks.getMyFeedbacks).toHaveBeenLastCalledWith({ page: 2, page_size: 10 })
    expect(wrapper.get('.ticket-paging').text()).toContain('第 2 页')
    expect(wrapper.findAll('.support-ticket')).toHaveLength(1)
    expect(button(wrapper, '下一页').attributes('disabled')).toBeDefined()
    await button(wrapper, '刷新').trigger('click')
    await flushPromises()
    expect(mocks.getMyFeedbacks).toHaveBeenLastCalledWith({ page: 2, page_size: 10 })
    expect(wrapper.get('.staff-reply').text()).toContain('刚刚回复')
    await button(wrapper, '上一页').trigger('click')
    await flushPromises()
    expect(mocks.getMyFeedbacks).toHaveBeenLastCalledWith({ page: 1, page_size: 10 })
    expect(wrapper.findAll('.support-ticket')).toHaveLength(10)
  })

  it('keeps page 1 data and page state when requesting the next page fails', async () => {
    mocks.getMyFeedbacks.mockResolvedValueOnce(Array.from({ length: 10 }, (_, index) => ticket(index + 1)))
      .mockRejectedValueOnce(new Error('next-page offline'))
    const wrapper = render()
    await flushPromises()
    await button(wrapper, '下一页').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('工单加载失败')
    expect(wrapper.get('.ticket-paging').text()).toContain('第 1 页')
    expect(wrapper.findAll('.support-ticket')).toHaveLength(10)
  })

  it.each(['success', 'failure'] as const)('ignores an old %s after a reopened drawer loads newer replies', async settlement => {
    const old = deferred()
    mocks.getMyFeedbacks.mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce([ticket(2, { admin_reply: '本次最新回复' })])
    const wrapper = render()
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    expect(wrapper.get('.staff-reply').text()).toContain('本次最新回复')
    if (settlement === 'success') old.resolve([ticket(1, { admin_reply: '不应覆盖的旧回复' })])
    else old.reject(new Error('过期的网络错误'))
    await flushPromises()
    expect(wrapper.get('.staff-reply').text()).toContain('本次最新回复')
    expect(wrapper.text()).not.toContain('不应覆盖的旧回复')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('does not clear a current loading indicator when an older request completes', async () => {
    const old = deferred(), current = deferred()
    mocks.getMyFeedbacks.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const wrapper = render()
    await wrapper.setProps({ modelValue: false })
    await wrapper.setProps({ modelValue: true })
    old.resolve([ticket(1)])
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('正在加载工单')
    expect(wrapper.findAll('.support-ticket')).toHaveLength(0)
    current.resolve([ticket(2)])
    await flushPromises()
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.get('.support-ticket').text()).toContain('安装问题 2')
  })
})
