import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import TargetReviewPanel from '@/features/targets/TargetReviewPanel.vue'
import { targetProfile } from './target-fixtures'

const mocks = vi.hoisted(() => ({ list: vi.fn(), review: vi.fn() }))
vi.mock('@/utils/api/target-profiles', () => ({ listTargetProfileReviews: mocks.list, reviewTargetProfile: mocks.review }))
async function open() { const wrapper = mount(TargetReviewPanel); (wrapper.element as HTMLDetailsElement).open = true; await wrapper.trigger('toggle'); await flushPromises(); return wrapper }
describe('target review in existing administrator area', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([targetProfile('pending')]); mocks.review.mockResolvedValue(targetProfile()) })
  it('does not request anything while collapsed', () => { mount(TargetReviewPanel); expect(mocks.list).not.toHaveBeenCalled() })
  it('requires explicit evidence verification and binds current revision', async () => {
    const wrapper = await open()
    expect(wrapper.get('input[aria-label="Origin 1"]').attributes('maxlength')).toBe('300')
    expect(wrapper.get('input[aria-label="路径前缀 1"]').attributes('maxlength')).toBe('300')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    const checks = wrapper.findAll('input[type="checkbox"]'); await checks.at(-1)!.setValue(true)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(mocks.review).toHaveBeenCalledWith('school-a', { revision: 1, reviewStatus: 'approved', edition: 'v2', capabilities: ['template.create.v1'], allowedRoutes: targetProfile().profile.allowedRoutes, adapterVersion: 'bjysoft-v2-template.1', evidence: { ...targetProfile().profile.evidence, source: 'admin-verified' }, executionScopes: targetProfile().profile.executionScopes })
    expect(wrapper.text()).toContain('实际执行仍需客户端核验')
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
