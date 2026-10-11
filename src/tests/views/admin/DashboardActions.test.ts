import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import DashboardView from '@/views/admin/DashboardView.vue'

const api = vi.hoisted(() => ({ center: vi.fn(), batch: vi.fn(), toast: vi.fn() }))
vi.mock('@/utils/api', () => ({ getAdminActionCenter: api.center, getAdminBusinessBatch: api.batch }))
vi.mock('@/utils', () => ({ showToast: api.toast }))
vi.mock('@/utils/auth', () => ({ authService: { getRole: () => 'super_admin' } }))

const fixture = () => ({
  summary: { expiring_authorizations: 1, device_anomalies: 1, pending_tickets: 1 },
  expiring_authorizations: [{ id: 12, code_masked: 'SAMPLE-***', expires_at: '2026-10-12' }],
  device_anomalies: [{ auth_code_id: 34, code_masked: 'DEVICE-***', device_used: 2, device_limit: 1, seat_used: 1, seat_limit: 1 }],
  pending_tickets: [{ id: 56, title: '示例客户求助', priority: 'high' }],
  agency_delivery_tasks: [], waiting_interventions: [], stale_batches: [], expense_renewals: [],
})
async function render() {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/admin/:page', component: { template: '<div />' } },
  ] })
  await router.push('/admin/dashboard')
  const wrapper = mount(DashboardView, { global: { plugins: [router], stubs: {
    PageHeader: { template: '<header><slot name="actions" /></header>' },
    AsyncStateNotice: true, EmptyState: { props: ['title', 'description'], template: '<p>{{ title }} {{ description }}</p>' },
    ElDrawer: { template: '<div><slot /></div>' },
  } } })
  await flushPromises()
  return { wrapper, router }
}

describe('action center object-level tasks', () => {
  beforeEach(() => { vi.clearAllMocks(); api.center.mockResolvedValue(fixture()) })
  it('opens the exact authorization, device owner and ticket rather than unfiltered lists', async () => {
    const { wrapper, router } = await render()
    await wrapper.get('#expiring_authorizations .record-task').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ auth_code_id: '12', return_to: '/admin/dashboard' })
    await wrapper.get('#device_anomalies .record-task').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.auth_code_id).toBe('34')
    await wrapper.get('#pending_tickets .record-task').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/admin/feedback')
    expect(router.currentRoute.value.query).toMatchObject({ ticket_id: '56', return_to: '/admin/dashboard' })
    wrapper.unmount()
  })
  it.each([
    ['expiring_authorizations', '待续费示例授权名称较长-***'],
    ['device_anomalies', '设备异常示例授权名称较长-***'],
    ['pending_tickets', '客户反馈的工具执行与授权设备问题需要进一步核对'],
  ])('keeps %s text independently truncatable with its full safe label available', async (section, label) => {
    const data = fixture()
    data.expiring_authorizations[0]!.code_masked = section === 'expiring_authorizations' ? label : 'SAMPLE-***'
    data.device_anomalies[0]!.code_masked = section === 'device_anomalies' ? label : 'DEVICE-***'
    data.pending_tickets[0]!.title = section === 'pending_tickets' ? label : '示例客户求助'
    api.center.mockResolvedValue(data)
    const { wrapper } = await render()
    const task = wrapper.get(`#${section} .record-task`)
    const text = task.get('.record-task-text')
    expect(text.text()).toBe(label)
    expect(text.attributes('title')).toBe(label)
    expect(text.find('svg').exists()).toBe(false)
    expect(text.element.parentElement?.querySelector('svg')).not.toBeNull()
    expect(task.element.querySelector(':scope > strong')?.textContent?.trim()).not.toBe('')
    expect(task.element.querySelector(':scope > svg')).not.toBeNull()
    wrapper.unmount()
  })
  it('puts unavailable remote execution reminders in a closed explanatory disclosure', async () => {
    const { wrapper } = await render()
    expect(wrapper.find('.priority-grid').exists()).toBe(false)
    expect(wrapper.findAll('.summary-card').some(card => card.text().includes('需要人工介入'))).toBe(false)
    expect(wrapper.get('.runtime-explanation').attributes('open')).toBeUndefined()
    expect(wrapper.get('.runtime-explanation').text()).toContain('客户端')
    wrapper.unmount()
  })
  it('does not hide actionable execution alerts when the server supplies them', async () => {
    api.center.mockResolvedValue({ ...fixture(), waiting_interventions: [{ batch_id: 6, tool_name: '受支持的工具', account_label_masked: '示例账号', intervention_type: 'login' }] })
    const { wrapper } = await render()
    expect(wrapper.get('.priority-grid').text()).toContain('受支持的工具')
    expect(wrapper.find('.runtime-explanation').exists()).toBe(false)
    wrapper.unmount()
  })
})
