import { describe, expect, it } from 'vitest'
import { createSeed, persistState, readState, SIMULATION_STORAGE_KEY } from './model'
import { applyFbaCommand } from './fba-workflow'
import { applyAdvertisingCommand, advertisingCandidates, createAdvertisingDraft } from './advertising-workflow'

function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) || null, setItem: (key: string, value: string) => { values.set(key, value) } }
}
describe('workflow persistence and compatibility', () => {
  it('reads previously saved v2 samples without requiring or erasing new workflow properties', () => {
    const store = storage(), state = createSeed()
    delete state.fba; delete state.advertising; delete state.templateData
    expect(persistState(store, state)).toBe(true)
    expect(readState(store)).toEqual({ state, temporary: false, notice: '' })
  })
  it('preserves conversion and advertising history after ordinary inventory changes', () => {
    const store = storage(), state = createSeed(), product = state.products[0]!, variant = product.variants[0]!
    expect(applyFbaCommand(state, state.fba!, { type: 'convert', variantIds: [variant.id], declarations: [{ variantId: variant.id, battery: 'no', hazardous: 'no' }] }).ok).toBe(true)
    const ref = advertisingCandidates(state).find(item => item.variantId === variant.id)!
    const draft = createAdvertisingDraft(); draft.name = '历史活动'; draft.groupName = '历史广告组'; draft.products = [ref]
    expect(applyAdvertisingCommand(state, state.advertising!, { type: 'save', draft, publish: true }).ok).toBe(true)
    variant.delivery = 'FBM'; variant.status = 'inactive'; variant.quantity = 7; variant.sku = 'CHANGED-SKU'
    expect(persistState(store, state)).toBe(true)
    const readback = readState(store)
    expect(readback.temporary).toBe(false)
    expect(readback.state.fba!.conversions[0]!.variantId).toBe(variant.id)
    expect(readback.state.advertising!.campaigns[0]!.products[0]!.sku).toBe(ref.sku)
    expect(readback.state.products[0]!.variants[0]!.quantity).toBe(7)
  })
  it('rejects malformed new records without overwriting previously saved samples', () => {
    const store = storage(), state = createSeed()
    expect(persistState(store, state)).toBe(true)
    const original = store.getItem(SIMULATION_STORAGE_KEY)
    state.advertising = { version: 1, campaigns: [{}] } as never
    expect(persistState(store, state)).toBe(false)
    expect(store.getItem(SIMULATION_STORAGE_KEY)).toBe(original)
  })
})
