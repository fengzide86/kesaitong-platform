import { describe, expect, it } from 'vitest'
import { createSeed } from './model'
import { applyTemplateCommand, createTemplateData, getTemplateDetail, templateFingerprint, validTemplateData, type TemplateCommand, type TemplateDetail } from './template-workflow'

function fixture() {
  const state = createSeed(), data = createTemplateData()
  const template = { ...state.templates[0]!, id: 'local-new', name: '国际样例模板' }
  const detail: TemplateDetail = { templateId: template.id, mode: 'weight', rules: [
    { id: 'rule-1', scope: 'international', countries: ['英国', '德国'], service: '标准配送', transit: '7–14 天', base: 5.25, perUnit: 0, unit: 'lb', bands: [{ from: 0, to: null, fee: 3.5 }] },
  ] }
  const save: TemplateCommand = { type: 'save', template, detail }
  return { state, data, template, detail, save }
}
describe('offline template workflow', () => {
  it('starts with valid seed data and derives isolated legacy details', () => {
    const { state, data } = fixture()
    expect(validTemplateData(data, state)).toBe(true)
    const detail = getTemplateDetail(state.templates[0]!, data)
    detail.rules[0]!.countries.push('德国')
    expect(getTemplateDetail(state.templates[0]!, data).rules[0]!.countries).toEqual(['美国'])
  })
  it('creates template and persisted rule details together for list/readback', () => {
    const { state, data, save } = fixture()
    expect(applyTemplateCommand(state, data, save)).toMatchObject({ ok: true, id: 'local-new' })
    expect(state.templates).toHaveLength(4)
    expect(state.templates.at(-1)).toMatchObject({ country: '英国、德国', base: 5.25, perKg: 0 })
    expect(data.details[0]!.rules[0]).toMatchObject({ countries: ['英国', '德国'], unit: 'lb' })
  })
  it('edits the same object without creating duplicate template rows', () => {
    const f = fixture()
    applyTemplateCommand(f.state, f.data, f.save)
    f.template.name = '国际样例模板已编辑'; f.detail.rules[0]!.base = 8.99
    expect(applyTemplateCommand(f.state, f.data, f.save).ok).toBe(true)
    expect(f.state.templates).toHaveLength(4)
    expect(getTemplateDetail(f.state.templates.at(-1)!, f.data).rules[0]!.base).toBe(8.99)
  })
  it('does not retain live command object references', () => {
    const f = fixture(); applyTemplateCommand(f.state, f.data, f.save)
    f.detail.rules[0]!.base = 999; f.template.name = 'changed outside transaction'
    expect(f.data.details[0]!.rules[0]!.base).toBe(5.25)
    expect(f.state.templates.at(-1)!.name).toBe('国际样例模板')
  })
  it('blocks trimmed/case-insensitive duplicate names without mutation', () => {
    const f = fixture(); f.template.name = '  样例标准配送  '
    const before = templateFingerprint(f.state, f.data)
    expect(applyTemplateCommand(f.state, f.data, f.save)).toMatchObject({ ok: false })
    expect(templateFingerprint(f.state, f.data)).toBe(before)
  })
  it('sets and restores default without rebinding products', () => {
    const f = fixture(), originalBindings = f.state.products.map(p => p.offer.templateId)
    applyTemplateCommand(f.state, f.data, f.save)
    expect(applyTemplateCommand(f.state, f.data, { type: 'default', id: 'local-new' }).ok).toBe(true)
    expect(f.data.defaultTemplateId).toBe('local-new')
    expect(applyTemplateCommand(f.state, f.data, { type: 'default', id: 'sample-standard' }).ok).toBe(true)
    expect(f.state.products.map(p => p.offer.templateId)).toEqual(originalBindings)
  })
  it('deletes only unbound nondefault templates and removes details', () => {
    const f = fixture(); applyTemplateCommand(f.state, f.data, f.save)
    expect(applyTemplateCommand(f.state, f.data, { type: 'delete', id: 'local-new' }).ok).toBe(true)
    expect(f.state.templates).toHaveLength(3); expect(f.data.details).toEqual([])
  })
  it('blocks default template deletion with explicit local safeguard', () => {
    const f = fixture()
    expect(applyTemplateCommand(f.state, f.data, { type: 'delete', id: 'sample-standard' })).toMatchObject({ ok: false, message: expect.stringContaining('默认') })
  })
  it('blocks deletion of templates referenced by any product', () => {
    const f = fixture()
    expect(applyTemplateCommand(f.state, f.data, { type: 'delete', id: 'sample-economy' })).toMatchObject({ ok: false, message: expect.stringContaining('使用') })
  })
  it('binds at product level, not guessed individual child SKU assignment', () => {
    const f = fixture(); applyTemplateCommand(f.state, f.data, f.save)
    const product = f.state.products[0]!, beforeVariants = JSON.stringify(product.variants), handling = product.offer.handlingTime
    expect(applyTemplateCommand(f.state, f.data, { type: 'assign', id: 'local-new', productId: product.id }).ok).toBe(true)
    expect(product.offer.templateId).toBe('local-new')
    expect(JSON.stringify(product.variants)).toBe(beforeVariants); expect(product.offer.handlingTime).toBe(handling)
    expect(applyTemplateCommand(f.state, f.data, { type: 'delete', id: 'local-new' }).ok).toBe(false)
  })
  it('rejects missing product and products with no live SKU', () => {
    const f = fixture()
    expect(applyTemplateCommand(f.state, f.data, { type: 'assign', id: 'sample-standard', productId: 'gone' }).ok).toBe(false)
    const p = f.state.products[0]!; p.variants.forEach(v => { v.deleted = true })
    expect(applyTemplateCommand(f.state, f.data, { type: 'assign', id: 'sample-standard', productId: p.id }).ok).toBe(false)
  })
  it('roundtrips two price bands including open final range', () => {
    const f = fixture(); f.detail.mode = 'price'
    f.detail.rules[0]!.bands = [{ from: 0, to: 10, fee: 2.5 }, { from: 10.01, to: null, fee: 1.5 }]
    expect(applyTemplateCommand(f.state, f.data, f.save).ok).toBe(true)
    expect(getTemplateDetail(f.state.templates.at(-1)!, f.data).rules[0]!.bands).toEqual(f.detail.rules[0]!.bands)
  })
  it('accepts representable decimal price bands such as 0.29', () => {
    const f = fixture(); f.detail.mode = 'price'
    f.detail.rules[0]!.bands = [{ from: 0, to: 0.29, fee: 0 }, { from: 0.3, to: null, fee: 0.5 }]
    expect(applyTemplateCommand(f.state, f.data, f.save).ok).toBe(true)
  })
  it.each([
    { bands: [{ from: 1, to: null, fee: 2 }] },
    { bands: [{ from: 0, to: 10, fee: 2 }, { from: 10, to: null, fee: 2 }] },
    { bands: [{ from: 0, to: 10, fee: 2 }] },
    { bands: [{ from: 0, to: null, fee: -1 }] },
  ])('rejects invalid or discontinuous price ranges atomically (%j)', ({ bands }) => {
    const f = fixture(); f.detail.mode = 'price'; f.detail.rules[0]!.bands = bands
    const before = templateFingerprint(f.state, f.data)
    expect(applyTemplateCommand(f.state, f.data, f.save).ok).toBe(false)
    expect(templateFingerprint(f.state, f.data)).toBe(before)
  })
  it('requires countries and prevents duplicate country/service combinations', () => {
    const f = fixture(); f.detail.rules[0]!.countries = []
    expect(applyTemplateCommand(f.state, f.data, f.save).ok).toBe(false)
    f.detail.rules[0]!.countries = ['英国']; f.detail.rules.push({ ...f.detail.rules[0]!, id: 'second' })
    expect(applyTemplateCommand(f.state, f.data, f.save).ok).toBe(false)
  })
  it('allows one country in different observed service groups', () => {
    const f = fixture(); f.detail.rules.push({ ...f.detail.rules[0]!, id: 'second', service: '加急配送' })
    expect(applyTemplateCommand(f.state, f.data, f.save).ok).toBe(true)
  })
  it('rejects unobserved international one-day service', () => {
    const f = fixture(); f.detail.rules[0]!.service = '一日配送'
    expect(applyTemplateCommand(f.state, f.data, f.save).ok).toBe(false)
  })
  it('keeps domestic scope limited to the local US sample', () => {
    const f = fixture(); f.detail.rules[0]!.scope = 'domestic'
    expect(applyTemplateCommand(f.state, f.data, f.save).ok).toBe(false)
  })
  it('rejects nonfinite fees, missing transit and empty rules', () => {
    const f = fixture(); f.detail.rules[0]!.perUnit = Number.NaN
    expect(applyTemplateCommand(f.state, f.data, f.save).ok).toBe(false)
    f.detail.rules[0]!.perUnit = 0; f.detail.rules[0]!.transit = ' '
    expect(applyTemplateCommand(f.state, f.data, f.save).ok).toBe(false)
    f.detail.rules = []; expect(applyTemplateCommand(f.state, f.data, f.save).ok).toBe(false)
  })
  it('rejects wrong rule/template identity and invalid local metadata', () => {
    const f = fixture(); f.detail.templateId = 'different'
    expect(applyTemplateCommand(f.state, f.data, f.save).ok).toBe(false)
    f.detail.templateId = f.template.id; f.template.limit = -1
    expect(applyTemplateCommand(f.state, f.data, f.save).ok).toBe(false)
  })
  it('rejects malformed stored data, orphan and duplicated detail IDs', () => {
    const f = fixture()
    expect(validTemplateData(null, f.state)).toBe(false)
    expect(validTemplateData({ ...f.data, defaultTemplateId: 'gone' }, f.state)).toBe(false)
    expect(validTemplateData({ ...f.data, details: [f.detail] }, f.state)).toBe(false)
    applyTemplateCommand(f.state, f.data, f.save)
    expect(validTemplateData({ ...f.data, details: [f.detail, f.detail] }, f.state)).toBe(false)
    expect(validTemplateData(JSON.parse(JSON.stringify(f.data)), f.state)).toBe(true)
  })
  it('fingerprint detects concurrent default, binding, SKU and rule changes', () => {
    const f = fixture(), original = templateFingerprint(f.state, f.data)
    f.data.defaultTemplateId = 'sample-economy'; expect(templateFingerprint(f.state, f.data)).not.toBe(original)
    f.data.defaultTemplateId = 'sample-standard'; f.state.products[0]!.offer.templateId = 'sample-priority'
    expect(templateFingerprint(f.state, f.data)).not.toBe(original)
    f.state.products[0]!.offer.templateId = 'sample-standard'; f.state.products[0]!.variants[0]!.sku = 'changed'
    expect(templateFingerprint(f.state, f.data)).not.toBe(original)
  })
  it('repeated deletion and unknown commands do not report success', () => {
    const f = fixture()
    expect(applyTemplateCommand(f.state, f.data, { type: 'delete', id: 'gone' }).ok).toBe(false)
    expect(applyTemplateCommand(f.state, f.data, { type: 'bogus', id: 'sample-standard' } as unknown as TemplateCommand).ok).toBe(false)
  })
})
