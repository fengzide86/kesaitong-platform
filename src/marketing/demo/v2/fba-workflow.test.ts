import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { createSeed, type State } from './model'
import { applyFbaCommand, createFbaData, fbaFingerprint, fbaRows, validFbaData, type FbaCommand } from './fba-workflow'
import FbaWorkflow from './FbaWorkflow.vue'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
function sample() {
  const state = reactive(createSeed()); const data = state.fba ?? createFbaData()
  const product = state.products[0]!; const variant = product.variants[0]!
  return { state, data, product, variant }
}
const conversion = (...ids: string[]): FbaCommand => ({ type: 'convert', variantIds: ids, declarations: ids.map(variantId => ({ variantId, battery: 'no', hazardous: 'no' })) })
function draft(variantId: string): Extract<FbaCommand, { type: 'save-preparation' }> {
  return { type: 'save-preparation', preparation: { variantId, name: '练习入库计划', quantity: 5, prepBy: 'seller', labelBy: 'seller', labelCount: 5, weightLb: 2, lengthIn: 10, widthIn: 8, heightIn: 6 } }
}

describe('FBA local commands and evidence boundaries', () => {
  it('starts with independent empty conversion/preparation records', () => {
    const first = createFbaData(); const second = createFbaData()
    expect(first).toEqual({ version: 1, conversions: [], preparations: [] })
    expect(first.conversions).not.toBe(second.conversions)
    expect(validFbaData(first, createSeed())).toBe(true)
  })
  it('converts a child SKU with same-entity FNSKU readback and no domestic stock deduction', () => {
    const { state, data, product, variant } = sample(); const quantity = variant.quantity
    const reply = applyFbaCommand(state, data, conversion(variant.id))
    expect(reply.ok).toBe(true); expect(reply.id).toBe(variant.id); expect(variant.delivery).toBe('FBA')
    expect(data.conversions[0]).toMatchObject({ productId: product.id, variantId: variant.id, battery: 'no', hazardous: 'no' })
    expect(fbaRows(state, data).find(row => row.variant.id === variant.id)).toMatchObject({ available: 0, fnsku: `DEMO-FNSKU-${variant.id}` })
    expect(variant.quantity).toBe(quantity); expect(data.preparations).toEqual([])
    expect(validFbaData(clone(data), state)).toBe(true)
  })
  it('does not treat existing seed FBA listing quantities as received inventory', () => {
    const { state, data } = sample()
    expect(fbaRows(state, data).length).toBeGreaterThan(0)
    expect(fbaRows(state, data).every(row => row.available === 0)).toBe(true)
  })
  it('rejects repeated conversion without changing its previous record or stock', () => {
    const { state, data, variant } = sample(); const command = conversion(variant.id)
    applyFbaCommand(state, data, command); const before = fbaFingerprint(state, data)
    expect(applyFbaCommand(state, data, command).ok).toBe(false)
    expect(fbaFingerprint(state, data)).toBe(before)
  })
  it('validates every selected row before any partial conversion', () => {
    const { state, data, variant } = sample(); const before = fbaFingerprint(state, data)
    expect(applyFbaCommand(state, data, conversion(variant.id, 'missing-child')).ok).toBe(false)
    expect(fbaFingerprint(state, data)).toBe(before)
  })
  it.each(['empty', 'parent', 'duplicate', 'deleted', 'inactive', 'draft', 'sku-empty'])('rejects invalid selection %s atomically', (failure) => {
    const { state, data, product, variant } = sample()
    if (failure === 'deleted') variant.deleted = true
    if (failure === 'inactive') variant.status = 'inactive'
    if (failure === 'draft') product.status = 'draft'
    if (failure === 'sku-empty') variant.sku = '  '
    const ids = failure === 'empty' ? [] : failure === 'parent' ? [product.id] : failure === 'duplicate' ? [variant.id, variant.id] : [variant.id]
    const before = fbaFingerprint(state, data)
    expect(applyFbaCommand(state, data, conversion(...ids)).ok).toBe(false)
    expect(fbaFingerprint(state, data)).toBe(before)
  })
  it.each(['yes', 'unknown', ''] as const)('does not invent hazmat approval for answer %s', (answer) => {
    const { state, data, variant } = sample(); const before = fbaFingerprint(state, data)
    expect(applyFbaCommand(state, data, { type: 'convert', variantIds: [variant.id], declarations: [{ variantId: variant.id, battery: answer, hazardous: 'no' }] }).ok).toBe(false)
    expect(fbaFingerprint(state, data)).toBe(before)
  })
  it('requires a declaration tied to each selected child rather than another SKU', () => {
    const { state, data, variant } = sample()
    const command: FbaCommand = { type: 'convert', variantIds: [variant.id], declarations: [{ variantId: 'other-sku', battery: 'no', hazardous: 'no' }] }
    expect(applyFbaCommand(state, data, command).ok).toBe(false)
  })
  it.each(['batteriesIncluded', 'batteryRequired', 'hazardousRegulations'])('blocks declaration/compliance mismatch %s', (field) => {
    const { state, data, product, variant } = sample()
    if (field === 'hazardousRegulations') product.compliance.hazardousRegulations = ['Transportation']
    else if (field === 'batteryRequired') product.compliance.batteryRequired = true
    else product.compliance.batteriesIncluded = true
    expect(applyFbaCommand(state, data, conversion(variant.id)).message).toContain('不一致')
  })
  it('stores a complete local preparation but never adds shipped/received stock', () => {
    const { state, data, variant } = sample(); applyFbaCommand(state, data, conversion(variant.id))
    const before = JSON.stringify(state.products); const reply = applyFbaCommand(state, data, draft(variant.id))
    expect(reply.ok).toBe(true); expect(reply.message).toContain('未入库')
    expect(data.preparations[0]).toMatchObject({ variantId: variant.id, status: 'local-draft', quantity: 5 })
    expect(JSON.stringify(state.products)).toBe(before); expect(fbaRows(state, data).every(row => row.available === 0)).toBe(true)
    expect(validFbaData(clone(data), state)).toBe(true)
  })
  it('updates the same draft identity instead of creating duplicate shipments', () => {
    const { state, data, variant } = sample(); applyFbaCommand(state, data, conversion(variant.id))
    const command = draft(variant.id); applyFbaCommand(state, data, command)
    command.preparation.name = '修改后的准备'; applyFbaCommand(state, data, command)
    expect(data.preparations).toHaveLength(1); expect(data.preparations[0]?.name).toBe('修改后的准备')
  })
  it.each(['name', 'quantity', 'labelCount', 'weightLb', 'lengthIn', 'widthIn', 'heightIn', 'prepBy', 'labelBy'])('rejects invalid preparation %s without mutating saved draft', (field) => {
    const { state, data, variant } = sample(); applyFbaCommand(state, data, conversion(variant.id)); applyFbaCommand(state, data, draft(variant.id))
    const command = draft(variant.id)
    const bad = { ...command.preparation, [field]: ['name', 'prepBy', 'labelBy'].includes(field) ? '' : 0 }
    const before = fbaFingerprint(state, data)
    expect(applyFbaCommand(state, data, { type: 'save-preparation', preparation: bad }).ok).toBe(false)
    expect(fbaFingerprint(state, data)).toBe(before)
  })
  it.each(['inactive', 'draft', 'fbm', 'rename', 'deleted'])('preserves historical records after later inventory change %s', (change) => {
    const { state, data, product, variant } = sample(); applyFbaCommand(state, data, conversion(variant.id)); applyFbaCommand(state, data, draft(variant.id))
    if (change === 'inactive') variant.status = 'inactive'
    if (change === 'draft') product.status = 'draft'
    if (change === 'fbm') variant.delivery = 'FBM'
    if (change === 'rename') variant.sku = 'NEW-LOCAL-SKU'
    if (change === 'deleted') variant.deleted = true
    expect(validFbaData(clone(data), state)).toBe(true)
    if (change !== 'rename') expect(applyFbaCommand(state, data, draft(variant.id)).ok).toBe(false)
  })
  it('can reconvert after an explicit switch to FBM without duplicating history', () => {
    const { state, data, variant } = sample(); applyFbaCommand(state, data, conversion(variant.id))
    const code = data.conversions[0]!.fnsku; variant.delivery = 'FBM'
    expect(applyFbaCommand(state, data, conversion(variant.id)).ok).toBe(true)
    expect(data.conversions).toHaveLength(1); expect(data.conversions[0]?.fnsku).toBe(code)
  })
  it('rejects malformed, duplicate or dangling stored records', () => {
    const { state, data, variant } = sample(); applyFbaCommand(state, data, conversion(variant.id)); applyFbaCommand(state, data, draft(variant.id))
    expect(validFbaData(null, state)).toBe(false)
    expect(validFbaData({ ...data, version: 2 }, state)).toBe(false)
    expect(validFbaData({ ...data, conversions: [...data.conversions, ...data.conversions] }, state)).toBe(false)
    expect(validFbaData({ ...data, preparations: [...data.preparations, ...data.preparations] }, state)).toBe(false)
    const bad = clone(data); bad.conversions[0]!.productId = 'unknown'; expect(validFbaData(bad, state)).toBe(false)
    const shipped = clone(data); (shipped.preparations[0] as unknown as { status: string }).status = '已完成'; expect(validFbaData(shipped, state)).toBe(false)
    const invalidDate = clone(data); invalidDate.conversions[0]!.convertedAt = 'yesterday'; expect(validFbaData(invalidDate, state)).toBe(false)
  })
})

async function fillConversion(wrapper: ReturnType<typeof mount<typeof FbaWorkflow>>, id: string) {
  await wrapper.get('[data-action="fba-new-conversion"]').trigger('click')
  await wrapper.get(`[name="fbaSku"][value="${id}"]`).setValue(true)
  await wrapper.get('[data-action="fba-selection-confirm"]').trigger('click')
  await wrapper.get('[data-action="fba-only-convert"]').trigger('click')
  await wrapper.get('[data-action="fba-hazard-open"]').trigger('click')
  await wrapper.get('[name="fbaBattery"][value="no"]').setValue(true)
  await wrapper.get('[name="fbaHazardous"][value="no"]').setValue(true)
  await wrapper.get('form').trigger('submit')
}

describe('FBA shared forms', () => {
  it('uses the same manual form commands for successful conversion and readback', async () => {
    const { state, data, variant } = sample()
    const submit = vi.fn(async (command: FbaCommand) => applyFbaCommand(state, data, command))
    const wrapper = mount(FbaWorkflow, { props: { state, data, submit } })
    await fillConversion(wrapper, variant.id)
    await wrapper.get('[data-action="fba-save-conversion"]').trigger('click'); await flushPromises()
    expect(submit).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-testid="fba-result"]').attributes('data-success')).toBe('true')
    expect(wrapper.get(`[data-fba-row="${variant.id}"]`).text()).toContain(`DEMO-FNSKU-${variant.id}`)
    wrapper.unmount()
  })
  it('keeps the form and original baseline on a stale-save rejection', async () => {
    const { state, data, variant } = sample(); const original = fbaFingerprint(state, data)
    const submit = vi.fn(async (_command: FbaCommand, _baseline: string) => ({ ok: false, message: '记录已变化，请重新打开。' }))
    const wrapper = mount(FbaWorkflow, { props: { state, data, submit } })
    await fillConversion(wrapper, variant.id)
    const changed: State = clone(state); changed.products[0]!.variants[0]!.price += 1
    await wrapper.setProps({ state: changed })
    expect(wrapper.text()).toContain('库存或 FBA 记录已变化')
    await wrapper.get('[data-action="fba-save-conversion"]').trigger('click'); await flushPromises()
    expect(submit.mock.calls[0]?.[1]).toBe(original)
    expect(wrapper.find('[data-action="fba-save-conversion"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="fba-result"]').attributes('data-success')).toBe('false')
    wrapper.unmount()
  })
  it('does not advance or write after cancelled or incomplete hazard answers', async () => {
    const { state, data, variant } = sample(); const submit = vi.fn(async () => ({ ok: true, message: 'unexpected' }))
    const wrapper = mount(FbaWorkflow, { props: { state, data, submit, selection: [variant.id], initialMode: 'convert' } })
    await wrapper.get('[data-action="fba-selection-confirm"]').trigger('click')
    await wrapper.get('[data-action="fba-only-convert"]').trigger('click')
    await wrapper.get('[data-action="fba-save-conversion"]').trigger('click')
    expect(wrapper.text()).toContain('请完成每个子 SKU')
    await wrapper.get('[data-action="fba-hazard-open"]').trigger('click'); await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('请分别选择')
    await wrapper.get('[data-action="fba-hazard-cancel"]').trigger('click')
    expect(submit).not.toHaveBeenCalled(); expect(data.conversions).toHaveLength(0)
    wrapper.unmount()
  })
  it('highlights the exact result child passed by the completion card', () => {
    const { state, data, variant } = sample(); applyFbaCommand(state, data, conversion(variant.id))
    const wrapper = mount(FbaWorkflow, { props: { state, data, submit: async () => ({ ok: false, message: '' }), focusId: variant.id } })
    expect(wrapper.get(`[data-fba-row="${variant.id}"]`).attributes('data-focused')).toBe('true')
    expect(wrapper.findAll('[data-focused="true"]')).toHaveLength(1)
    wrapper.unmount()
  })
  it('keeps preparation drafts separate from empty platform shipments', () => {
    const { state, data, variant } = sample(); applyFbaCommand(state, data, conversion(variant.id)); applyFbaCommand(state, data, draft(variant.id))
    const wrapper = mount(FbaWorkflow, { props: { state, data, initialMode: 'shipments', submit: async () => ({ ok: false, message: '' }) } })
    expect(wrapper.text()).toContain('无相关数据'); expect(wrapper.text()).toContain('本地草稿 · 未发出')
    expect(wrapper.findAll('[data-fba-preparation]')).toHaveLength(1)
    wrapper.unmount()
  })
  it('walks all six preparation steps, saves, reopens and never claims a shipment', async () => {
    const { state, data } = sample(); const row = fbaRows(state, data)[0]!
    const submit = vi.fn(async (command: FbaCommand) => applyFbaCommand(state, data, command))
    const wrapper = mount(FbaWorkflow, { props: { state, data, submit } })
    await wrapper.get(`[data-action="fba-replenish"][data-fba-variant="${row.variant.id}"]`).trigger('click')
    await wrapper.get('[name="fbaPreparationName"]').setValue('本地六步准备')
    await wrapper.get('[name="fbaQuantity"]').setValue(3)
    await wrapper.get('[data-action="fba-continue-plan"]').trigger('click')
    await wrapper.get('[name="fbaPrepBy"]').setValue('seller')
    await wrapper.get('[data-action="fba-continue-plan"]').trigger('click')
    await wrapper.get('[name="fbaLabelCount"]').setValue(3)
    await wrapper.get('[data-action="fba-continue-plan"]').trigger('click')
    await wrapper.get('[data-action="fba-continue-plan"]').trigger('click')
    await wrapper.get('[name="fbaBoxWeight"]').setValue(4)
    await wrapper.get('[data-action="fba-continue-plan"]').trigger('click')
    expect(wrapper.text()).toContain('尚未创建货件')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(data.preparations).toHaveLength(1)
    expect(data.preparations[0]).toMatchObject({ quantity: 3, labelCount: 3, weightLb: 4, status: 'local-draft' })
    expect(wrapper.text()).toContain('本地草稿 · 未发出')
    await wrapper.get('[data-action="fba-edit-preparation"]').trigger('click')
    expect((wrapper.get('[name="fbaPreparationName"]').element as HTMLInputElement).value).toBe('本地六步准备')
    expect((wrapper.get('[name="fbaQuantity"]').element as HTMLInputElement).value).toBe('3')
    expect(submit).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
  it('does not silently invent an existing inbound plan', async () => {
    const { state, data } = sample(); const submit = vi.fn(async () => ({ ok: true, message: 'unexpected' }))
    const wrapper = mount(FbaWorkflow, { props: { state, data, submit } })
    await wrapper.findAll('[data-action="fba-replenish"]')[0]!.trigger('click')
    await wrapper.get('[name="fbaPlanType"][value="existing"]').setValue(true)
    await wrapper.get('[data-action="fba-continue-plan"]').trigger('click')
    expect(wrapper.text()).toContain('没有可添加的既有入库计划')
    expect(wrapper.find('[name="fbaPreparationName"]').exists()).toBe(true)
    expect(submit).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('keeps a thrown storage failure on the conversion screen without retry', async () => {
    const { state, data, variant } = sample(); const submit = vi.fn(async () => { throw new Error('quota') })
    const wrapper = mount(FbaWorkflow, { props: { state, data, submit } })
    await fillConversion(wrapper, variant.id); await wrapper.get('[data-action="fba-save-conversion"]').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('保存未完成'); expect(submit).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-action="fba-save-conversion"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
