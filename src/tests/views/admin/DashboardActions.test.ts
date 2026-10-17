import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import DashboardView from '@/views/admin/DashboardView.vue'
import { targetProfile } from '@/tests/features/target-fixtures'

const api = vi.hoisted(() => ({ center: vi.fn(), batch: vi.fn(), reviews: vi.fn(), toast: vi.fn(), role: 'super_admin' as 'super_admin' | 'operator' | 'support' }))
vi.mock('@/utils/api', () => ({ getAdminActionCenter: api.center, getAdminBusinessBatch: api.batch }))
vi.mock('@/utils/api/target-profiles', () => ({ listTargetProfileReviews: api.reviews }))
vi.mock('@/utils', () => ({ showToast: api.toast }))
vi.mock('@/utils/auth', () => ({ authService: { getRole: () => api.role } }))

const fixture = () => ({
  summary: { expiring_authorizations: 1, device_anomalies: 1, pending_tickets: 1 },
  expiring_authorizations: [{ id: 12, code_masked: 'SAMPLE-***', expires_at: '2026-10-12' }],
  device_anomalies: [{ auth_code_id: 34, code_masked: 'DEVICE-***', device_used: 2, device_limit: 1, seat_used: 1, seat_limit: 1 }],
  pending_tickets: [{ id: 56, title: '示例客户求助', priority: 'high' }],
  agency_delivery_tasks: [], waiting_interventions: [], stale_batches: [], expense_renewals: [],
})
function reviewFixture(index: number, status: Parameters<typeof targetProfile>[0] = 'pending') {
  const item = targetProfile(status)
  item.profile.id = `school-${index}`
  item.profile.name = `学校入口 ${index}`
  return item
}
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
  beforeEach(() => {
    vi.clearAllMocks()
    api.role = 'super_admin'
    api.center.mockResolvedValue(fixture())
    api.reviews.mockReset().mockResolvedValue([])
  })
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
  it.each([1, 20])('previews only one of %i pending platform reviews in the bottom operations card', async count => {
    api.reviews.mockResolvedValue(Array.from({ length: count }, (_, index) => reviewFixture(index + 1)))
    const { wrapper } = await render()
    const card = wrapper.get('#target_review')
    const cards = wrapper.get('.operations-grid').findAll('article')
    expect(cards.at(-1)?.element).toBe(card.element)
    expect(card.classes()).toContain('action-panel')
    expect(card.findAll('.review-task')).toHaveLength(1)
    expect(card.get('.review-task').text()).toContain('学校入口 1')
    if (count > 1) {
      expect(card.get('.review-more-hint').text()).toMatch(/\b19\b/)
      expect(card.text()).not.toContain('学校入口 20')
    } else {
      expect(card.find('.review-more-hint').exists()).toBe(false)
    }
    expect(api.reviews).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('filters out non-pending reviews before choosing the preview and remaining count', async () => {
    api.reviews.mockResolvedValue([
      reviewFixture(1, 'approved'), reviewFixture(2, 'rejected'), reviewFixture(3, 'disabled'),
      reviewFixture(4), reviewFixture(5),
    ])
    const { wrapper } = await render()
    const card = wrapper.get('#target_review')
    expect(card.findAll('.review-task')).toHaveLength(1)
    expect(card.get('.review-task').text()).toContain('学校入口 4')
    expect(card.get('.review-more-hint').text()).toMatch(/\b1\b/)
    for (const index of [1, 2, 3, 5]) expect(card.text()).not.toContain(`学校入口 ${index}`)
    wrapper.unmount()
  })
  it('opens the previewed profile and offers the complete unfiltered review list', async () => {
    api.reviews.mockResolvedValue([reviewFixture(12), reviewFixture(34)])
    const { wrapper, router } = await render()
    await wrapper.get('#target_review .review-task').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/admin/target-reviews')
    expect(router.currentRoute.value.query).toEqual({ profile_id: 'school-12' })
    await wrapper.get('#target_review .target-review-link').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/admin/target-reviews')
    expect(router.currentRoute.value.query).toEqual({})
    wrapper.unmount()
  })
  it('keeps a compact platform review entry visible when the review list is empty', async () => {
    const { wrapper } = await render()
    expect(api.reviews).toHaveBeenCalledTimes(1)
    expect(wrapper.get('#target_review').text()).toContain('暂时没有待审核入口')
    wrapper.unmount()
  })
  it('keeps a compact platform review entry visible when all returned entries are already reviewed or disabled', async () => {
    api.reviews.mockResolvedValue([
      reviewFixture(1, 'approved'), reviewFixture(2, 'rejected'), reviewFixture(3, 'disabled'),
    ])
    const { wrapper } = await render()
    expect(wrapper.get('#target_review').text()).toContain('暂时没有待审核入口')
    wrapper.unmount()
  })
  it.each([true, false])('keeps a failed review request visible and retries it (pending after retry: %s)', async hasPending => {
    api.reviews.mockRejectedValueOnce(new Error('平台审核读取失败')).mockResolvedValue(hasPending ? [reviewFixture(8)] : [])
    const { wrapper } = await render()
    const card = wrapper.get('#target_review')
    expect(card.get('[role="alert"]').text()).toContain('平台审核读取失败')
    expect(card.find('.review-task').exists()).toBe(false)
    expect(card.get('.target-review-link').attributes('href')).toBe('/admin/target-reviews')
    await card.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(api.reviews).toHaveBeenCalledTimes(2)
    expect(api.center).toHaveBeenCalledTimes(1)
    if (hasPending) {
      expect(wrapper.get('#target_review .review-task').text()).toContain('学校入口 8')
      expect(wrapper.find('#target_review [role="alert"]').exists()).toBe(false)
    } else expect(wrapper.get('#target_review').text()).toContain('暂时没有待审核入口')
    wrapper.unmount()
  })
  it.each(['operator', 'support'] as const)('does not show the target-review dead link to %s', async role => {
    api.role = role
    const { wrapper } = await render()
    expect(wrapper.find('#target_review').exists()).toBe(false)
    expect(api.reviews).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
