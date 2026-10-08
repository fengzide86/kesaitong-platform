import { describe, expect, it } from 'vitest'
import {
  createSeed, inventoryRows, isSafeImage, MAX_IMAGE_BYTES, newProduct, newVariant,
  persistState, readState, saveProduct, SIMULATION_STORAGE_KEY, validateProduct,
  type Product,
} from './model'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
function memoryStorage() {
  const entries = new Map<string, string>()
  return { entries, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) } }
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function completeProduct(): Product {
  const product = newProduct('office-storage')
  Object.assign(product, { title: '新建虚构文具盒', brand: 'Demo Only', manufacturer: 'Sample Studio', parentSku: 'NEW-PARENT',
    description: '本地虚构商品，用于验证多变体独立保存。', features: ['可分格整理'], images: [PNG] })
  product.compliance.itemWeight = '0.2'
  product.variants = [
    newVariant({ term: '海蓝 / S', color: '海蓝', size: 'S', sku: 'NEW-BLUE-S', code: 'SAMPLE-NEW-01', price: 12.8, quantity: 20 }),
    newVariant({ term: '浅灰 / L', color: '浅灰', size: 'L', sku: 'NEW-GRAY-L', code: 'SAMPLE-NEW-02', price: 15.8, quantity: 30, delivery: 'FBA' }),
  ]
  return product
}

describe('offline V2 seed and identities', () => {
  it('contains six fictional parents, 14 independent SKU rows, three templates and two correctly bound orders', () => {
    const state = createSeed()
    expect(state.version).toBe(2)
    expect(state.products).toHaveLength(6)
    expect(state.templates).toHaveLength(3)
    expect(state.orders).toHaveLength(2)
    const rows = inventoryRows(state)
    expect(rows).toHaveLength(14)
    expect(new Set(rows.map(row => row.variant.sku)).size).toBe(14)
    expect(new Set(rows.map(row => row.variant.id)).size).toBe(14)
    expect(new Set(rows.map(row => row.variant.delivery))).toEqual(new Set(['FBM', 'FBA']))
    state.orders.forEach(order => expect(rows.some(row => row.product.id === order.productId && row.variant.id === order.variantId)).toBe(true))
    state.products.forEach(product => expect(validateProduct(state, product, true)).toEqual([]))
  })

  it('returns fresh data without sharing mutable defaults or seed objects', () => {
    const first = createSeed(); const second = createSeed()
    first.products[0]!.keywords.searchTerms.push('仅在第一份')
    first.products[0]!.variants[0]!.quantity = 1
    expect(second.products[0]!.keywords.searchTerms).not.toContain('仅在第一份')
    expect(second.products[0]!.variants[0]!.quantity).not.toBe(1)
    const product = newProduct('fashion-jewelry')
    expect(product.categoryId).toBe('fashion-jewelry')
    expect(product.moreDetails).toHaveProperty('metalStamp')
    expect(newProduct().id).not.toBe(newProduct().id)
  })

  it('omits locally deleted rows from inventory while preserving them for restoration', () => {
    const state = createSeed(); const product = state.products[0]!
    const variant = product.variants[0]!
    variant.deleted = true
    expect(inventoryRows(state)).toHaveLength(13)
    expect(product.variants).toHaveLength(3)
    variant.deleted = false
    expect(inventoryRows(state).find(row => row.variant.id === variant.id)?.variant.sku).toBe(variant.sku)
  })
})

describe('local draft and completion contract', () => {
  it('allows an incomplete draft but reports field and tab errors for completion', () => {
    const state = createSeed(); const product = newProduct()
    const result = saveProduct(state, product, false)
    expect(result).toEqual({ ok: true, errors: [], id: product.id })
    expect(state.products.at(-1)?.status).toBe('draft')
    const originalCount = state.products.length
    const completed = saveProduct(state, product, true)
    expect(completed.ok).toBe(false)
    expect(completed.errors).toContainEqual(expect.objectContaining({ field: 'title', tab: 'important' }))
    expect(completed.errors).toContainEqual(expect.objectContaining({ field: `variants.${product.variants[0]!.id}.sku`, tab: 'variants' }))
    expect(completed.errors).toContainEqual(expect.objectContaining({ field: 'compliance.itemWeight', tab: 'compliance' }))
    expect(completed.errors).toContainEqual(expect.objectContaining({ field: 'description', tab: 'description' }))
    expect(state.products).toHaveLength(originalCount)
    expect(state.products.at(-1)?.status).toBe('draft')
  })

  it('saves all variants, repeated inputs, compliance and category-specific details independently', () => {
    const state = createSeed(); const product = completeProduct()
    product.keywords.searchTerms = ['旅行', '收纳', '便携']
    product.keywords.targetAudience = ['成人', '学生']
    product.compliance.chemicalNames = ['样例名称一', '样例名称二']
    product.moreDetails.itemLength = '24'; product.moreDetails.fabricType = '聚酯纤维'
    const result = saveProduct(state, product, true)
    expect(result.ok).toBe(true)
    const saved = state.products.find(item => item.id === result.id)!
    expect(saved.status).toBe('active')
    expect(saved.variants.map(variant => variant.sku)).toEqual(['NEW-BLUE-S', 'NEW-GRAY-L'])
    expect(saved.variants.map(variant => variant.quantity)).toEqual([20, 30])
    expect(saved.variants.map(variant => variant.price)).toEqual([12.8, 15.8])
    expect(saved.variants.map(variant => variant.delivery)).toEqual(['FBM', 'FBA'])
    expect(saved.parentSku).toBe('NEW-PARENT')
    expect(saved.keywords.searchTerms).toEqual(['旅行', '收纳', '便携'])
    expect(saved.compliance.chemicalNames).toHaveLength(2)
    expect(saved.moreDetails.itemLength).toBe('24')
    product.variants[0]!.quantity = 900
    product.keywords.searchTerms.push('未保存的编辑')
    expect(saved.variants[0]!.quantity).toBe(20)
    expect(saved.keywords.searchTerms).not.toContain('未保存的编辑')
  })

  it('retains parent and child identities, creation time, and different SKUs after edit and refresh', () => {
    const state = createSeed(); const product = completeProduct(); const storage = memoryStorage()
    const ids = product.variants.map(variant => variant.id)
    const createdAt = product.createdAt
    expect(saveProduct(state, product, true).ok).toBe(true)
    expect(persistState(storage, state)).toBe(true)
    const reopened = readState(storage)
    expect(reopened.temporary).toBe(false)
    const edit = clone(reopened.state.products.find(item => item.id === product.id)!)
    edit.variants[0]!.price = 18.5; edit.variants[1]!.sku = 'NEW-GRAY-L-REVISED'
    edit.createdAt = '2099-01-01T00:00:00.000Z'
    expect(saveProduct(reopened.state, edit, true).ok).toBe(true)
    expect(reopened.state.products).toHaveLength(7)
    const saved = reopened.state.products.find(item => item.id === product.id)!
    expect(saved.createdAt).toBe(createdAt)
    expect(saved.variants.map(variant => variant.id)).toEqual(ids)
    expect(saved.variants.map(variant => variant.sku)).toEqual(['NEW-BLUE-S', 'NEW-GRAY-L-REVISED'])
    expect(persistState(storage, reopened.state)).toBe(true)
    expect(readState(storage).state.products.at(-1)?.variants.map(variant => variant.id)).toEqual(ids)
  })

  it('rejects cross-product SKU, same-parent duplicate SKU, and parent/child collisions before any mutation', () => {
    const state = createSeed(); const product = completeProduct()
    const before = JSON.stringify(state)
    product.variants[0]!.sku = `  ${state.products[0]!.variants[0]!.sku.toLowerCase()}  `
    expect(saveProduct(state, product, true).errors.some(error => error.field.endsWith('.sku'))).toBe(true)
    expect(JSON.stringify(state)).toBe(before)
    product.variants[0]!.sku = 'NEW-BLUE-S'; product.variants[1]!.sku = 'new-blue-s'
    expect(saveProduct(state, product, false).ok).toBe(false)
    product.variants[1]!.sku = product.parentSku
    expect(saveProduct(state, product, true).ok).toBe(false)
    product.variants[1]!.sku = 'NEW-GRAY-L'; product.parentSku = state.products[1]!.parentSku
    expect(saveProduct(state, product, true).errors.some(error => error.field === 'parentSku')).toBe(true)
  })

  it('does not invent an FBA ban for batteries, zero inventory, or a missing FBM template on all-FBA products', () => {
    const state = createSeed(); const product = completeProduct()
    product.variants.forEach(variant => { variant.delivery = 'FBA'; variant.quantity = 0 })
    product.compliance.batteryRequired = true; product.compliance.batteriesIncluded = true
    product.offer.templateId = ''
    expect(saveProduct(state, product, true).ok).toBe(true)
    product.variants[0]!.delivery = 'FBM'
    expect(validateProduct(state, product, true)).toContainEqual(expect.objectContaining({ field: 'offer.templateId', tab: 'offer' }))
  })

  it('prevents a new parent from hijacking another product variant identity', () => {
    const state = createSeed(); const product = completeProduct()
    product.variants[0]!.id = state.products[0]!.variants[0]!.id
    const result = saveProduct(state, product, true)
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({ field: `variants.${product.variants[0]!.id}.id`, tab: 'variants' }))
    expect(state.products).toHaveLength(6)
  })

  it('checks invalid numerics in drafts too and dates without claiming real-platform scoring rules', () => {
    const state = createSeed(); const product = newProduct()
    product.variants[0]!.quantity = 1.5
    product.variants[0]!.price = Number.NaN
    product.offer.restockDate = '2026-02-30'
    const errors = validateProduct(state, product, false)
    expect(errors.some(error => error.field.endsWith('.quantity'))).toBe(true)
    expect(errors.some(error => error.field.endsWith('.price'))).toBe(true)
    expect(errors).toContainEqual(expect.objectContaining({ field: 'offer.restockDate', tab: 'offer' }))
  })
})

describe('strict local raster image boundary', () => {
  it('permits PNG/JPEG/WebP local raster bytes and rejects remote URLs, SVG, malformed MIME and base64', () => {
    expect(isSafeImage(PNG)).toBe(true)
    expect(isSafeImage(`data:image/jpeg;base64,${btoa(String.fromCharCode(255, 216, 255, 224))}`)).toBe(true)
    expect(isSafeImage(`data:image/webp;base64,${btoa('RIFF0000WEBP')}`)).toBe(true)
    for (const unsafe of ['https://example.invalid/image.png', '//example.invalid/image.jpg', 'file:///C:/photo.png', 'blob:local-image', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,PGh0bWw+', 'data:image/png;base64,SGVsbG8=', 'data:image/png;base64,@@@@', 'data:image/png;base64,iVBORw', '', PNG.replace('image/png', 'image/jpeg')]) {
      expect(isSafeImage(unsafe), unsafe).toBe(false)
    }
  })

  it('rejects images larger than the local 1 MB limit in both product and SKU image fields', () => {
    const bytes = String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10) + 'a'.repeat(MAX_IMAGE_BYTES - 7)
    const tooLarge = `data:image/png;base64,${btoa(bytes)}`
    expect(isSafeImage(tooLarge)).toBe(false)
    const state = createSeed(); const product = completeProduct()
    product.images = [tooLarge]; product.variants[0]!.image = 'https://example.invalid/sku.jpg'
    expect(saveProduct(state, product, false).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'images.0', tab: 'images' }),
      expect.objectContaining({ field: `variants.${product.variants[0]!.id}.image`, tab: 'variants' }),
    ]))
  })

  it('rejects remote images even on deleted variants and never persists unsafe state', () => {
    const state = createSeed(); const storage = memoryStorage()
    state.products[0]!.variants[0]!.deleted = true
    state.products[0]!.variants[0]!.image = 'https://example.invalid/deleted.jpg'
    expect(validateProduct(state, state.products[0]!, false).some(error => error.field.endsWith('.image'))).toBe(true)
    expect(persistState(storage, state)).toBe(false)
    expect(storage.entries.size).toBe(0)
  })
})

describe('versioned storage and graceful temporary mode', () => {
  it('uses an independent v2 key and never reads, migrates, or removes v1', () => {
    const storage = memoryStorage(); const v1 = 'kst-public-simulation:v1'
    storage.entries.set(v1, 'preserve old sample untouched')
    expect(readState(storage).state.products).toHaveLength(6)
    expect(readState(storage).temporary).toBe(false)
    const state = createSeed()
    expect(persistState(storage, state)).toBe(true)
    expect(storage.entries.get(v1)).toBe('preserve old sample untouched')
    expect(storage.entries.has(SIMULATION_STORAGE_KEY)).toBe(true)
    expect(readState(storage).state).toEqual(state)
  })

  it('survives unavailable, blocked, quota-exceeded, and malformed browser storage without deleting anything', () => {
    expect(readState().temporary).toBe(true)
    expect(readState(null).notice).toContain('临时')
    expect(persistState(undefined, createSeed())).toBe(false)
    const blockedRead = { getItem: () => { throw new Error('blocked') } }
    const blockedWrite = { setItem: () => { throw new Error('quota') } }
    expect(readState(blockedRead).temporary).toBe(true)
    expect(persistState(blockedWrite, createSeed())).toBe(false)
    const storage = memoryStorage()
    storage.entries.set(SIMULATION_STORAGE_KEY, '{malformed')
    expect(readState(storage).temporary).toBe(true)
    expect(storage.entries.get(SIMULATION_STORAGE_KEY)).toBe('{malformed')
  })

  it('rejects corrupt shape, duplicate identities, nonexistent order bindings and remote images on read', () => {
    const unsafeStates = [
      { version: 2, products: [], templates: [], orders: [{ id: 'x' }] },
      (() => { const state = createSeed(); state.products[0]!.images = ['https://example.invalid/track.png']; return state })(),
      (() => { const state = createSeed(); state.products[0]!.variants[0]!.image = 'data:image/svg+xml;base64,PHN2Zz4='; return state })(),
      (() => { const state = createSeed(); state.products[0]!.variants[0]!.quantity = -1; return state })(),
      (() => { const state = createSeed(); state.products[0]!.variants[1]!.id = state.products[0]!.variants[0]!.id; return state })(),
      (() => { const state = createSeed(); state.orders[0]!.variantId = 'missing-variant'; return state })(),
      (() => { const state = createSeed(); state.products[0]!.keywords = 'invalid' as unknown as Product['keywords']; return state })(),
    ]
    for (const unsafe of unsafeStates) {
      const storage = memoryStorage(); const raw = JSON.stringify(unsafe)
      storage.entries.set(SIMULATION_STORAGE_KEY, raw)
      expect(readState(storage).temporary).toBe(true)
      expect(storage.entries.get(SIMULATION_STORAGE_KEY)).toBe(raw)
    }
  })
})
