import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'
import { createSeed, type State } from './model'
import { advertisingCandidates, advertisingDateTime, advertisingFingerprint, applyAdvertisingCommand,
  createAdvertisingData, createAdvertisingDraft, validAdvertisingData,
  type AdvertisingCommand, type AdvertisingData, type AdvertisingDraft, type AdvertisingProductRef } from './advertising-workflow'
import AdvertisingWorkflow from './AdvertisingWorkflow.vue'

function fixture() {
  const state = createSeed(), data = createAdvertisingData()
  const candidate = advertisingCandidates(state).find(item => item.delivery === 'FBA')!
  const products: AdvertisingProductRef[] = [{ productId: candidate.productId, variantId: candidate.variantId, sku: candidate.sku, asin: candidate.asin }]
  const draft: AdvertisingDraft = { ...createAdvertisingDraft(), name: '样例推广活动', groupName: '样例广告组', products }
  return { state, data, draft }
}
function create(state: State, data: AdvertisingData, draft: AdvertisingDraft) {
  const reply = applyAdvertisingCommand(state, data, { type: 'save', draft, publish: true })
  expect(reply.ok, reply.message).toBe(true)
  return data.campaigns.find(item => item.id === reply.id)!
}
afterEach(() => { vi.restoreAllMocks() })

describe('advertising fixture commands and persistence', () => {
  it('creates an automatic campaign with separate group and exact child identifiers', () => {
    const { state, data, draft } = fixture()
    const campaign = create(state, data, draft)
    expect(campaign.status).toBe('scheduled')
    expect(campaign.groupName).not.toBe(campaign.name)
    expect(campaign.products).toEqual(draft.products)
    expect(campaign.products[0]!.asin).not.toBe(state.products[0]!.asin)
    expect(campaign.id).not.toBe(campaign.groupId)
    expect(validAdvertisingData(JSON.parse(JSON.stringify(data)), state)).toBe(true)
  })

  it('does not treat stock quantity or FBA status as the advertising eligibility rule', () => {
    const { state, data, draft } = fixture()
    const variant = state.products[0]!.variants[0]!
    variant.quantity = 0
    const fbm = advertisingCandidates(state).find(item => item.variantId === variant.id)!
    expect(fbm.delivery).toBe('FBM')
    draft.products = [{ productId: fbm.productId, variantId: fbm.variantId, sku: fbm.sku, asin: fbm.asin }]
    expect(create(state, data, draft).products).toEqual(draft.products)
  })

  it('excludes unpublished, inactive and deleted variants from current candidates', () => {
    const state = createSeed()
    state.products[0]!.variants[0]!.deleted = true
    state.products[0]!.variants[1]!.status = 'inactive'
    state.products[1]!.status = 'draft'
    const candidates = advertisingCandidates(state)
    expect(candidates.some(item => item.variantId === state.products[0]!.variants[0]!.id)).toBe(false)
    expect(candidates.some(item => item.variantId === state.products[0]!.variants[1]!.id)).toBe(false)
    expect(candidates.some(item => item.productId === state.products[1]!.id)).toBe(false)
  })

  it.each([
    ['name', ''], ['groupName', ''], ['budgetUsd', 0], ['budgetUsd', Number.NaN],
    ['defaultBidUsd', -1], ['defaultBidUsd', Number.POSITIVE_INFINITY],
    ['startAt', '2026-02-30T12:00'], ['endAt', '2000-01-01T00:00'],
    ['timeZone', 'UTC'], ['targeting', 'anything'], ['strategy', 'anything'],
    ['topOfSearchPercent', 901], ['productPagesPercent', 0.5], ['products', []],
  ])('rejects invalid %s=%s atomically', (field, value) => {
    const { state, data, draft } = fixture()
    const before = JSON.stringify({ state, data })
    const invalid = { ...draft, [field]: value } as AdvertisingDraft
    expect(applyAdvertisingCommand(state, data, { type: 'save', draft: invalid, publish: true }).ok).toBe(false)
    expect(JSON.stringify({ state, data })).toBe(before)
  })

  it('requires future starts for new publish but validates refresh without wall-clock expiry', () => {
    const { state, data, draft } = fixture()
    draft.startAt = '2000-01-01T10:00'
    expect(applyAdvertisingCommand(state, data, { type: 'save', draft, publish: true }).message).toContain('晚于当前时间')
    const staged = applyAdvertisingCommand(state, data, { type: 'save', draft, publish: false })
    expect(staged.ok).toBe(true)
    expect(validAdvertisingData(data, state)).toBe(true)
    expect(data.campaigns[0]!.status).toBe('draft')
  })

  it('rejects repeating names and does not duplicate a campaign on repeated submit', () => {
    const { state, data, draft } = fixture()
    create(state, data, draft)
    const before = JSON.stringify(data)
    expect(applyAdvertisingCommand(state, data, { type: 'save', draft: { ...draft, name: ` ${draft.name} ` }, publish: true }).message).toContain('已存在')
    expect(JSON.stringify(data)).toBe(before)
  })

  it('rejects duplicate child selection and forged parent ASIN substitution', () => {
    const { state, data, draft } = fixture()
    draft.products.push({ ...draft.products[0]! })
    expect(applyAdvertisingCommand(state, data, { type: 'save', draft, publish: true }).message).toContain('重复')
    draft.products = [{ ...draft.products[0]!, asin: state.products[0]!.asin }]
    expect(applyAdvertisingCommand(state, data, { type: 'save', draft, publish: true }).ok).toBe(false)
    expect(data.campaigns).toEqual([])
  })

  it('rejects a changed SKU or foreign variant instead of selecting by title', () => {
    const { state, data, draft } = fixture()
    state.products[0]!.variants[1]!.sku = 'CHANGED-SKU'
    expect(applyAdvertisingCommand(state, data, { type: 'save', draft, publish: true }).message).toContain('修改')
    expect(data.campaigns).toEqual([])
  })

  it('saves edits in place and reads both selected products and the new default bid', () => {
    const { state, data, draft } = fixture()
    const first = create(state, data, draft)
    const extra = advertisingCandidates(state).find(item => item.delivery === 'FBA' && item.variantId !== draft.products[0]!.variantId)!
    const edited = { ...draft, defaultBidUsd: 0.54, products: [...draft.products, { productId: extra.productId, variantId: extra.variantId, sku: extra.sku, asin: extra.asin }] }
    expect(applyAdvertisingCommand(state, data, { type: 'save', campaignId: first.id, draft: edited, publish: true }).ok).toBe(true)
    const persisted = JSON.parse(JSON.stringify(data)) as AdvertisingData
    expect(persisted.campaigns).toHaveLength(1)
    expect(persisted.campaigns[0]!.products).toHaveLength(2)
    expect(persisted.campaigns[0]!.defaultBidUsd).toBe(0.54)
    expect(persisted.campaigns[0]!.groupId).toBe(first.groupId)
  })

  it('publishes an existing valid draft without allocating a second ID', () => {
    const { state, data, draft } = fixture()
    const staged = applyAdvertisingCommand(state, data, { type: 'save', draft, publish: false })
    const savedId = staged.id
    expect(data.campaigns[0]!.status).toBe('draft')
    expect(applyAdvertisingCommand(state, data, { type: 'save', campaignId: savedId, draft, publish: true }).id).toBe(savedId)
    expect(data.campaigns).toHaveLength(1)
    expect(data.campaigns[0]!.status).toBe('scheduled')
  })

  it('pauses and resumes locally, refusing same-state duplicates and draft toggles', () => {
    const { state, data, draft } = fixture()
    const campaign = create(state, data, draft)
    expect(applyAdvertisingCommand(state, data, { type: 'status', campaignId: campaign.id, status: 'paused' }).ok).toBe(true)
    expect(data.campaigns[0]!.status).toBe('paused')
    const before = JSON.stringify(data)
    expect(applyAdvertisingCommand(state, data, { type: 'status', campaignId: campaign.id, status: 'paused' }).ok).toBe(false)
    expect(JSON.stringify(data)).toBe(before)
    expect(applyAdvertisingCommand(state, data, { type: 'status', campaignId: campaign.id, status: 'scheduled' }).ok).toBe(true)
    const draftId = applyAdvertisingCommand(state, data, { type: 'save', draft: { ...draft, name: '草稿' }, publish: false }).id!
    expect(applyAdvertisingCommand(state, data, { type: 'status', campaignId: draftId, status: 'paused' }).ok).toBe(false)
  })

  it('keeps historical campaign snapshots after product deletion but refuses unsafe resume', () => {
    const { state, data, draft } = fixture()
    const campaign = create(state, data, draft)
    applyAdvertisingCommand(state, data, { type: 'status', campaignId: campaign.id, status: 'paused' })
    state.products = []
    expect(validAdvertisingData(data, state)).toBe(true)
    expect(applyAdvertisingCommand(state, data, { type: 'status', campaignId: campaign.id, status: 'scheduled' }).ok).toBe(false)
    expect(data.campaigns[0]!.status).toBe('paused')
  })

  it('requires manual sample keywords and rejects duplicates without pretending live validation', () => {
    const { state, data, draft } = fixture()
    draft.targeting = 'manual'
    expect(applyAdvertisingCommand(state, data, { type: 'save', draft, publish: true }).message).toContain('关键词')
    draft.keywords = ['bag', ' BAG ']
    expect(applyAdvertisingCommand(state, data, { type: 'save', draft, publish: true }).ok).toBe(false)
    draft.keywords = ['bag', 'storage']
    expect(create(state, data, draft).keywords).toEqual(['bag', 'storage'])
  })

  it('protects saved data against duplicate IDs, invalid shapes and injected status', () => {
    const { state, data, draft } = fixture()
    create(state, data, draft)
    for (const field of ['id', 'groupId', 'name'] as const) {
      const duplicate = { ...data.campaigns[0]!, id: 'second', groupId: 'second-group', name: 'second-name' }
      duplicate[field] = data.campaigns[0]![field]
      expect(validAdvertisingData({ version: 1, campaigns: [...data.campaigns, duplicate] }, state)).toBe(false)
    }
    expect(validAdvertisingData({ version: 2, campaigns: [] }, state)).toBe(false)
    expect(validAdvertisingData({ version: 1, campaigns: [null] }, state)).toBe(false)
    const before = JSON.stringify(data)
    expect(applyAdvertisingCommand(state, data, { type: 'status', campaignId: data.campaigns[0]!.id, status: 'deleted' } as unknown as AdvertisingCommand).ok).toBe(false)
    expect(JSON.stringify(data)).toBe(before)
  })

  it('does not alias caller drafts into persisted campaign data', () => {
    const { state, data, draft } = fixture()
    create(state, data, draft)
    draft.products[0]!.sku = 'changed-after-save'
    draft.name = 'changed-after-save'
    expect(data.campaigns[0]!.name).not.toBe(draft.name)
    expect(data.campaigns[0]!.products[0]!.sku).not.toBe(draft.products[0]!.sku)
  })

  it('fingerprints current candidates and saved results for host transaction conflict checks', () => {
    const { state, data, draft } = fixture()
    const first = advertisingFingerprint(state, data)
    state.products[0]!.variants[1]!.delivery = 'FBM'
    expect(advertisingFingerprint(state, data)).not.toBe(first)
    const second = advertisingFingerprint(state, data)
    create(state, data, draft)
    expect(advertisingFingerprint(state, data)).not.toBe(second)
  })

  it('parses dates strictly with explicit UTC+08 and rejects calendar rollover', () => {
    expect(advertisingDateTime('2030-01-01T10:00')).toBe(Date.parse('2030-01-01T02:00:00Z'))
    expect(Number.isNaN(advertisingDateTime('2030-02-30T10:00'))).toBe(true)
    expect(Number.isNaN(advertisingDateTime('2030-01-01T25:00'))).toBe(true)
    expect(Number.isNaN(advertisingDateTime('2030-01-01'))).toBe(true)
  })
})

describe('advertising form uses the same commands as automatic demonstration', () => {
  function mountFixture() {
    const source = fixture()
    const state = reactive(source.state), data = reactive(source.data)
    const submit = vi.fn(async (command: AdvertisingCommand, baseline: string) => {
      if (baseline !== advertisingFingerprint(state, data)) return { ok: false, message: '样例已变化，请重新打开表单。' }
      return applyAdvertisingCommand(state, data, command)
    })
    const wrapper = mount(AdvertisingWorkflow, { props: { state, data, submit } })
    return { wrapper, state, data, draft: source.draft, submit }
  }
  async function fillForm(wrapper: ReturnType<typeof mountFixture>['wrapper']) {
    await wrapper.get('[data-action="ad-create"]').trigger('click')
    await wrapper.get('[data-action="ad-continue"]').trigger('click')
    await wrapper.get('[name="adGroupName"]').setValue('表单广告组')
    await wrapper.get('[name="adCampaignName"]').setValue('表单活动')
    await wrapper.get('[data-action="ad-add-product"]').trigger('click')
    await wrapper.get('[name="adBudget"]').setValue('10')
    await wrapper.get('[name="adDefaultBid"]').setValue('0.54')
  }

  it('labels FBA candidate quantity as listing quantity rather than arrived stock', async () => {
    const { wrapper, state } = mountFixture()
    await wrapper.get('[data-action="ad-create"]').trigger('click')
    await wrapper.get('[data-action="ad-continue"]').trigger('click')
    const candidate = advertisingCandidates(state).find(item => item.delivery === 'FBA')!
    const row = wrapper.get(`[data-ad-product="${candidate.variantId}"]`).element.closest('li')!
    expect(row.textContent).toContain(`刊登数量 ${candidate.quantity}`)
    expect(row.textContent).toContain('非 FBA 到仓可售数量')
    expect(row.textContent).not.toContain('可售数量 ')
    expect(row.textContent).toContain('子 ASIN（样例）')
    wrapper.unmount()
  })

  it('opens, fills, submits and reads the actual saved group product and bid', async () => {
    const { wrapper, data, submit } = mountFixture()
    await fillForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(submit).toHaveBeenCalledOnce()
    expect(data.campaigns).toHaveLength(1)
    expect(wrapper.get('[data-testid="advertising-result"]').text()).toContain('已保存')
    expect(wrapper.get('[data-testid="ad-readback-bid"]').text()).toBe('$0.54')
    expect(wrapper.get('[data-testid="ad-product-details"]').text()).toContain(data.campaigns[0]!.products[0]!.sku)
    wrapper.unmount()
  })

  it('keeps entry baseline unchanged if another tab changes products during filling', async () => {
    const { wrapper, state, data, submit } = mountFixture()
    const initial = advertisingFingerprint(state, data)
    await fillForm(wrapper)
    state.products[0]!.variants[1]!.quantity += 1
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(submit.mock.calls[0]![1]).toBe(initial)
    expect(wrapper.get('[data-testid="advertising-error"]').text()).toContain('已变化')
    expect(data.campaigns).toEqual([])
    wrapper.unmount()
  })

  it('cancel does not save draft or call submission', async () => {
    const { wrapper, data, submit } = mountFixture()
    await fillForm(wrapper)
    await wrapper.get('[data-action="ad-cancel"]').trigger('click')
    expect(wrapper.find('[data-action="ad-create"]').exists()).toBe(true)
    expect(data.campaigns).toEqual([])
    expect(submit).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('opens exact focusId at mount, then follows a new ID without guessing the first row', async () => {
    const { state, data, draft } = fixture()
    const first = create(state, data, draft)
    const second = create(state, data, { ...draft, name: '指定的第二条', groupName: '第二广告组' })
    const wrapper = mount(AdvertisingWorkflow, { props: { state, data, submit: vi.fn(), focusId: second.id } })
    expect(wrapper.get('.v2-ad-detail-heading').text()).toContain('指定的第二条')
    await wrapper.setProps({ focusId: first.id })
    expect(wrapper.get('.v2-ad-detail-heading').text()).toContain(first.name)
    wrapper.unmount()
  })

  it.each(['', 'missing-campaign'])('reports missing explicit focusId %s instead of opening another record', (focusId) => {
    const { state, data, draft } = fixture()
    create(state, data, draft)
    const wrapper = mount(AdvertisingWorkflow, { props: { state, data, submit: vi.fn(), focusId } })
    expect(wrapper.get('[data-testid="advertising-error"]').text()).toContain('未找到指定')
    expect(wrapper.find('[data-testid="ad-product-details"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not create a success result if local persistence rejects the command', async () => {
    const { wrapper, submit, data } = mountFixture()
    submit.mockImplementationOnce(async () => ({ ok: false, message: '本地存储不可写；没有保存。' }))
    await fillForm(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-testid="advertising-error"]').text()).toContain('不可写')
    expect(wrapper.find('[data-testid="advertising-result"]').exists()).toBe(false)
    expect(data.campaigns).toEqual([])
    wrapper.unmount()
  })
})
