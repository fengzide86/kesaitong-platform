<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import V2CourseMap from './V2CourseMap.vue'
import V2ProductEditor from './V2ProductEditor.vue'
import V2ProductImage from './V2ProductImage.vue'
import V2PortalScene from './V2PortalScene.vue'
import { categories, createSeed, inventoryRows, newProduct, persistState, readState, saveProduct, SIMULATION_STORAGE_KEY, type FieldError, type Order, type Product, type Variant } from './model'

type Page = 'course' | 'seller' | 'inventory' | 'category' | 'product' | 'orders' | 'shipment' | 'warehouse'
const router = useRouter(), route = useRoute()
let storage: Storage | undefined
try { storage = window.localStorage } catch { /* Local samples remain usable without storage. */ }
const initial = readState(storage)
const state = reactive(initial.state), temporary = ref(initial.temporary)
const root = ref<HTMLElement>(), editor = ref<InstanceType<typeof V2ProductEditor>>()
const page = ref<Page>('course'), draft = ref<Product>(newProduct()), errors = ref<FieldError[]>([])
const message = ref(initial.notice), failed = ref(false), portalOpen = ref(false), boundary = ref(''), resetOpen = ref(false)
const menu = ref(''), toolsOpen = ref(false), expanded = ref<string[]>([]), selected = ref<string[]>([])
const queryInput = ref(''), query = ref(''), categorySearch = ref('')
const statusFilter = ref('all'), deliveryFilter = ref('all'), minPrice = ref(''), maxPrice = ref('')
const inventoryTab = ref('all'), bulkAction = ref(''), currentPage = ref(1), pageSize = ref(10)
const warehouseStage = ref('待分拣'), selectedOrder = ref(''), carrier = ref(''), shipmentCarrier = ref(''), tracking = ref('')
const running = ref(false), paused = ref(false), runStatus = ref('就绪'), runTask = ref('product'), currentStep = ref(''), steps = ref<string[]>([]), cursor = ref(0)
let generation = 0
const knownPages: Page[] = ['course', 'seller', 'inventory', 'category', 'product', 'orders', 'shipment', 'warehouse']
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
function loadRoute() {
  const target = String(route.query.page || 'course')
  page.value = knownPages.includes(target as Page) ? target as Page : 'course'
  if (page.value === 'product') {
    const existing = state.products.find(product => product.id === route.query.product)
    if (existing) draft.value = copy(existing)
    else if (draft.value.id !== route.query.product) draft.value = newProduct(String(route.query.category || 'home-storage'))
  }
  if (page.value === 'shipment') selectedOrder.value = String(route.query.order || state.orders[0]?.id || '')
  menu.value = ''
}
watch(() => route.fullPath, loadRoute, { immediate: true })
function navigate(target: Page, params: Record<string, string> = {}) { message.value = ''; failed.value = false; menu.value = ''; void router.push({ path: '/demo', query: { page: target, ...params } }) }
function persist() { temporary.value = !persistState(storage, state) }
function result(text: string, error = false) { message.value = text; failed.value = error }
function courseOpen(area: string) {
  if (area === 'amazon') portalOpen.value = true
  else if (area === 'warehouse') navigate('warehouse')
  else boundary.value = area === 'grades' ? '成绩与评分不在本轮本地样板范围，模拟体验不会改变真实成绩。' : '这个入口保留原平台的位置。本轮交付课程地图、库存、商品编辑和国内仓库样板；此分支尚未复现，不会跳到假页面。'
}
function enterSeller(newTab = false) {
  portalOpen.value = false
  if (newTab) window.open(router.resolve({ path: '/demo', query: { page: 'seller' } }).href, '_blank', 'noopener,noreferrer')
  else navigate('seller')
}
function openProduct(product?: Product) { errors.value = []; draft.value = product ? copy(product) : newProduct(); navigate('product', { product: draft.value.id, category: draft.value.categoryId }) }
function chooseCategory(id: string) { draft.value = newProduct(id); errors.value = []; navigate('product', { product: draft.value.id, category: id }) }
function saveEdited(product: Product, complete: boolean) {
  const saved = saveProduct(state, product, complete)
  errors.value = saved.errors
  if (!saved.ok) { result('请检查标记的字段。本地样例尚未完成。', true); return }
  const readback = state.products.find(item => item.id === saved.id)!
  draft.value = copy(readback); persist()
  if (complete) {
    query.value = ''; queryInput.value = ''; statusFilter.value = 'all'; deliveryFilter.value = 'all'; currentPage.value = 1
    expanded.value = [saved.id]; navigate('inventory'); result('商品已保存并完成。可在列表中展开并核对子 SKU。')
  } else result('已保存为本地草稿，仍停留在编辑页；尚未完成发布。')
}
const categoryMatches = computed(() => categories.filter(category => `${category.name} ${category.path}`.includes(categorySearch.value.trim())))
const visibleGroups = computed(() => state.products.map(product => ({ product, variants: product.variants.filter(variant => {
  if (variant.deleted) return false
  const active = product.status === 'active' && variant.status === 'active'
  if (statusFilter.value === 'active' && !active || statusFilter.value === 'inactive' && active) return false
  if (inventoryTab.value === 'draft' && product.status !== 'draft') return false
  if (deliveryFilter.value !== 'all' && variant.delivery !== deliveryFilter.value) return false
  if (minPrice.value && variant.price < Number(minPrice.value) || maxPrice.value && variant.price > Number(maxPrice.value)) return false
  return `${product.title} ${product.parentSku} ${product.asin} ${variant.sku} ${variant.code}`.toLowerCase().includes(query.value.toLowerCase().trim())
}) })).filter(group => group.variants.length))
const pageCount = computed(() => Math.max(1, Math.ceil(visibleGroups.value.length / pageSize.value)))
watch(pageCount, total => { currentPage.value = Math.min(currentPage.value, total) })
const pagedGroups = computed(() => visibleGroups.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))
watch([query, statusFilter, deliveryFilter, minPrice, maxPrice, inventoryTab, pageSize], () => { currentPage.value = 1; selected.value = [] })
const visibleVariantIds = computed(() => pagedGroups.value.flatMap(group => group.variants.map(variant => variant.id)))
const allSelected = computed(() => visibleVariantIds.value.length > 0 && visibleVariantIds.value.every(id => selected.value.includes(id)))
function selectAll(checked: boolean) { selected.value = checked ? [...visibleVariantIds.value] : [] }
function toggleGroup(id: string) { expanded.value = expanded.value.includes(id) ? expanded.value.filter(item => item !== id) : [...expanded.value, id] }
function activateTab(tab: string) {
  if (tab === 'pricing' || tab === 'shipments') { boundary.value = '此标签保留原平台位置，定价与 FBA 货件深层流程待下一阶段逐页复现。当前不会生成假货件或真实计费。'; return }
  inventoryTab.value = tab; deliveryFilter.value = tab === 'fba' ? 'FBA' : 'all'
}
function applyBulk() {
  if (!selected.value.length || !bulkAction.value) { result('请先勾选子 SKU 并选择批量操作。', true); return }
  if (bulkAction.value === 'FBA') { boundary.value = 'FBA 转换有独立确认和危险品步骤。本轮不以一个批量按钮代替它；已配置的 FBA 样例可通过筛选查看。'; return }
  for (const { variant } of inventoryRows(state)) if (selected.value.includes(variant.id)) {
    if (bulkAction.value === 'FBM') variant.delivery = 'FBM'
    if (bulkAction.value === 'inactive') variant.status = 'inactive'
    if (bulkAction.value === 'active') variant.status = 'active'
  }
  persist(); result(`已更新 ${selected.value.length} 条本地子 SKU，其他变体没有改变。`)
}
function updateInline(variant: Variant, key: 'quantity' | 'price', event: Event) {
  const input = event.target as HTMLInputElement, value = Number(input.value)
  if (value < 0 || !Number.isFinite(value) || key === 'quantity' && !Number.isInteger(value)) { input.value = String(variant[key]); result('请输入有效的非负数字；数量必须是整数。', true); return }
  variant[key] = value; persist(); result(`${variant.sku} 的${key === 'quantity' ? '可售数量' : '价格'}已保存。`)
}
function rowAction(product: Product, variant: Variant, event: Event) {
  const action = (event.target as HTMLSelectElement).value; (event.target as HTMLSelectElement).value = ''
  if (action === 'edit') openProduct(product)
  else if (action === 'inactive' || action === 'active') { variant.status = action; persist(); result(`${variant.sku} 已${action === 'active' ? '出售' : '停售'}。`) }
  else if (action) boundary.value = '此独立流程不在首轮样板内。这里不会以假提交替代原平台的多步操作。'
}
const menus = [
  { name: '目录', items: ['添加商品', '补全您的草稿'] },
  { name: '库存', items: ['管理库存', '管理亚马逊库存', '改进商品信息质量', '库存规划', '添加新商品', '库存报告', '全球销售', '管理亚马逊货件', '上传图片', '上传和管理视频', '管理商品文档'] },
  { name: '确定价格', items: ['管理定价', '修复价格警告', '自动定价', '协议定价'] },
  { name: '订单', items: ['管理订单', '订单报告', '上传订单相关文件', '管理退货', '管理 SAFE-T 索赔'] },
  { name: '广告', items: ['广告活动管理', 'A+ 页面', '早期评论者计划', '秒杀', '优惠券', 'Prime 专享折扣', '管理促销'] },
  { name: '品牌旗舰店', items: ['管理店铺'] }, { name: '增长', items: ['配送计划', '推荐计划'] },
  { name: '数据报告', items: ['付款', '亚马逊销售指导', '业务报告', '库存和销售报告', '广告', '退货报告', '自定义报告', '税务文件库'] },
  { name: '绩效', items: ['账户状况', '反馈', '亚马逊商城交易保障索赔', '信用卡拒付索赔', '业绩通知', '买家之声', '卖家大学'] },
  { name: '应用商店', items: ['官方移动应用', '发现应用', '管理您的应用', '探索服务'] },
]
const excluded = new Set(['改进商品信息质量', '库存报告', '全球销售', '上传和管理视频', '管理商品文档', '订单报告', '上传订单相关文件', '管理退货', '管理 SAFE-T 索赔', '早期评论者计划', '管理店铺', '配送计划', '推荐计划', '付款', '亚马逊销售指导', '业务报告', '库存和销售报告', '广告', '退货报告', '自定义报告', '税务文件库', '账户状况', '反馈', '亚马逊商城交易保障索赔', '信用卡拒付索赔', '业绩通知', '买家之声', '卖家大学', '官方移动应用', '发现应用', '管理您的应用', '探索服务', '修复价格警告', '自动定价', '协议定价'])
function menuAction(item: string) {
  menu.value = ''
  if (item === '管理库存') { inventoryTab.value = 'all'; deliveryFilter.value = 'all'; navigate('inventory') }
  else if (item === '管理亚马逊库存') { inventoryTab.value = 'fba'; deliveryFilter.value = 'FBA'; navigate('inventory') }
  else if (item === '补全您的草稿') { inventoryTab.value = 'draft'; deliveryFilter.value = 'all'; statusFilter.value = 'all'; navigate('inventory') }
  else if (item === '添加商品' || item === '添加新商品') navigate('category')
  else if (item === '管理订单') navigate('orders')
  else boundary.value = '该分支尚未纳入首轮高还原样板，保留入口供后续按原平台扩展。'
}
const order = computed(() => state.orders.find(item => item.id === selectedOrder.value))
const warehouseOrders = computed(() => state.orders.filter(item => item.warehouseStage === warehouseStage.value))
const orderProduct = (item: Order) => state.products.find(product => product.id === item.productId)
const orderVariant = (item: Order) => orderProduct(item)?.variants.find(variant => variant.id === item.variantId)
function openShipment(item: Order) { selectedOrder.value = item.id; shipmentCarrier.value = item.carrier; tracking.value = item.tracking; navigate('shipment', { order: item.id }) }
function warehouseAction(item: Order) {
  if (item.status === '已发货') { result('该订单已经完成。', true); return }
  if (item.warehouseStage === '待分拣') item.warehouseStage = '待打包'
  else if (item.warehouseStage === '待打包') item.warehouseStage = '待出库'
  else if (item.warehouseStage === '待出库') {
    if (!carrier.value) { result('请先选择承运人。', true); return }
    const variant = orderVariant(item)
    if (!variant || variant.quantity < item.quantity) { result('库存不足，本地样例未出库。', true); return }
    variant.quantity -= item.quantity; item.warehouseStage = '已出库'; item.carrier = carrier.value; item.tracking = `DEMO-PARCEL-${item.id.slice(-5)}`
  } else { result('该订单已有发货记录，不重复出库。', true); return }
  persist(); result(`${item.id} 已转入${item.warehouseStage}。`)
}
function confirmShipment() {
  const item = order.value
  if (!item || item.status === '已发货') { result('该订单已完成或不存在。', true); return }
  if (item.warehouseStage !== '已出库' || !tracking.value || tracking.value !== item.tracking || shipmentCarrier.value !== item.carrier) { result('请先完成国内仓库发货，再填入同一订单的承运人和运单号。', true); return }
  item.status = '已发货'; persist(); navigate('orders'); result(`${item.id} 已确认发货。`)
}
function stop() { generation++; running.value = false; paused.value = false; runStatus.value = '已停止，已保存的样例变化保留' }
function resetSamples() {
  stop(); Object.assign(state, createSeed()); try { storage?.removeItem(SIMULATION_STORAGE_KEY) } catch { temporary.value = true }
  resetOpen.value = false; expanded.value = []; selected.value = []; errors.value = []; steps.value = []; cursor.value = 0; currentStep.value = ''; navigate('course'); runStatus.value = '就绪'; persist()
}
async function settle() { await nextTick(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())) }
function node<T extends HTMLElement>(selector: string): T { const found = root.value?.querySelector<T>(selector); if (!found) throw new Error('当前页面没有找到操作位置，样例操作已停止。'); return found }
function click(selector: string) { const control = node<HTMLButtonElement>(selector); control.scrollIntoView({ block: 'center', behavior: 'instant' }); control.focus(); control.click() }
function fill(name: string, value: string) { const control = node<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`); control.scrollIntoView({ block: 'center', behavior: 'instant' }); control.focus(); control.value = value; control.dispatchEvent(new Event('input', { bubbles: true })); control.dispatchEvent(new Event('change', { bubbles: true })) }
async function automatic() {
  if (running.value) return
  const run = ++generation; running.value = true; paused.value = false; runStatus.value = '正在操作'; toolsOpen.value = false; message.value = ''; failed.value = false; errors.value = []
  const sku = `KST-${Date.now().toString(36).toUpperCase()}`
  let taskSteps: { label: string; perform: () => void | Promise<void> }[]
  if (runTask.value === 'product') taskSteps = [
    { label: '打开课程地图中的 Amazon 入口', perform: async () => { navigate('course'); await settle(); click('[data-area="amazon"]') } },
    { label: '进入亚马逊卖家后台', perform: () => click('[data-action="enter-seller"]') },
    { label: '从目录菜单打开添加商品', perform: async () => { click('[data-action="menu-目录"]'); await settle(); click('[data-action="menu-item-添加商品"]') } },
    { label: '搜索并选择商品类目', perform: async () => { fill('categorySearch', '收纳袋'); await settle(); click('[data-category="home-storage"]') } },
    { label: '填写重要信息与父 SKU', perform: () => { fill('title', '轻旅便携旅行收纳袋'); fill('brand', '旅序'); fill('manufacturer', '旅序用品工作室（虚构）'); fill('partNumber', 'TR-2026'); fill('parentSku', `${sku}-PARENT`) } },
    { label: '添加两个变体', perform: async () => { click('[data-action="tab-variants"]'); await settle(); fill('variantTerms', '海蓝色 / M, 墨绿色 / L'); click('[data-action="add-variants"]') } },
    { label: '填写每个子 SKU 的价格与数量', perform: () => { fill('variantSku-0', `${sku}-BLUE`); fill('variantCode-0', `DEMO${sku}01`); fill('variantPrice-0', '19.9'); fill('variantQuantity-0', '50'); fill('variantSku-1', `${sku}-GREEN`); fill('variantCode-1', `DEMO${sku}02`); fill('variantPrice-1', '21.9'); fill('variantQuantity-1', '30') } },
    { label: '选择配送设置', perform: async () => { click('[data-action="tab-offer"]'); await settle(); fill('templateId', state.templates[0]!.id) } },
    { label: '填写商品重量', perform: async () => { click('[data-action="tab-compliance"]'); await settle(); fill('weight', '0.25') } },
    { label: '填写描述与搜索关键字', perform: async () => { click('[data-action="tab-description"]'); await settle(); fill('feature-0', '轻量折叠，分区收纳'); fill('description', '轻量折叠设计，两种颜色与尺寸。此商品用于本机样例操作。'); click('[data-action="tab-keywords"]'); await settle(); fill('searchTerms-0', '旅行 收纳袋 便携') } },
    { label: '保存并完成', perform: () => click('[data-action="save-product-complete"]') },
    { label: '在库存中核对两个子 SKU', perform: () => { const saved = state.products.find(product => product.parentSku === `${sku}-PARENT`); if (!saved || saved.status !== 'active' || saved.variants.filter(variant => !variant.deleted).length !== 2 || !root.value?.textContent?.includes(`${sku}-GREEN`)) throw new Error(message.value || '库存未回读到两个子 SKU。') } },
  ]
  else {
    const item = state.orders.find(item => item.status === '未发货')
    if (!item) { result('当前没有未发货样例订单，可重置样例。', true); running.value = false; runStatus.value = '未完成'; return }
    taskSteps = [
      { label: '先从管理订单打开确认发货页', perform: async () => { navigate('orders'); await settle(); click(`[data-order-ship="${item.id}"]`) } },
      { label: '前往国内仓库', perform: () => click('[data-action="go-warehouse"]') },
      ...(['待分拣', '待打包', '待出库'] as const).filter(stage => item.warehouseStage !== '已出库' && ['待分拣', '待打包', '待出库'].indexOf(stage) >= ['待分拣', '待打包', '待出库'].indexOf(item.warehouseStage)).map(stage => ({ label: `${stage === '待分拣' ? '分拣' : stage === '待打包' ? '打包' : '选择承运人并发货'}本订单`, perform: async () => { click(`[data-stage="${stage}"]`); await settle(); if (stage === '待出库') fill('carrier', '中邮'); click(`[data-warehouse-order="${item.id}"]`) } })),
      { label: '查看发货记录取得运单', perform: async () => { click('[data-stage="已出库"]'); await settle(); if (!node<HTMLElement>(`[data-tracking="${item.id}"]`).textContent?.includes(item.tracking)) throw new Error('本地发货记录未回读。') } },
      { label: '回到原订单填写运单并确认', perform: async () => { click('[data-action="return-shipment"]'); await settle(); fill('shipmentCarrier', item.carrier); fill('tracking', item.tracking); click('[data-action="confirm-shipment"]') } },
      { label: '核对同一订单已发货', perform: () => { if (item.status !== '已发货') throw new Error('订单仍未完成。') } },
    ]
  }
  steps.value = taskSteps.map(step => step.label); cursor.value = 0
  try {
    for (let index = 0; index < taskSteps.length; index++) {
      while (paused.value && run === generation) await new Promise(resolve => setTimeout(resolve, 100))
      if (run !== generation) return
      currentStep.value = taskSteps[index]!.label; cursor.value = index; await taskSteps[index]!.perform(); await settle()
      if (failed.value || errors.value.length) throw new Error(message.value || '字段校验没有通过。')
      await new Promise(resolve => setTimeout(resolve, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 150 : 650))
    }
    if (run === generation) { running.value = false; runStatus.value = '已完成，保存状态核对通过'; cursor.value = taskSteps.length }
  } catch (error) { if (run === generation) { running.value = false; runStatus.value = '未完成'; result(error instanceof Error ? error.message : '样例操作未完成。', true) } }
}
let dialogReturnFocus: HTMLElement | null = null
const modalVisible = computed(() => portalOpen.value || !!boundary.value || resetOpen.value)
watch([portalOpen, boundary, resetOpen], async () => {
  if (modalVisible.value) {
    if (!dialogReturnFocus && document.activeElement instanceof HTMLElement) dialogReturnFocus = document.activeElement
    await nextTick()
    const dialogs = root.value?.querySelectorAll<HTMLElement>('[role="dialog"]')
    dialogs?.[dialogs.length - 1]?.querySelector<HTMLElement>('button, input, select, a[href]')?.focus()
  } else { dialogReturnFocus?.focus(); dialogReturnFocus = null }
})
function dialogKeyboard(event: KeyboardEvent) {
  if (!modalVisible.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    if (boundary.value || resetOpen.value) { boundary.value = ''; resetOpen.value = false }
    else portalOpen.value = false
    return
  }
  if (event.key !== 'Tab') return
  const dialogs = root.value?.querySelectorAll<HTMLElement>('[role="dialog"]')
  const controls = dialogs?.[dialogs.length - 1]?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')
  if (!controls?.length) return
  const first = controls[0]!, last = controls[controls.length - 1]!
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
function dismissMenu(event: MouseEvent) { if (!(event.target instanceof Element) || !event.target.closest('.v2-nav-entry')) menu.value = '' }
onBeforeUnmount(() => { generation++ })
</script>

<template>
  <div class="v2-experience" ref="root" data-testid="simulation" @keydown="dialogKeyboard" @click="dismissMenu">
    <div class="v2-experience-strip"><span><b>独立模拟</b> 亚马逊 V2 页面样板 · {{ temporary ? '临时体验，刷新可能不保留' : '只使用本机样例数据' }}</span><div><button @click="navigate('course')" data-action="go-course">课程地图</button><button @click="toolsOpen = !toolsOpen" :aria-expanded="toolsOpen" data-action="open-tools">课赛通工具</button><button @click="resetOpen = true">重置样例</button><RouterLink to="/">返回官网 ↗</RouterLink></div></div>
    <V2CourseMap v-if="page === 'course'" :published-count="state.products.filter(p => p.status === 'active').length" :order-count="state.orders.filter(o => o.status === '已发货').length" @open="courseOpen" />
    <template v-else-if="page !== 'warehouse'">
      <header class="v2-seller-header"><button class="v2-seller-logo" @click="navigate('seller')">seller <b>central</b><small>美国站 ▾</small></button><form class="v2-header-search" @submit.prevent="query = queryInput; navigate('inventory')"><input aria-label="搜索商品或 SKU" v-model="queryInput" placeholder="搜索" /><button aria-label="搜索商品">⌕</button></form><span class="v2-company-label">旅序用品工作室 <small>美国 ▾</small></span><div class="v2-quick-nav"><button @click="boundary = '买家消息不在本轮样板内。'">买家消息</button><button @click="boundary = '本轮可从课程地图进入卖家后台、管理库存和国内仓库。'">帮助</button><button @click="boundary = '账户与授权设置不使用真实数据，也不会收集账号密码。'">设置 ▾</button></div></header>
      <nav class="v2-seller-nav" aria-label="卖家后台主导航" @keydown.esc="menu = ''"><div v-for="entry in menus" :key="entry.name" class="v2-nav-entry" @mouseenter="menu = entry.name" @mouseleave="menu = ''"><button :data-action="`menu-${entry.name}`" :aria-expanded="menu === entry.name" @click="menu = entry.name">{{ entry.name }}</button><div v-if="menu === entry.name" class="v2-nav-menu"><button v-for="item in entry.items" :key="item" :data-action="`menu-item-${item}`" :disabled="excluded.has(item)" :title="excluded.has(item) ? '已明确排除，本轮不展开' : ''" @click="menuAction(item)">{{ item }}</button></div></div></nav>
      <main class="v2-seller-content">
        <div v-if="message" class="v2-message" :class="{error: failed}" role="status" data-testid="form-result">{{ message }}</div>
        <template v-if="page === 'seller'">
          <div class="v2-dashboard-heading"><h1>卖家中心</h1><span>欢迎，旅序用品工作室</span></div>
          <div class="v2-dashboard"><section><h2>您的订单</h2><div><b>{{ state.orders.filter(o => o.status === '未发货').length }}</b> 待处理订单</div><button class="v2-link" @click="navigate('orders')">查看管理订单</button></section><section><h2>管理商品</h2><p>{{ state.products.filter(p => p.status === 'active').length }} 个在售父商品 · {{ inventoryRows(state).length }} 个子 SKU</p><button class="v2-link" data-action="nav-inventory" @click="navigate('inventory')">管理库存</button><button class="v2-link" @click="navigate('category')">添加商品</button></section><section><h2>存款方式</h2><p>此处为独立本地样例，未连接支付、结算或真实账户。</p><span class="v2-muted">没有真实资金变动</span></section></div>
          <section class="v2-dashboard-notice"><h2>本轮可验收的操作</h2><p>从目录选择类目，编辑八个商品分页和多行变体，保存后在库存展开核对子 SKU。订单可经过国内仓库分拣、打包、发货，再回填运单。</p><button class="v2-button" @click="navigate('inventory')">进入管理库存</button></section>
        </template>
        <template v-else-if="page === 'inventory'">
          <nav class="v2-inventory-tabs" aria-label="库存标签"><button :class="{active:inventoryTab === 'all'}" @click="activateTab('all')">所有库存</button><button @click="activateTab('pricing')">管理定价</button><button :class="{active:inventoryTab === 'fba'}" @click="activateTab('fba')">亚马逊库存</button><button @click="activateTab('shipments')">货件处理进度</button><button v-if="inventoryTab === 'draft'" class="active">草稿</button></nav>
          <div class="v2-inventory-heading"><h1>{{ inventoryTab === 'fba' ? '管理亚马逊库存' : inventoryTab === 'draft' ? '补全您的草稿' : '管理库存' }}</h1><div><button class="v2-button" @click="selected.length ? openProduct(state.products.find(p => p.variants.some(v => selected.includes(v.id)))) : boundary = '先勾选一个商品的子 SKU，再进入编辑页添加变体。'">添加一个商品变体</button><button class="v2-button" data-action="new-product" @click="navigate('category')">添加新商品</button></div></div>
          <form class="v2-inventory-tools" @submit.prevent="query = queryInput"><select aria-label="批量操作" v-model="bulkAction"><option value="">应用于 {{ selected.length }} 件选定商品</option><option value="FBA">转换为亚马逊配送</option><option value="FBM">转换为卖家自行配送</option><option value="inactive">停售</option><option value="active">出售</option></select><button class="v2-button" type="button" @click="applyBulk">应用</button><input type="search" name="inventorySearch" aria-label="搜索 SKU、标题、ISBN、ASIN" placeholder="搜索 SKU、标题、ISBN、ASIN" v-model="queryInput" /><button class="v2-button v2-dark" type="submit">搜索</button><span>{{ visibleGroups.length }} 件商品</span><button v-if="query" class="v2-link" type="button" @click="query = ''; queryInput = ''">清除搜索</button></form>
          <div class="v2-filter-bar"><span class="v2-muted">筛选条件：</span><fieldset><legend>商品状态：</legend><label><input type="radio" v-model="statusFilter" value="all" />所有</label><label><input type="radio" v-model="statusFilter" value="active" />在售</label><label><input type="radio" v-model="statusFilter" value="inactive" />不可售</label></fieldset><fieldset><legend>配送类型：</legend><label><input type="radio" v-model="deliveryFilter" value="all" />所有</label><label><input type="radio" v-model="deliveryFilter" value="FBA" />亚马逊</label><label><input type="radio" v-model="deliveryFilter" value="FBM" />卖家</label></fieldset><label>价格高于：$ <input class="v2-price-filter" type="number" min="0" v-model="minPrice" aria-label="价格高于" placeholder="0.00" /></label><label>价格低于：$ <input class="v2-price-filter" type="number" min="0" v-model="maxPrice" aria-label="价格低于" placeholder="0.00" /></label></div>
          <div class="v2-table-scroll" aria-label="库存表格可横向滚动"><table class="v2-inventory-table"><thead><tr><th><input type="checkbox" aria-label="选择当前页全部子 SKU" :checked="allSelected" @change="selectAll(($event.target as HTMLInputElement).checked)" /></th><th>状态</th><th>图片</th><th>SKU &amp; 状况</th><th>商品名称 &amp; ASIN/UPC</th><th>创建日期 &amp; 更新时间</th><th v-if="inventoryTab === 'fba'">FNSKU</th><th>可售</th><th>费用预览</th><th>价格 + 运费</th><th>操作</th></tr></thead><tbody><template v-for="group in pagedGroups" :key="group.product.id"><tr class="v2-parent-row" :data-parent="group.product.id"><td><button :aria-label="`${expanded.includes(group.product.id) ? '收起' : '展开'} ${group.product.title} 的变体`" :aria-expanded="expanded.includes(group.product.id)" class="v2-expand" @click="toggleGroup(group.product.id)">{{ expanded.includes(group.product.id) ? '▾' : '▸' }}</button></td><td><span :class="group.product.status === 'active' ? 'v2-active' : 'v2-muted'">{{ group.product.status === 'active' ? '在售' : '草稿' }}</span></td><td><V2ProductImage :title="group.product.title" :image="group.product.images[0]" /></td><td><button class="v2-link" @click="openProduct(group.product)">{{ group.product.parentSku }}</button><small>父项 · {{ group.variants.length }} 个变体</small></td><td><button class="v2-link v2-title-link" @click="openProduct(group.product)">{{ group.product.title }}</button><small>{{ group.product.asin || '尚未生成本地编码' }}</small><button class="v2-link" @click="toggleGroup(group.product.id)">{{ expanded.includes(group.product.id) ? '收起变体' : '查看变体' }}</button></td><td>{{ group.product.createdAt.slice(0,10) }}<small>本机样例</small></td><td v-if="inventoryTab === 'fba'">—</td><td>{{ group.variants.reduce((total,v) => total+v.quantity,0) }}</td><td class="v2-muted">—</td><td>${{ Math.min(...group.variants.map(v=>v.price)).toFixed(2) }}<small>{{ state.templates.find(t=>t.id===group.product.offer.templateId)?.name }}</small></td><td><button class="v2-button" :data-edit="group.product.id" @click="openProduct(group.product)">编辑</button></td></tr><template v-if="expanded.includes(group.product.id)"><tr v-for="variant in group.variants" :key="variant.id" class="v2-variant-row" :data-variant="variant.id"><td><input type="checkbox" :aria-label="`选择 ${variant.sku}`" :value="variant.id" v-model="selected" /></td><td>{{ group.product.status === 'active' && variant.status === 'active' ? '在售' : '不可售' }}</td><td><V2ProductImage :title="group.product.title" :image="variant.image || group.product.images[0]" :color="variant.color" /></td><td><button class="v2-link" @click="openProduct(group.product)">{{ variant.sku }}</button><small>{{ variant.condition }}</small></td><td><span>{{ variant.term }}</span><small>{{ variant.code }}</small><small>{{ variant.delivery === 'FBA' ? '亚马逊配送' : '卖家自行配送' }}</small></td><td>{{ group.product.createdAt.slice(0,10) }}</td><td v-if="inventoryTab === 'fba'">LOCAL-{{ variant.sku }}</td><td><input class="v2-inline-number" type="number" min="0" :value="variant.quantity" :aria-label="`${variant.sku} 可售数量`" @change="updateInline(variant,'quantity',$event)" /></td><td class="v2-muted" title="没有真实费率或收费">—</td><td>$ <input class="v2-inline-number" type="number" min="0" step=".01" :value="variant.price" :aria-label="`${variant.sku} 价格`" @change="updateInline(variant,'price',$event)" /><small>{{ state.templates.find(t=>t.id===group.product.offer.templateId)?.name }}</small></td><td><select :aria-label="`${variant.sku} 操作`" @change="rowAction(group.product,variant,$event)"><option value="">-操作-</option><option value="edit">编辑</option><option value="inactive">停售</option><option value="active">出售</option><option value="convert">转换为亚马逊配送</option></select></td></tr></template></template><tr v-if="!pagedGroups.length"><td :colspan="inventoryTab === 'fba' ? 11 : 10" class="v2-empty">没有符合条件的商品。请调整搜索或筛选条件。</td></tr></tbody></table></div>
          <div class="v2-pagination"><span>显示 {{ visibleGroups.length ? (currentPage-1)*pageSize+1 : 0 }}–{{ Math.min(currentPage*pageSize,visibleGroups.length) }} 条，共 {{ visibleGroups.length }} 条父商品</span><label>每页 <select v-model="pageSize"><option :value="5">5</option><option :value="10">10</option><option :value="20">20</option></select></label><button class="v2-button" :disabled="currentPage <= 1" @click="currentPage--">上一页</button><span>{{ currentPage }} / {{ pageCount }}</span><button class="v2-button" :disabled="currentPage >= pageCount" @click="currentPage++">下一页</button></div>
        </template>
        <template v-else-if="page === 'category'"><h1>添加商品</h1><section class="v2-category-panel"><h2>选择商品分类</h2><p>为您要销售的商品选择最合适的类别。</p><form @submit.prevent class="v2-category-search"><input name="categorySearch" v-model="categorySearch" type="search" placeholder="搜索商品分类" aria-label="搜索商品分类" /><button class="v2-button v2-dark" type="submit">查找分类</button></form><div class="v2-category-path">所有商品类别 <span>›</span> {{ categorySearch ? '搜索结果' : '浏览分类' }}</div><button v-for="category in categoryMatches" :key="category.id" class="v2-category-item" :data-category="category.id" @click="chooseCategory(category.id)"><span>{{ category.path }}</span><b>选择 ›</b></button><p v-if="!categoryMatches.length" class="v2-empty">没有匹配的本地类目。</p><p class="v2-local-note">本轮提供 6 个本地类目样例；不是原平台全量类目库。</p></section></template>
        <V2ProductEditor v-else-if="page === 'product'" ref="editor" :product="draft" :templates="state.templates" :errors="errors" @save="saveEdited" @cancel="navigate('inventory')" />
        <template v-else-if="page === 'orders'"><h1>管理订单</h1><div class="v2-order-tabs"><b>所有订单 ({{ state.orders.length }})</b><span>未发货 ({{ state.orders.filter(o=>o.status==='未发货').length }})</span><span>已发货 ({{ state.orders.filter(o=>o.status==='已发货').length }})</span></div><div class="v2-table-scroll"><table class="v2-order-table"><thead><tr><th>订单日期</th><th>订单信息</th><th>商品信息</th><th>数量</th><th>订单状态</th><th>操作</th></tr></thead><tbody><tr v-for="item in state.orders" :key="item.id"><td>2026-10-08<small>本机样例</small></td><td class="v2-link">{{ item.id }}<small>{{ item.country }}</small></td><td>{{ orderProduct(item)?.title }}<small>SKU：{{ orderVariant(item)?.sku }}</small></td><td>{{ item.quantity }}</td><td>{{ item.status }}</td><td><button v-if="item.status==='未发货'" class="v2-button" :data-order-ship="item.id" @click="openShipment(item)">确认发货</button><span v-else>已完成</span></td></tr></tbody></table></div></template>
        <template v-else-if="page === 'shipment' && order"><h1>确认发货</h1><div class="v2-order-summary"><b>订单号：{{ order.id }}</b><p>{{ orderProduct(order)?.title }} · {{ order.country }} · 数量 {{ order.quantity }}</p></div><form class="v2-shipment-form" @submit.prevent="confirmShipment"><label>配送日期<input type="date" value="2026-10-08" /></label><label>承运人<select name="shipmentCarrier" v-model="shipmentCarrier"><option value="">请选择</option><option>中邮</option><option>E 邮宝</option><option>燕文</option><option>UPS</option></select></label><label>运单号<input name="tracking" v-model="tracking" /></label><p class="v2-local-note">{{ order.warehouseStage === '已出库' ? '请从国内仓库的同一订单发货记录核对承运人和运单。' : '已打开确认页；请先到国内仓库分拣、打包并发货。' }}</p><div><button class="v2-button" type="button" data-action="go-warehouse" @click="navigate('warehouse')">打开国内仓库</button><button class="v2-button v2-yellow" type="submit" data-action="confirm-shipment">确认发货</button></div></form></template>
      </main>
    </template>
    <template v-else><header class="v2-warehouse-header"><strong>国内仓库</strong><span>旅序用品工作室 · 本机样例仓库</span><button @click="navigate('course')">返回课程首页</button></header><nav class="v2-warehouse-nav"><button v-for="stage in ['待分拣','待打包','待出库','已出库']" :key="stage" :data-stage="stage" :class="{active:warehouseStage===stage}" @click="warehouseStage=stage; message=''">{{ stage==='待分拣' ? '分拣' : stage==='待打包' ? '打包' : stage==='待出库' ? '立即发货' : '发货记录' }} ({{ state.orders.filter(o=>o.warehouseStage===stage).length }})</button></nav><main class="v2-warehouse-content"><div v-if="message" class="v2-message" :class="{error:failed}" role="status" data-testid="form-result">{{ message }}</div><h1>{{ warehouseStage==='已出库' ? '发货记录' : warehouseStage==='待出库' ? '立即发货' : warehouseStage==='待打包' ? '订单打包' : '订单分拣' }}</h1><div v-if="warehouseStage==='待出库'" class="v2-carrier"><label>承运人 <select name="carrier" v-model="carrier"><option value="">请选择物流公司</option><option>中邮</option><option>E 邮宝</option><option>燕文</option><option>UPS</option></select></label></div><div class="v2-table-scroll"><table class="v2-order-table"><thead><tr><th>订单号</th><th>商品</th><th>SKU</th><th>数量</th><th>国家</th><th>状态</th><th>{{ warehouseStage==='已出库' ? '运单号' : '操作' }}</th></tr></thead><tbody><tr v-for="item in warehouseOrders" :key="item.id"><td>{{ item.id }}</td><td>{{ orderProduct(item)?.title }}</td><td>{{ orderVariant(item)?.sku }}</td><td>{{ item.quantity }}</td><td>{{ item.country }}</td><td>{{ item.warehouseStage }}</td><td v-if="warehouseStage==='已出库'"><strong :data-tracking="item.id">{{ item.tracking }}</strong><small>{{ item.carrier }}</small></td><td v-else><button class="v2-button" :data-warehouse-order="item.id" @click="warehouseAction(item)">{{ warehouseStage==='待分拣' ? '分拣' : warehouseStage==='待打包' ? '打包' : '立即发货' }}</button></td></tr><tr v-if="!warehouseOrders.length"><td colspan="7" class="v2-empty">当前没有{{ warehouseStage }}的样例订单。</td></tr></tbody></table></div><button v-if="selectedOrder" class="v2-button v2-return-order" data-action="return-shipment" @click="navigate('shipment',{order:selectedOrder})">返回订单 {{ selectedOrder }} 的确认页</button></main></template>
    <div v-if="portalOpen" class="v2-modal-backdrop" @click.self="portalOpen=false"><section class="v2-portal" role="dialog" aria-modal="true" aria-label="Amazon 入口"><header><span>Amazon</span><button aria-label="关闭 Amazon 入口" @click="portalOpen=false">×</button></header><div class="v2-portal-options"><button @click="boundary='选品工具由真实工具负责人开发，不在本轮模拟样板内。'"><V2PortalScene kind="selection" /><strong>选品工具</strong></button><button @click="boundary='这里不打开真实1688网站，也不进行订货。'"><V2PortalScene kind="purchasing" /><strong>1688订货平台</strong></button><button data-action="enter-seller" @click="enterSeller()"><V2PortalScene kind="seller" /><strong>亚马逊卖家后台</strong></button></div><footer><span>独立模拟入口，不使用真实账号</span><button class="v2-link" @click="enterSeller(true)">在新标签页打开卖家后台 ↗</button></footer></section></div>
    <div v-if="boundary || resetOpen" class="v2-modal-backdrop" @click.self="boundary=''; resetOpen=false"><section class="v2-small-dialog" role="dialog" aria-modal="true" :aria-label="resetOpen ? '重置本机样例' : '样板范围说明'"><h2>{{ resetOpen ? '重置本机样例？' : '样板范围说明' }}</h2><p>{{ resetOpen ? '只重置这套 V2 体验的商品、变体和订单。原有演示数据及其他网站设置不会删除。' : boundary }}</p><footer><button class="v2-button" @click="boundary='';resetOpen=false">{{ resetOpen ? '取消' : '知道了' }}</button><button v-if="resetOpen" class="v2-button v2-yellow" data-action="confirm-reset" @click="resetSamples">确认重置</button></footer></section></div>
    <aside v-if="toolsOpen" class="v2-tool-controller" aria-label="课赛通工具控制"><header><strong>课赛通工具体验</strong><button aria-label="收起工具控制" @click="toolsOpen=false">×</button></header><p>工具操作当前页面，保存后的状态决定结果。</p><label>选择任务<select v-model="runTask" :disabled="running" aria-label="选择一键任务"><option value="product">商品发布 · 两个变体</option><option value="shipping">订单发货 · 国内仓库完整链</option></select></label><button v-if="!running" class="v2-button v2-yellow" data-action="run" @click="automatic">开始操作</button><div v-else><button class="v2-button" @click="paused=!paused">{{ paused ? '继续' : '暂停' }}</button><button class="v2-button" @click="stop">停止</button></div><p role="status" data-testid="run-status">{{ paused ? '已暂停' : runStatus }}</p><ol><li v-for="(step,index) in steps" :key="step" :class="{done:index<cursor,current:index===cursor&&running}">{{ index<cursor ? '✓' : index+1 }} {{ step }}</li></ol></aside>
    <div v-if="running || steps.length && !toolsOpen" class="v2-run-dock"><button @click="toolsOpen=!toolsOpen">KST · {{ paused ? '已暂停' : running ? currentStep : runStatus }}</button><button v-if="running" @click="paused=!paused">{{ paused ? '继续' : '暂停' }}</button><button v-if="running" @click="stop">停止</button></div>
  </div>
</template>

<style src="./v2-simulation.css" />
