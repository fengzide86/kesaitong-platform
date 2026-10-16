import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import TargetReviewPanel from '@/features/targets/TargetReviewPanel.vue'
import TargetReviewsView from '@/views/admin/TargetReviewsView.vue'
import { targetProfile } from './target-fixtures'

const mocks = vi.hoisted(() => ({ list: vi.fn(), review: vi.fn() }))
vi.mock('@/utils/api/target-profiles', () => ({ listTargetProfileReviews: mocks.list, reviewTargetProfile: mocks.review }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: { profile_id: 'school-a' } }) }))
async function open() { const wrapper = mount(TargetReviewPanel); (wrapper.element as HTMLDetailsElement).open = true; await wrapper.trigger('toggle'); await flushPromises(); return wrapper }
describe('target review in existing administrator area', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([targetProfile('pending')]); mocks.review.mockResolvedValue(targetProfile()) })
  it('does not request anything while collapsed', () => { mount(TargetReviewPanel); expect(mocks.list).not.toHaveBeenCalled() })
  it('standalone review page removes tutorials and duplicate headings without changing the embedded entry', async () => {
    const page = mount(TargetReviewsView, { global: { stubs: { PageHeader: true } } }); await flushPromises()
    expect(page.find('.review-guide').exists()).toBe(false)
    const panel = page.getComponent(TargetReviewPanel)
    expect(panel.props()).toMatchObject({ standalone: true })
    expect(panel.element.tagName).toBe('SECTION')
    expect(panel.find('.review-toggle').exists()).toBe(false)
    expect(panel.find('.review-overview').exists()).toBe(false)
    expect(panel.get('.review-form').findAll('h3')).toHaveLength(1)
    expect(panel.get('.review-request-heading .review-status').text()).toBe('待团队审核')
    expect(panel.findAll('.review-actions-primary button')).toHaveLength(2)
    expect(panel.get('.review-secondary-actions .target-danger').text()).toBe('暂停使用')
    expect(panel.get('.verification-details').attributes('open')).toBeUndefined()
    expect(mocks.list).toHaveBeenCalledOnce()
    page.unmount()
    const embedded = mount(TargetReviewPanel)
    expect(embedded.element.tagName).toBe('DETAILS')
    expect(embedded.find('.review-toggle').exists()).toBe(true)
    expect(embedded.attributes('open')).toBeUndefined()
    expect(mocks.list).toHaveBeenCalledOnce()
    embedded.unmount()
  })
  it('keeps the toolbar count equal to the complete list and removes credentials from long URL titles', async () => {
    const items = Array.from({ length: 20 }, (_, index) => {
      const item = targetProfile(index === 19 ? 'approved' : 'pending')
      item.profile.id = `school-${index}`
      item.profile.name = `学校 ${index} · ${'很长的课程名称'.repeat(20)}`
      item.profile.entryUrl = `https://school.example/${'long-path/'.repeat(30)}?token=secret#password`
      return item
    })
    mocks.list.mockResolvedValue(items)
    const approved = { ...items[0]!, profile: { ...items[0]!.profile, reviewStatus: 'approved' as const } }
    mocks.review.mockResolvedValue(approved)
    const wrapper = mount(TargetReviewPanel, { props: { standalone: true } }); await flushPromises()
    expect(wrapper.findAll('.review-list > button')).toHaveLength(20)
    expect(wrapper.get('[data-testid="review-list-count"]').text()).toBe('19 项待审核 · 共 20 项')
    expect(wrapper.get('.review-entry-url').attributes('title')).toBe('https://school.example/' + 'long-path/'.repeat(30))
    expect(wrapper.html()).not.toContain('token=secret')
    expect(wrapper.html()).not.toContain('#password')
    await wrapper.get('.review-actions-primary .target-primary').trigger('click'); await flushPromises()
    expect(wrapper.get('[data-testid="review-list-count"]').text()).toBe('18 项待审核 · 共 20 项')
    expect(wrapper.findAll('.review-list > button')).toHaveLength(20)
    wrapper.unmount()
  })
  it('opens the submitted URL and supports a simple entry-only approval', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const wrapper = await open()
    await wrapper.get('.target-open').trigger('click')
    expect(openSpy).toHaveBeenCalledWith('https://school.example/entry', '_blank', 'noopener,noreferrer')
    await wrapper.get('.review-actions-primary .target-primary').trigger('click'); await flushPromises()
    expect(mocks.review).toHaveBeenCalledWith('school-a', { revision: 1, reviewStatus: 'approved' })
    expect(wrapper.text()).toContain('已记录“验证通过”。仅通过入口审核，没有开放工具。')
    openSpy.mockRestore()
  })
  it('requires explicit evidence verification and binds current revision', async () => {
    const wrapper = await open()
    expect(wrapper.get('input[aria-label="Origin 1"]').attributes('maxlength')).toBe('300')
    expect(wrapper.get('input[aria-label="路径前缀 1"]').attributes('maxlength')).toBe('300')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    const checks = wrapper.findAll('input[type="checkbox"]'); await checks.at(-1)!.setValue(true)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(mocks.review).toHaveBeenCalledWith('school-a', { revision: 1, reviewStatus: 'approved', edition: 'v2', capabilities: ['template.create.v1'], allowedRoutes: targetProfile().profile.allowedRoutes, adapterVersion: 'bjysoft-v2-template.1', evidence: { ...targetProfile().profile.evidence, source: 'admin-verified' }, executionScopes: targetProfile().profile.executionScopes })
    expect(wrapper.text()).toContain('已通过审核并开放配送模板工具')
  })
  it('V3 approval remains disabled even after admin checks verified', async () => {
    const wrapper = await open(); await wrapper.get('.review-fields select').setValue('v3'); await wrapper.findAll('input[type="checkbox"]').at(-1)!.setValue(true)
    await wrapper.get('form').trigger('submit'); expect(mocks.review).not.toHaveBeenCalled(); expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })
  it('changing reviewed fields clears explicit verification and requires checking again', async () => {
    const wrapper = await open(); await wrapper.findAll('input[type="checkbox"]').at(-1)!.setValue(true)
    await wrapper.get('input[aria-label="路径前缀 2"]').setValue('/ECrossAmazon/SellerShipping')
    expect((wrapper.findAll('input[type="checkbox"]').at(-1)!.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit'); expect(mocks.review).not.toHaveBeenCalled()
    await wrapper.findAll('input[type="checkbox"]').at(-1)!.setValue(true); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(mocks.review).toHaveBeenCalledWith('school-a', expect.objectContaining({ allowedRoutes: [{ origin: 'https://school.example', pathPrefix: '/entry', role: 'entry' }, { origin: 'https://school.example', pathPrefix: '/ECrossAmazon/SellerShipping', role: 'business' }] }))
  })
  it.each(['adapter', 'marker', 'business-route'])('cannot approve unsupported or incomplete compatibility evidence: %s', async missing => {
    const profile = targetProfile('pending')
    if (missing === 'adapter') profile.profile.adapterVersion = 'unverified-adapter'
    if (missing === 'marker') profile.profile.evidence.markers = ['amazon-v2']
    if (missing === 'business-route') profile.profile.allowedRoutes = profile.profile.allowedRoutes.filter(route => route.role === 'entry')
    mocks.list.mockResolvedValue([profile]); const wrapper = await open()
    await wrapper.findAll('input[type="checkbox"]').at(-1)!.setValue(true); await wrapper.get('form').trigger('submit')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined(); expect(mocks.review).not.toHaveBeenCalled()
  })
  it('revision conflict keeps request unapproved and shows real server error', async () => {
    mocks.review.mockRejectedValue(new Error('配置已更新，请刷新后重试'))
    const wrapper = await open(); await wrapper.findAll('input[type="checkbox"]').at(-1)!.setValue(true); await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('配置已更新'); expect(wrapper.text()).not.toContain('入口配置已批准')
  })
  it('explains an unavailable approval service without asking operators for technical evidence', async () => {
    mocks.review.mockRejectedValue(Object.assign(new Error('入口签名密钥不可用，未保存批准结果'), { status: 503, errorCode: 'TARGET_SIGNING_UNAVAILABLE' }))
    const wrapper = await open()
    await wrapper.get('.review-actions-primary .target-primary').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('审核服务尚未准备好，本次结论没有生效')
    expect(wrapper.get('[role="alert"]').text()).toContain('无需补填工具开放设置')
    expect(wrapper.get('.review-form header').text()).toContain('待团队审核')
    expect(wrapper.find('.verification-details').attributes('open')).toBeUndefined()
    expect(wrapper.text()).not.toContain('已记录“验证通过”')
  })
  it('explains missing review permission and does not display approval actions', async () => {
    mocks.list.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }))
    const wrapper = await open()
    expect(wrapper.get('[role="alert"]').text()).toContain('当前账号没有平台入口审核权限')
    expect(wrapper.find('.review-actions-primary').exists()).toBe(false)
  })
  it('explains why an entry outside the reviewed route keeps tool approval unavailable', async () => {
    const profile = targetProfile('pending'); profile.profile.allowedRoutes[0]!.pathPrefix = '/another-entry'
    mocks.list.mockResolvedValue([profile]); const wrapper = await open()
    await wrapper.findAll('input[type="checkbox"]').at(-1)!.setValue(true)
    expect(wrapper.get('.approval-hint').text()).toContain('入口使用范围没有包含申请网址')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit'); expect(mocks.review).not.toHaveBeenCalled()
  })
  it('does not describe already enabled tools as closed', async () => {
    mocks.list.mockResolvedValue([targetProfile()]); const wrapper = await open()
    expect(wrapper.get('.review-capability-note').text()).toContain('此入口已开放配送模板工具')
  })
  it('opens only the displayed credential-free URL', async () => {
    const profile = targetProfile('pending'); profile.profile.entryUrl = 'https://school.example/entry?token=secret#password'
    mocks.list.mockResolvedValue([profile])
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const wrapper = await open(); await wrapper.get('.target-open').trigger('click')
    expect(openSpy).toHaveBeenCalledWith('https://school.example/entry', '_blank', 'noopener,noreferrer')
    openSpy.mockRestore()
  })
  it('does not open a URL containing credentials', async () => {
    const profile = targetProfile('pending'); profile.profile.entryUrl = 'https://account:secret@school.example/entry'
    mocks.list.mockResolvedValue([profile])
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const wrapper = await open(); await wrapper.get('.target-open').trigger('click')
    expect(openSpy).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('申请网址格式不正确')
    openSpy.mockRestore()
  })
  it.each(['courseMap', 'templateList', 'templateEditor', 'scope'])('missing signed evidence cannot be approved: %s', async missing => {
    const profile = targetProfile('pending')
    if (missing === 'scope') profile.profile.executionScopes = []
    else profile.profile.evidence.pageFingerprints![missing as 'courseMap' | 'templateList' | 'templateEditor'] = null
    mocks.list.mockResolvedValue([profile]); const wrapper = await open()
    await wrapper.findAll('input[type="checkbox"]').at(-1)!.setValue(true)
    await wrapper.get('form').trigger('submit')
    expect(mocks.review).not.toHaveBeenCalled()
  })
  it('changing a reviewed course invalidates manual verification', async () => {
    const wrapper = await open(); await wrapper.findAll('input[type="checkbox"]').at(-1)!.setValue(true)
    await wrapper.get('input[aria-label="课程指纹 1"]').setValue('e'.repeat(64))
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
  })
  it.each([
    ['rejected', 1],
    ['disabled', 2],
  ] as const)('uses the saved profile when %s after an incomplete approval edit', async (reviewStatus, buttonIndex) => {
    const saved = targetProfile('approved'); mocks.list.mockResolvedValue([saved]); mocks.review.mockResolvedValue(saved)
    const wrapper = await open()
    await wrapper.get('input[placeholder="已验收的适配包版本"]').setValue('unfinished-edit')
    await wrapper.get('input[aria-label="路径前缀 2"]').setValue('/unfinished-edit')
    await wrapper.findAll('.review-actions button').at(buttonIndex)!.trigger('click'); await flushPromises()
    expect(mocks.review).toHaveBeenCalledTimes(1)
    expect(mocks.review).toHaveBeenCalledWith('school-a', { revision: saved.profile.revision, reviewStatus })
    expect(mocks.review.mock.calls[0]?.[1]).not.toHaveProperty('allowedRoutes')
  })
})
