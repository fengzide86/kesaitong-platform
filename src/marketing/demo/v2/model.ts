// Public, offline-only sample model. Do not import business APIs, credentials,
// desktop stores, telemetry or Runner code into this module.
import { createFbaData, validFbaData, type FbaData } from './fba-workflow'
import { createAdvertisingData, validAdvertisingData, type AdvertisingData } from './advertising-workflow'
import { createTemplateData, validTemplateData, type TemplateData } from './template-workflow'
export const SIMULATION_STORAGE_KEY = 'kst-public-simulation:v2'
export const STORAGE_KEY = SIMULATION_STORAGE_KEY
export const MAX_IMAGE_BYTES = 1024 * 1024

export type Delivery = 'FBM' | 'FBA'
export type ProductStatus = 'draft' | 'active'
export type EditorTab = 'important' | 'variants' | 'offer' | 'compliance' | 'images' | 'description' | 'keywords' | 'details'
export interface FieldError { field: string; message: string; tab: EditorTab }
export interface SaveResult { ok: boolean; errors: FieldError[]; id: string }
export interface Variant {
  id: string; term: string; color: string; size: string; sku: string; code: string
  codeType: string; condition: string; conditionNote: string; price: number; quantity: number
  image: string; deleted: boolean; delivery: Delivery; status: 'active' | 'inactive'
}
export interface Offer {
  templateId: string; maxOrderQuantity: number; manufacturerPrice: number; handlingTime: number
  restockDate: string; taxCode: string; giftMessage: boolean; giftWrap: boolean; startSaleDate: string
}
export interface Compliance {
  itemWeight: string; itemWeightUnit: string; batteryWeight: string; batteryWeightUnit: string
  wattHours: string; wattHoursUnit: string; lithiumContent: string; lithiumContentUnit: string
  capacity: string; capacityUnit: string; batteryLife: string; batteryLifeUnit: string
  batteryVoltage: string; batteryVoltageUnit: string; batteryType: string; batteryCount: string
  batteriesIncluded: boolean; batteryRequired: boolean; batteryComposition: string; lithiumPackaging: string
  lithiumIonCells: string; lithiumMetalCells: string; hazardousRegulations: string[]
  unNumber: string; sdsUrl: string; flashPoint: string; ghsSymbols: string[]
  proposition65Warning: string; chemicalNames: string[]
}
export interface Keywords {
  targetAudience: string[]; intendedUse: string[]; otherAttributes: string[]
  subjectMatter: string[]; searchTerms: string[]; platinumKeywords: string[]
}
export interface Product {
  id: string; title: string; brand: string; manufacturer: string; partNumber: string
  categoryId: string; categoryName: string; parentSku: string; asin: string; variantTheme: string
  variants: Variant[]; offer: Offer; compliance: Compliance; images: string[]
  features: string[]; description: string; warnings: { cpsia: string; cpsiaDescription: string }
  keywords: Keywords; moreDetails: Record<string, string>; createdAt: string; status: ProductStatus
}
export interface ShippingTemplate {
  id: string; name: string; country: string; service: string; unit: string; currency: string
  limit: number; handling: number; base: number; perKg: number
}
export type WarehouseStage = '待分拣' | '待打包' | '待出库' | '已出库'
export interface Order {
  id: string; productId: string; variantId: string; quantity: number; country: string
  status: '未发货' | '已发货'; warehouseStage: WarehouseStage; carrier: string; tracking: string
  shippingService?: string; shippingDate?: string
}
export interface State { version: 2; products: Product[]; templates: ShippingTemplate[]; orders: Order[]; fba?: FbaData; advertising?: AdvertisingData; templateData?: TemplateData }
export type SimulationState = State
export interface Category { id: string; name: string; path: string; details: string[] }
export const categories: Category[] = [
  { id: 'home-storage', name: '收纳袋', path: '家居与厨房 / 收纳与整理 / 收纳袋', details: ['fabricType', 'packageQuantity', 'itemLength', 'itemWidth', 'itemHeight'] },
  { id: 'home-kitchen', name: '饮水杯', path: '家居与厨房 / 厨房与餐饮 / 饮水杯', details: ['material', 'capacity', 'packageQuantity', 'itemHeight'] },
  { id: 'outdoor-travel', name: '旅行配件', path: '运动与户外 / 户外休闲 / 旅行配件', details: ['fabricType', 'styleName', 'itemLength', 'itemWidth'] },
  { id: 'office-storage', name: '桌面收纳', path: '办公用品 / 桌面整理 / 桌面收纳', details: ['material', 'packageQuantity', 'itemLength', 'itemWidth', 'itemHeight'] },
  { id: 'electronics-light', name: '阅读灯', path: '工具与家装 / 灯具与照明 / 阅读灯', details: ['modelNumber', 'itemLength', 'itemWidth', 'itemHeight'] },
  { id: 'fashion-jewelry', name: '时尚手链', path: '服饰鞋包 / 时尚珠宝 / 手链', details: ['metalStamp', 'claspType', 'chainType', 'numberOfStones', 'stoneColor'] },
]
export const CATEGORIES = categories
export const CODE_TYPES = ['GTIN', 'EAN', 'GCID', 'UPC']
export const CONDITIONS = ['New', 'Used - Like New', 'Used - Very Good', 'Used - Good', 'Used - Acceptable', 'Collectible - Like New', 'Collectible - Very Good', 'Collectible - Good', 'Collectible - Acceptable']
export const VARIANT_THEMES = ['颜色', '尺寸', '颜色-尺寸', '图案', '风格']

const detailKeys = [
  'shippingWeight', 'shippingWeightUnit', 'countryOfOrigin', 'launchDate', 'fabricType', 'importDesignation',
  'metalStamp', 'numberOfStones', 'claspType', 'chainType', 'certificateNumber', 'stoneCut', 'totalDiamondWeight',
  'stoneColor', 'stoneClarity', 'stoneShape', 'stoneCreationMethod', 'stoneTreatmentMethod', 'certificateType',
  'pearlType', 'pearlMinimumColor', 'pearlLuster', 'pearlShape', 'totalGemWeight', 'pearlUniformity',
  'pearlSurfaceBlemishes', 'pearlStringingMethod', 'sizePerPearl', 'numberOfPearls', 'styleName', 'releaseDate',
  'packageQuantity', 'maximumAggregateShipQuantity', 'discontinuedByManufacturer', 'stoneDimensionsUnit',
  'partNumber', 'catalogNumber', 'itemLength', 'itemWidth', 'itemHeight', 'itemDimensionsUnit',
  'packageLength', 'packageWidth', 'packageHeight', 'packageDimensionsUnit', 'weight', 'stoneWeight',
  'itemDisplayWeight', 'itemDisplayLength', 'itemDisplayWidth', 'itemDisplayHeight', 'itemDisplayDiameter',
  'itemDisplayDimensionsUnit', 'modelNumber', 'material', 'capacity',
]

function createId(prefix: string): string {
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  return `${prefix}-${token}`
}

export function newVariant(overrides: Partial<Variant> = {}): Variant {
  return { id: createId('variant'), term: '', color: '', size: '', sku: '', code: '', codeType: 'UPC',
    condition: 'New', conditionNote: '', price: 0, quantity: 0, image: '', deleted: false,
    delivery: 'FBM', status: 'active', ...overrides }
}

export function newProduct(categoryId = categories[0]!.id): Product {
  const category = categories.find(item => item.id === categoryId) ?? categories[0]!
  return {
    id: createId('product'), title: '', brand: '', manufacturer: '', partNumber: '', categoryId: category.id,
    categoryName: category.path, parentSku: '', asin: '', variantTheme: '颜色-尺寸', variants: [newVariant()],
    offer: { templateId: 'sample-standard', maxOrderQuantity: 5, manufacturerPrice: 0, handlingTime: 2,
      restockDate: '', taxCode: '', giftMessage: false, giftWrap: false, startSaleDate: '' },
    compliance: { itemWeight: '', itemWeightUnit: 'kg', batteryWeight: '', batteryWeightUnit: 'g',
      wattHours: '', wattHoursUnit: 'Wh', lithiumContent: '', lithiumContentUnit: 'g', capacity: '', capacityUnit: 'mAh',
      batteryLife: '', batteryLifeUnit: 'hours', batteryVoltage: '', batteryVoltageUnit: 'V', batteryType: '',
      batteryCount: '', batteriesIncluded: false, batteryRequired: false, batteryComposition: '', lithiumPackaging: '',
      lithiumIonCells: '', lithiumMetalCells: '', hazardousRegulations: ['Not Applicable'], unNumber: '', sdsUrl: '',
      flashPoint: '', ghsSymbols: [], proposition65Warning: '', chemicalNames: [] },
    images: [], features: [''], description: '', warnings: { cpsia: '', cpsiaDescription: '' },
    keywords: { targetAudience: [], intendedUse: [], otherAttributes: [], subjectMatter: [], searchTerms: [''], platinumKeywords: [] },
    moreDetails: Object.fromEntries(detailKeys.map(key => [key, ''])), createdAt: new Date().toISOString(), status: 'draft',
  }
}

interface SeedSpec {
  id: string; title: string; categoryId: string; prefix: string; weight: string; price: number
  colors: string[]; sizes: string[]; material: string; feature: string; deliveries: Delivery[]
}
const seedSpecs: SeedSpec[] = [
  { id: 'sample-travel-bag', title: '轻旅折叠收纳袋（虚构样例）', categoryId: 'home-storage', prefix: 'DEMO-BAG', weight: '0.25', price: 19.9, colors: ['海蓝色', '浅灰色', '墨绿色'], sizes: ['M', 'M', 'L'], material: '聚酯纤维', feature: '可折叠设计，适合分装旅行衣物', deliveries: ['FBM', 'FBA', 'FBM'] },
  { id: 'sample-insulated-cup', title: '晴空双层不锈钢随行杯（虚构样例）', categoryId: 'home-kitchen', prefix: 'DEMO-CUP', weight: '0.38', price: 24.5, colors: ['奶油白', '雾蓝色'], sizes: ['500 ml', '500 ml'], material: '不锈钢', feature: '双层杯身，可拆卸杯盖便于清洁', deliveries: ['FBA', 'FBM'] },
  { id: 'sample-travel-pillow', title: '云朵轻量旅行颈枕（虚构样例）', categoryId: 'outdoor-travel', prefix: 'DEMO-PILLOW', weight: '0.3', price: 22.8, colors: ['石墨灰', '暖杏色'], sizes: ['标准款', '标准款'], material: '聚酯纤维', feature: '柔软外套可拆洗，附带收纳袋', deliveries: ['FBM', 'FBA'] },
  { id: 'sample-desk-organizer', title: '木序桌面分格收纳盒（虚构样例）', categoryId: 'office-storage', prefix: 'DEMO-DESK', weight: '0.62', price: 28, colors: ['原木色', '胡桃色'], sizes: ['三格', '三格'], material: '竹木', feature: '三格布局用于整理文具与小物', deliveries: ['FBM', 'FBM'] },
  { id: 'sample-reading-light', title: '微光 USB 阅读灯（虚构样例）', categoryId: 'electronics-light', prefix: 'DEMO-LAMP', weight: '0.18', price: 16.5, colors: ['暖白色', '深灰色'], sizes: ['USB 供电', 'USB 供电'], material: 'ABS', feature: 'USB 外接供电，不含电池；柔性灯臂', deliveries: ['FBA', 'FBM'] },
  { id: 'sample-bracelet', title: '星迹简约编织手链（虚构样例）', categoryId: 'fashion-jewelry', prefix: 'DEMO-BRACELET', weight: '0.04', price: 12.9, colors: ['深蓝色', '酒红色', '米白色'], sizes: ['可调节', '可调节', '可调节'], material: '棉线', feature: '抽绳式调节，仅作日常服饰配件', deliveries: ['FBM', 'FBA', 'FBM'] },
]

export function createSeed(): State {
  const products = seedSpecs.map((spec, index) => {
    const product = newProduct(spec.categoryId)
    product.id = spec.id
    product.title = spec.title
    product.brand = 'KST Sample'
    product.manufacturer = 'Sample Studio（虚构）'
    product.partNumber = `SAMPLE-MODEL-${String(index + 1).padStart(2, '0')}`
    product.parentSku = `${spec.prefix}-PARENT`
    product.asin = `DEMOASIN${String(index + 1).padStart(2, '0')}`
    product.createdAt = `2026-10-0${index + 1}T02:00:00.000Z`
    product.status = index === 5 ? 'draft' : 'active'
    product.variants = spec.colors.map((color, variantIndex) => newVariant({
      id: `${spec.id}-variant-${variantIndex + 1}`, term: `${color} / ${spec.sizes[variantIndex]}`, color,
      size: spec.sizes[variantIndex]!, sku: `${spec.prefix}-${variantIndex + 1}`,
      code: `SAMPLE${String(index + 1).padStart(2, '0')}${String(variantIndex + 1).padStart(2, '0')}`,
      price: spec.price + variantIndex * 1.5, quantity: 40 + index * 8 + variantIndex * 12,
      delivery: spec.deliveries[variantIndex]!, status: index === 5 ? 'inactive' : 'active',
    }))
    product.offer.manufacturerPrice = spec.price + 10
    product.offer.startSaleDate = '2026-10-01'
    product.offer.templateId = index === 2 ? 'sample-economy' : index === 3 ? 'sample-priority' : 'sample-standard'
    product.compliance.itemWeight = spec.weight
    product.features = [spec.feature, `材质：${spec.material}`, '虚构练习数据，不构成真实商品承诺']
    product.description = `${spec.title}。${spec.feature}。本商品、品牌、SKU 及编码均为虚构本地样例，仅供编辑与库存操作体验。`
    product.keywords = { targetAudience: ['成人'], intendedUse: ['日常使用'], otherAttributes: ['轻便'], subjectMatter: ['生活用品'], searchTerms: [spec.title.split('（')[0]!, spec.material], platinumKeywords: [] }
    Object.assign(product.moreDetails, { countryOfOrigin: 'China', material: spec.material, fabricType: spec.material,
      shippingWeight: spec.weight, shippingWeightUnit: 'kg', packageQuantity: '1', modelNumber: product.partNumber,
      itemLength: '24', itemWidth: '12', itemHeight: '8', itemDimensionsUnit: 'cm',
      packageLength: '26', packageWidth: '14', packageHeight: '10', packageDimensionsUnit: 'cm',
      discontinuedByManufacturer: 'No' })
    return product
  })
  return {
    version: 2, products, fba: createFbaData(), advertising: createAdvertisingData(), templateData: createTemplateData(),
    templates: [
      { id: 'sample-standard', name: '样例标准配送', country: '美国', service: '标准配送', unit: 'kg', currency: 'USD', limit: 5, handling: 2, base: 3.5, perKg: 4 },
      { id: 'sample-economy', name: '样例经济配送', country: '美国', service: '经济配送', unit: 'kg', currency: 'USD', limit: 3, handling: 3, base: 2.5, perKg: 3 },
      { id: 'sample-priority', name: '样例加急配送', country: '美国', service: '加急配送', unit: 'kg', currency: 'USD', limit: 5, handling: 1, base: 7, perKg: 5 },
    ],
    orders: [
      { id: 'DEMO-ORDER-10001', productId: products[0]!.id, variantId: products[0]!.variants[0]!.id, quantity: 2,
        country: '美国', status: '未发货', warehouseStage: '待分拣', carrier: '', tracking: '' },
      { id: 'DEMO-ORDER-10002', productId: products[3]!.id, variantId: products[3]!.variants[1]!.id, quantity: 1,
        country: '美国', status: '未发货', warehouseStage: '待打包', carrier: '', tracking: '' },
    ],
  }
}

export function inventoryRows(state: State): { product: Product; variant: Variant }[] {
  return state.products.flatMap(product => product.variants.filter(variant => !variant.deleted).map(variant => ({ product, variant })))
}

// An image is local raster bytes, not merely a URL with a permitted extension.
// Reject remote URLs, SVG/HTML, oversized payloads and MIME/signature mismatch
// before a value can reach an <img> src, including when reading stored samples.
export function isSafeImage(value: string): boolean {
  if (typeof value !== 'string') return false
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[2]!.length % 4 !== 0 || match[2]!.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return false
  try {
    const bytes = atob(match[2]!)
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return false
    const code = (index: number) => bytes.charCodeAt(index)
    if (match[1] === 'png') return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => code(index) === byte)
    if (match[1] === 'jpeg') return bytes.length >= 3 && code(0) === 255 && code(1) === 216 && code(2) === 255
    return bytes.length >= 12 && bytes.slice(0, 4) === 'RIFF' && bytes.slice(8, 12) === 'WEBP'
  } catch { return false }
}

const skuKey = (value: string) => value.trim().toLocaleUpperCase('en-US')
const validDate = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value

// These are explicit local sample checks, not a reproduction of platform
// backend validation, category scoring, approval, or publication rules.
export function validateProduct(state: State, product: Product, complete = false): FieldError[] {
  const errors: FieldError[] = []
  const add = (field: string, message: string, tab: EditorTab) => errors.push({ field, message, tab })
  const required = (field: keyof Product, label: string) => {
    if (!String(product[field]).trim()) add(String(field), `完成本地样例前，请填写${label}。`, 'important')
  }
  if (complete) {
    required('title', '商品名称'); required('brand', '品牌'); required('manufacturer', '制造商')
    required('parentSku', '父商品 SKU')
    if (!categories.some(category => category.id === product.categoryId)) add('categoryId', '请选择本地样例类目。', 'important')
    if (!product.variantTheme.trim()) add('variantTheme', '请选择变体主题。', 'variants')
  }
  const existingSkus = new Set<string>()
  const existingVariantIds = new Set<string>()
  for (const existing of state.products) {
    if (existing.id === product.id) continue
    if (existing.parentSku.trim()) existingSkus.add(skuKey(existing.parentSku))
    existing.variants.filter(variant => !variant.deleted && variant.sku.trim()).forEach(variant => existingSkus.add(skuKey(variant.sku)))
    existing.variants.forEach(variant => existingVariantIds.add(variant.id))
  }
  const ownSkus = new Set<string>()
  if (product.parentSku.trim()) {
    const key = skuKey(product.parentSku)
    if (existingSkus.has(key)) add('parentSku', '这个父商品 SKU 已存在于本地样例中，请使用不同 SKU。', 'important')
    ownSkus.add(key)
  }
  const visibleVariants = product.variants.filter(variant => !variant.deleted)
  if (complete && !visibleVariants.length) add('variants', '完成本地样例至少需要一条未删除的变体。', 'variants')
  const rowIds = new Set<string>()
  for (const variant of product.variants) {
    const field = `variants.${variant.id || 'new'}`
    if (variant.id && rowIds.has(variant.id)) add(`${field}.id`, '变体行标识重复，请重新添加该变体。', 'variants')
    if (variant.id && existingVariantIds.has(variant.id)) add(`${field}.id`, '这条变体属于另一个本地商品，请重新添加变体。', 'variants')
    rowIds.add(variant.id)
    if (variant.image && !isSafeImage(variant.image)) add(`${field}.image`, '只允许不超过 1 MB 的本机 PNG、JPEG 或 WebP 图片。', 'variants')
    if (!Number.isFinite(variant.price) || variant.price < 0 || complete && !variant.deleted && variant.price === 0) add(`${field}.price`, complete && !variant.deleted ? '本地样例价格必须大于 0。' : '价格必须是非负数字。', 'variants')
    if (!Number.isInteger(variant.quantity) || variant.quantity < 0) add(`${field}.quantity`, '库存数量必须是非负整数。', 'variants')
    if (!CODE_TYPES.includes(variant.codeType)) add(`${field}.codeType`, '请选择商品编码类型。', 'variants')
    if (!CONDITIONS.includes(variant.condition)) add(`${field}.condition`, '请选择本地样例商品状况。', 'variants')
    if (!['FBM', 'FBA'].includes(variant.delivery)) add(`${field}.delivery`, '请选择 FBM 或 FBA 配送方式。', 'variants')
    if (!['active', 'inactive'].includes(variant.status)) add(`${field}.status`, '请选择有效的本地样例变体状态。', 'variants')
    if (variant.deleted) continue
    if (complete && !variant.sku.trim()) add(`${field}.sku`, '请填写这条变体的卖家 SKU。', 'variants')
    if (complete && !variant.term.trim()) add(`${field}.term`, '请填写这条变体的术语。', 'variants')
    if (complete && !variant.code.trim()) add(`${field}.code`, '请填写本地样例商品编码，不需要真实商品编码。', 'variants')
    if (variant.sku.trim()) {
      const key = skuKey(variant.sku)
      if (existingSkus.has(key) || ownSkus.has(key)) add(`${field}.sku`, '这个卖家 SKU 已存在于本地样例中，请使用不同 SKU。', 'variants')
      ownSkus.add(key)
    }
  }
  if (complete && visibleVariants.some(variant => variant.delivery === 'FBM') && !state.templates.some(template => template.id === product.offer.templateId)) add('offer.templateId', '请为本地 FBM 样例选择已有配送模板。', 'offer')
  if (!Number.isInteger(product.offer.maxOrderQuantity) || product.offer.maxOrderQuantity < 0) add('offer.maxOrderQuantity', '订单最大数量必须是非负整数。', 'offer')
  if (!Number.isInteger(product.offer.handlingTime) || product.offer.handlingTime < 0) add('offer.handlingTime', '处理时间必须是非负整数。', 'offer')
  if (!Number.isFinite(product.offer.manufacturerPrice) || product.offer.manufacturerPrice < 0) add('offer.manufacturerPrice', '建议零售价必须是非负数字。', 'offer')
  for (const field of ['restockDate', 'startSaleDate'] as const) if (!validDate(product.offer[field])) add(`offer.${field}`, '请填写有效日期或留空。', 'offer')
  if (complete && (!product.compliance.itemWeight.trim() || !Number.isFinite(Number(product.compliance.itemWeight)) || Number(product.compliance.itemWeight) <= 0)) add('compliance.itemWeight', '完成本地样例前，请填写大于 0 的商品重量。', 'compliance')
  if (product.compliance.itemWeight.trim() && (!Number.isFinite(Number(product.compliance.itemWeight)) || Number(product.compliance.itemWeight) < 0)) add('compliance.itemWeight', '商品重量必须是非负数字。', 'compliance')
  product.images.forEach((image, index) => { if (!isSafeImage(image)) add(`images.${index}`, '只允许不超过 1 MB 的本机 PNG、JPEG 或 WebP 图片，不接受外部地址。', 'images') })
  if (complete && !product.features.some(feature => feature.trim())) add('features', '请至少填写一条本地样例商品要点。', 'description')
  if (complete && !product.description.trim()) add('description', '请填写本地样例商品描述。', 'description')
  return errors
}

export function saveProduct(state: State, product: Product, complete = false): SaveResult {
  // Saving edits is not an unpublish action. A published product must keep
  // its publication state and pass the same checks as completion.
  const existing = state.products.find(item => item.id === product.id)
  const published = complete || existing?.status === 'active'
  const errors = validateProduct(state, product, published)
  if (errors.length) return { ok: false, errors, id: product.id }
  const saved: Product = JSON.parse(JSON.stringify(product)) as Product
  saved.id ||= createId('product')
  saved.createdAt ||= new Date().toISOString()
  saved.title = saved.title.trim(); saved.brand = saved.brand.trim(); saved.parentSku = saved.parentSku.trim()
  saved.status = published ? 'active' : 'draft'
  saved.variants.forEach(variant => { variant.id ||= createId('variant'); variant.sku = variant.sku.trim() })
  const index = state.products.findIndex(item => item.id === saved.id)
  if (index === -1) state.products.push(saved)
  else { saved.createdAt = state.products[index]!.createdAt; state.products[index] = saved }
  product.id = saved.id
  product.variants.forEach((variant, rowIndex) => { variant.id = saved.variants[rowIndex]!.id })
  return { ok: true, errors: [], id: saved.id }
}

export function readState(storage?: Pick<Storage, 'getItem'> | null): { state: State; temporary: boolean; notice: string } {
  if (!storage) return { state: createSeed(), temporary: true, notice: '浏览器存储不可用：当前为临时本地体验，刷新后不会保留修改。' }
  try {
    const raw = storage.getItem(SIMULATION_STORAGE_KEY)
    if (!raw) return { state: createSeed(), temporary: false, notice: '' }
    const parsed: unknown = JSON.parse(raw)
    if (!validStoredState(parsed)) return { state: createSeed(), temporary: true, notice: '本地样例数据格式或图片不安全，已临时载入初始样例；未删除原存储或旧版本数据。' }
    return { state: parsed, temporary: false, notice: '' }
  } catch { return { state: createSeed(), temporary: true, notice: '浏览器存储读取失败：已进入临时体验，未删除原存储。' } }
}

export function persistState(storage: Pick<Storage, 'setItem'> | null | undefined, state: State): boolean {
  if (!storage || !validStoredState(state)) return false
  try { storage.setItem(SIMULATION_STORAGE_KEY, JSON.stringify(state)); return true } catch { return false }
}

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string') }
function fields(value: Record<string, unknown>, keys: string[], type: 'string' | 'boolean'): boolean { return keys.every(key => typeof value[key] === type) }
function finiteFields(value: Record<string, unknown>, keys: string[]): boolean { return keys.every(key => typeof value[key] === 'number' && Number.isFinite(value[key])) }
function uniqueIds(values: { id: string }[]): boolean { return values.every(value => !!value.id) && new Set(values.map(value => value.id)).size === values.length }
const productStrings = ['id', 'title', 'brand', 'manufacturer', 'partNumber', 'categoryId', 'categoryName', 'parentSku', 'asin', 'variantTheme', 'description', 'createdAt']
const variantStrings = ['id', 'term', 'color', 'size', 'sku', 'code', 'codeType', 'condition', 'conditionNote', 'image']
const complianceStrings = ['itemWeight', 'itemWeightUnit', 'batteryWeight', 'batteryWeightUnit', 'wattHours', 'wattHoursUnit', 'lithiumContent', 'lithiumContentUnit', 'capacity', 'capacityUnit', 'batteryLife', 'batteryLifeUnit', 'batteryVoltage', 'batteryVoltageUnit', 'batteryType', 'batteryCount', 'batteryComposition', 'lithiumPackaging', 'lithiumIonCells', 'lithiumMetalCells', 'unNumber', 'sdsUrl', 'flashPoint', 'proposition65Warning']

function validStoredState(value: unknown): value is State {
  if (!record(value) || value.version !== 2 || !Array.isArray(value.products) || !Array.isArray(value.templates) || !Array.isArray(value.orders)) return false
  for (const product of value.products) {
    if (!record(product) || !fields(product, productStrings, 'string') || !['draft', 'active'].includes(product.status as string)
      || !strings(product.images) || !product.images.every(isSafeImage) || !strings(product.features) || !Array.isArray(product.variants)) return false
    for (const variant of product.variants) {
      if (!record(variant) || !fields(variant, variantStrings, 'string') || typeof variant.deleted !== 'boolean'
        || !finiteFields(variant, ['price', 'quantity']) || (variant.price as number) < 0 || !Number.isInteger(variant.quantity) || (variant.quantity as number) < 0
        || !CODE_TYPES.includes(variant.codeType as string) || !CONDITIONS.includes(variant.condition as string)
        || !['FBM', 'FBA'].includes(variant.delivery as string) || !['active', 'inactive'].includes(variant.status as string)
        || variant.image && !isSafeImage(variant.image as string)) return false
    }
    if (!uniqueIds(product.variants as Variant[])) return false
    const offer = product.offer
    if (!record(offer) || !fields(offer, ['templateId', 'restockDate', 'taxCode', 'startSaleDate'], 'string')
      || !fields(offer, ['giftMessage', 'giftWrap'], 'boolean') || !finiteFields(offer, ['maxOrderQuantity', 'manufacturerPrice', 'handlingTime'])
      || !Number.isInteger(offer.maxOrderQuantity) || (offer.maxOrderQuantity as number) < 0 || !Number.isInteger(offer.handlingTime) || (offer.handlingTime as number) < 0 || (offer.manufacturerPrice as number) < 0) return false
    const compliance = product.compliance
    if (!record(compliance) || !fields(compliance, complianceStrings, 'string') || !fields(compliance, ['batteriesIncluded', 'batteryRequired'], 'boolean')
      || !['hazardousRegulations', 'ghsSymbols', 'chemicalNames'].every(key => strings(compliance[key]))) return false
    if (!record(product.keywords) || !['targetAudience', 'intendedUse', 'otherAttributes', 'subjectMatter', 'searchTerms', 'platinumKeywords'].every(key => strings((product.keywords as Record<string, unknown>)[key]))) return false
    if (!record(product.warnings) || !fields(product.warnings, ['cpsia', 'cpsiaDescription'], 'string')) return false
    if (!record(product.moreDetails) || !Object.values(product.moreDetails).every(item => typeof item === 'string')) return false
  }
  if (!uniqueIds(value.products as Product[]) || !uniqueIds((value.products as Product[]).flatMap(product => product.variants))) return false
  for (const template of value.templates) {
    if (!record(template) || !fields(template, ['id', 'name', 'country', 'service', 'unit', 'currency'], 'string')
      || !finiteFields(template, ['limit', 'handling', 'base', 'perKg']) || (template.limit as number) <= 0
      || !Number.isInteger(template.handling) || (template.handling as number) < 0 || (template.base as number) < 0 || (template.perKg as number) < 0) return false
  }
  if (!uniqueIds(value.templates as ShippingTemplate[])) return false
  for (const order of value.orders) {
    if (!record(order) || !fields(order, ['id', 'productId', 'variantId', 'country', 'carrier', 'tracking'], 'string')
      || !Number.isInteger(order.quantity) || (order.quantity as number) <= 0 || !['未发货', '已发货'].includes(order.status as string)
      || !['待分拣', '待打包', '待出库', '已出库'].includes(order.warehouseStage as string)) return false
    if (order.shippingService !== undefined && typeof order.shippingService !== 'string' || order.shippingDate !== undefined && typeof order.shippingDate !== 'string') return false
    const product = (value.products as Product[]).find(item => item.id === order.productId)
    if (!product?.variants.some(variant => variant.id === order.variantId)) return false
  }
  const state = value as unknown as State
  return uniqueIds(value.orders as Order[])
    && (value.fba === undefined || validFbaData(value.fba, state))
    && (value.advertising === undefined || validAdvertisingData(value.advertising, state))
    && (value.templateData === undefined || validTemplateData(value.templateData, state))
}
