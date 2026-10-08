// This model belongs exclusively to the public, offline simulation. It must
// never import desktop stores, credentials, control-plane APIs or the Runner.
export const SIMULATION_STORAGE_KEY = 'kst-public-simulation:v1'
export type Delivery = 'FBM' | 'FBA'
export interface Product {
  id: string; title: string; brand: string; category: string; sku: string; asin: string
  variant: string; price: number; quantity: number; weight: number; description: string
  templateId: string; delivery: Delivery; battery: boolean; published: boolean
  manufacturer: string; keywords: string
}
export interface ShippingTemplate {
  id: string; name: string; country: string; service: string; unit: string
  limit: number; currency: string; handling: number; base: number; perKg: number
}
export interface Campaign {
  id: string; name: string; productId: string; budget: number; bid: number
  start: string; end: string; targeting: string; status: '投放中' | '已暂停'
}
export type WarehouseStage = '待分拣' | '待打包' | '待出库' | '已出库'
export interface Order {
  id: string; productId: string; quantity: number; country: string
  status: '未发货' | '已发货'; warehouse: WarehouseStage; carrier: string; tracking: string
}
export interface SimulationState {
  version: 1; products: Product[]; templates: ShippingTemplate[]; campaigns: Campaign[]; orders: Order[]
}
export function seedSimulation(): SimulationState {
  return {
    version: 1,
    products: [{ id: 'sample-product', title: '轻量旅行收纳袋 · 样例', brand: 'KST Sample', category: '家居 / 收纳用品', sku: 'SAMPLE-BAG-BLUE', asin: 'SAMPLEASIN01', variant: '蓝色 / M', price: 19.9, quantity: 80, weight: 0.25, description: '仅供本机模拟体验的虚构商品。', templateId: 'sample-template', delivery: 'FBM', battery: false, published: true, manufacturer: 'Sample Studio', keywords: '旅行 收纳' }],
    templates: [{ id: 'sample-template', name: '样例标准配送', country: '美国', service: '标准配送', unit: 'kg', limit: 2, currency: 'USD', handling: 2, base: 3, perKg: 5 }],
    campaigns: [],
    orders: [{ id: 'SAMPLE-ORDER-001', productId: 'sample-product', quantity: 2, country: '美国', status: '未发货', warehouse: '待分拣', carrier: '', tracking: '' }],
  }
}
export function newProduct(): Product {
  return { id: '', title: '', brand: '', category: '家居 / 收纳用品', sku: '', asin: '', variant: '', price: 0, quantity: 0, weight: 0, description: '', templateId: 'sample-template', delivery: 'FBM', battery: false, published: false, manufacturer: '', keywords: '' }
}
export function validateProduct(state: SimulationState, product: Product): string {
  if (!product.title.trim() || !product.brand.trim() || !product.sku.trim()) return '请填写商品名称、品牌和卖家 SKU。'
  if (!product.variant.trim()) return '请在变体页填写颜色 / 尺寸。'
  if (!Number.isFinite(product.price) || product.price <= 0 || !Number.isInteger(product.quantity) || product.quantity < 1) return '价格必须大于 0，库存数量必须是正整数。'
  if (!Number.isFinite(product.weight) || product.weight <= 0) return '请填写大于 0 的商品重量。'
  if (!state.templates.some(template => template.id === product.templateId)) return '请选择已有配送模板。'
  if (state.products.some(item => item.sku === product.sku.trim() && item.id !== product.id)) return '这个卖家 SKU 已存在，请更换 SKU。'
  return ''
}
export function saveProduct(state: SimulationState, product: Product, id: string): string {
  const error = validateProduct(state, product)
  if (error) return error
  const saved: Product = { ...product, id: product.id || id, title: product.title.trim(), brand: product.brand.trim(), sku: product.sku.trim(), asin: product.asin || `SAMPLE-${id}`, published: true }
  const index = state.products.findIndex(item => item.id === saved.id)
  if (index < 0) state.products.push(saved)
  else state.products[index] = saved
  return ''
}
export function saveTemplate(state: SimulationState, template: ShippingTemplate, id: string): string {
  if (!template.name.trim()) return '请填写模板名称。'
  if (![template.limit, template.base, template.perKg, template.handling].every(Number.isFinite) || template.limit <= 0 || template.base < 0 || template.perKg < 0 || !Number.isInteger(template.handling) || template.handling < 0) return '请填写有效限重、运费和整数处理时间。'
  if (state.templates.some(item => item.name === template.name.trim() && item.id !== template.id)) return '模板名称已存在，请更换名称。'
  const saved = { ...template, id: template.id || id, name: template.name.trim() }
  const index = state.templates.findIndex(item => item.id === saved.id)
  if (index < 0) state.templates.push(saved)
  else state.templates[index] = saved
  return ''
}
export function convertFba(state: SimulationState, productId: string, confirmed: boolean, battery: boolean): string {
  const product = state.products.find(item => item.id === productId)
  if (!product?.published) return '请选择已发布的样例商品。'
  if (!confirmed) return '请确认危险品信息后再转换配送方式。'
  if (battery) return '本体验暂不支持含电池商品的 FBA 转换，请使用无电池样例。'
  if (product.delivery === 'FBA') return '这个商品已经使用亚马逊配送。'
  product.delivery = 'FBA'
  product.battery = battery
  return ''
}
export function saveCampaign(state: SimulationState, campaign: Campaign, id: string): string {
  if (!campaign.name.trim()) return '请填写广告活动名称。'
  const product = state.products.find(item => item.id === campaign.productId)
  if (!product?.published || product.delivery !== 'FBA') return '请选择已转换为亚马逊配送的样例商品。'
  if (!Number.isFinite(campaign.budget) || campaign.budget <= 0 || !Number.isFinite(campaign.bid) || campaign.bid <= 0) return '预算和竞价必须大于 0。'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(campaign.start) || !/^\d{4}-\d{2}-\d{2}$/.test(campaign.end) || !Number.isFinite(Date.parse(campaign.start)) || !Number.isFinite(Date.parse(campaign.end)) || campaign.end < campaign.start) return '结束日期不能早于开始日期。'
  if (state.campaigns.some(item => item.name === campaign.name.trim() && item.id !== campaign.id)) return '广告名称已存在，请更换名称。'
  state.campaigns.push({ ...campaign, id, name: campaign.name.trim() })
  return ''
}
export function warehouseAction(state: SimulationState, orderId: string, action: 'pick' | 'pack' | 'dispatch', carrier = ''): string {
  const order = state.orders.find(item => item.id === orderId)
  if (!order || order.status === '已发货') return '该订单无法继续仓库操作。'
  if (action === 'pick' && order.warehouse === '待分拣') order.warehouse = '待打包'
  else if (action === 'pack' && order.warehouse === '待打包') order.warehouse = '待出库'
  else if (action === 'dispatch' && order.warehouse === '待出库') {
    if (!carrier) return '请选择承运人。'
    const product = state.products.find(item => item.id === order.productId)
    if (!product || product.quantity < order.quantity) return '样例库存不足，不能出库。'
    product.quantity -= order.quantity
    order.warehouse = '已出库'; order.carrier = carrier; order.tracking = `SAMPLE-TRACK-${order.id.split('-').at(-1)}`
  } else return '当前仓库状态不允许这项操作。'
  return ''
}
export function confirmShipment(state: SimulationState, orderId: string, carrier: string, tracking: string): string {
  const order = state.orders.find(item => item.id === orderId)
  if (!order || order.status === '已发货') return '该订单已完成或不存在，不能重复确认。'
  if (order.warehouse !== '已出库') return '请先在国内仓库完成分拣、打包和出库，再回填运单。'
  if (!carrier || carrier !== order.carrier || tracking !== order.tracking) return '承运人和运单号必须与本订单的仓库发货记录一致。'
  order.status = '已发货'
  return ''
}
export function readSimulation(storage?: Pick<Storage, 'getItem'>): { state: SimulationState; temporary: boolean } {
  try {
    const raw = storage?.getItem(SIMULATION_STORAGE_KEY)
    if (!raw) return { state: seedSimulation(), temporary: !storage }
    const parsed: unknown = JSON.parse(raw)
    if (!validStoredState(parsed)) return { state: seedSimulation(), temporary: true }
    return { state: parsed, temporary: false }
  } catch { return { state: seedSimulation(), temporary: true } }
}
function validStoredState(value: unknown): value is SimulationState {
  if (!value || typeof value !== 'object') return false
  const s = value as SimulationState
  return s.version === 1 && Array.isArray(s.products) && Array.isArray(s.templates) && Array.isArray(s.campaigns) && Array.isArray(s.orders)
    && s.products.every(p => p && [p.id, p.title, p.brand, p.category, p.sku, p.asin, p.variant, p.description, p.templateId, p.manufacturer, p.keywords].every(v => typeof v === 'string') && ['FBM', 'FBA'].includes(p.delivery) && [p.price, p.quantity, p.weight].every(Number.isFinite) && typeof p.battery === 'boolean' && typeof p.published === 'boolean')
    && s.templates.every(t => t && [t.id, t.name, t.country, t.service, t.unit, t.currency].every(v => typeof v === 'string') && [t.limit, t.handling, t.base, t.perKg].every(Number.isFinite))
    && s.campaigns.every(c => c && [c.id, c.name, c.productId, c.start, c.end, c.targeting].every(v => typeof v === 'string') && [c.budget, c.bid].every(Number.isFinite) && ['投放中', '已暂停'].includes(c.status))
    && s.orders.every(o => o && [o.id, o.productId, o.country, o.carrier, o.tracking].every(v => typeof v === 'string') && Number.isInteger(o.quantity) && o.quantity > 0 && ['未发货', '已发货'].includes(o.status) && ['待分拣', '待打包', '待出库', '已出库'].includes(o.warehouse))
}
