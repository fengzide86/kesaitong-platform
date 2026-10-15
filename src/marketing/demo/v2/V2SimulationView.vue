<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import V2CourseMap from './V2CourseMap.vue'
import V2ProductEditor from './V2ProductEditor.vue'
import V2ProductImage from './V2ProductImage.vue'
import V2PortalScene from './V2PortalScene.vue'
import V2DemoController from './V2DemoController.vue'
import ShippingQuotePanel from './ShippingQuotePanel.vue'
import FbaWorkflow from './FbaWorkflow.vue'
import TemplateWorkflow from './TemplateWorkflow.vue'
import AdvertisingWorkflow from './AdvertisingWorkflow.vue'
import { applyFbaCommand, createFbaData, fbaFingerprint, fbaRows, type FbaCommand } from './fba-workflow'
import { applyTemplateCommand, createTemplateData, templateFingerprint, type TemplateCommand } from './template-workflow'
import { applyAdvertisingCommand, advertisingCandidates, createAdvertisingData, advertisingFingerprint, type AdvertisingCommand } from './advertising-workflow'
import { demoTasks, recommendedTask, type DemoOutcome, type DemoTask } from './demo-tasks'
import type { WorkflowReply } from './workflow-contract'
import kstLogo from '../../../assets/brand/kst-logo-horizontal.svg'
import { readSampleShippingWeight, type SampleShippingQuote } from './shipping-demo'
import { categories, createSeed, inventoryRows, newProduct, persistState, readState, saveProduct, SIMULATION_STORAGE_KEY, type FieldError, type Order, type Product, type State, type Variant } from './model'

type Page = 'course' | 'seller' | 'inventory' | 'category' | 'product' | 'orders' | 'shipment' | 'warehouse' | 'templates' | 'fba' | 'advertising'
const props = withDefaults(defineProps<{ embedded?: boolean; initialTask?: DemoTask }>(), { embedded: false, initialTask: 'product' })
const emit = defineEmits<{ close: [] }>()
// Embedded navigation belongs to this feature, not the website's router. The
// standalone sample keeps its original query URLs for existing model tests.
const router = props.embedded ? undefined : useRouter()
const externalRoute = props.embedded ? undefined : useRoute()
const initialPages: Record<DemoTask, Page> = { product: 'inventory', template: 'templates', advertising: 'advertising', fba: 'inventory', shipping: 'orders' }
const embeddedQuery = { page: initialPages[props.initialTask] }
const embeddedRoute = reactive({ query: embeddedQuery as Record<string, string>, fullPath: `local:${embeddedQuery.page}` })
const route = props.embedded ? embeddedRoute : externalRoute!
let disposed = false
let storage: Storage | undefined
// The website embeds a fresh, disposable sample. Manual saves still update
// the current open experience, but leaving it must not make the next entry
// inherit the previous session. Standalone demo routes keep their existing
// local persistence contract.
if (!props.embedded) {
  try { storage = window.localStorage } catch { /* Local samples remain usable without storage. */ }
}
let lastStoredRaw: string | null = null
const initial = props.embedded
  ? { state: createSeed(), temporary: false, notice: '' }
  : readState(storage && { getItem(key) { lastStoredRaw = storage!.getItem(key); return lastStoredRaw } })
const state = reactive(initial.state), temporary = ref(initial.temporary)
state.fba ??= createFbaData(); state.advertising ??= createAdvertisingData(); state.templateData ??= createTemplateData()
if (initial.temporary) storage = undefined
const root = ref<HTMLElement>(), editor = ref<InstanceType<typeof V2ProductEditor>>()
const dockClearance = ref(0)
let dockAdjustScheduled = false
function updateDockClearance() {
  if (disposed || !root.value) return
  const viewport = root.value.getBoundingClientRect()
  const viewportBottom = props.embedded ? viewport.bottom : window.innerHeight
  const viewportHeight = props.embedded ? root.value.clientHeight : window.innerHeight
  const footers = root.value?.querySelectorAll<HTMLElement>('.v2-editor-footer, .v2-fba-actions, .v2-template-form-actions, .v2-ad-save-footer, .v2-shipment-form > div')
  const dockHeight = root.value?.querySelector<HTMLElement>('.kst-demo-dock')?.getBoundingClientRect().height || 120
  // The footer can end above the viewport bottom because of content padding.
  // Avoid its actual screen rectangle, not only its height or an ideal scroll pose.
  const clearances = Array.from(footers || []).filter(footer => footer.getClientRects().length).map(footer => footer.getBoundingClientRect())
    .filter(box => box.top < viewportBottom && box.bottom >= viewportBottom - dockHeight - 34)
    .map(box => Math.ceil(viewportBottom - box.top) + 16)
  dockClearance.value = Math.min(Math.max(0, ...clearances), Math.max(0, viewportHeight - dockHeight - 12))
  // When a short form and its footer are both visible, lifting the dock can
  // cover the current field. Use the page's reserved scroll space to keep the
  // target and footer together above the dock instead.
  if (!dockAdjustScheduled) {
    dockAdjustScheduled = true
    void nextTick(() => {
      dockAdjustScheduled = false
      if (disposed) return
      const dock = root.value?.querySelector<HTMLElement>('.kst-demo-dock')
      if (!dock || !demoTarget?.isConnected || toolsOpen.value) return
      const field = demoTarget.getBoundingClientRect(), controls = dock.getBoundingClientRect()
      if (field.bottom > controls.top - 12 && field.top < controls.bottom && field.right > controls.left && field.left < controls.right) {
        const scrollOptions = { top: field.bottom - controls.top + 28, behavior: 'instant' as const }
        if (props.embedded) root.value?.scrollBy(scrollOptions)
        else window.scrollBy(scrollOptions)
      }
    })
  }
}
const dockResizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(updateDockClearance) : undefined
window.addEventListener('resize', updateDockClearance)
if (!props.embedded) window.addEventListener('scroll', updateDockClearance, true)
const page = ref<Page>('course'), draft = ref<Product>(newLocalProduct()), errors = ref<FieldError[]>([])
const message = ref(initial.notice), failed = ref(false), portalOpen = ref(false), boundary = ref(''), resetOpen = ref(false)
const editConflict = ref(''), reloadOpen = ref(false), missingProduct = ref(false)
const menu = ref(''), toolsOpen = ref(props.embedded), expanded = ref<string[]>([]), selected = ref<string[]>([])
const pinnedMenu = ref('')
function hoverMenu(name: string) { if (!pinnedMenu.value) menu.value = name }
function leaveMenu() { if (!pinnedMenu.value) menu.value = '' }
function openMenu(name: string) { pinnedMenu.value = name; menu.value = name }
function closeMenu() { menu.value = ''; pinnedMenu.value = '' }
const queryInput = ref(''), query = ref(''), categorySearch = ref('')
const statusFilter = ref('all'), deliveryFilter = ref(props.embedded && props.initialTask === 'fba' ? 'FBA' : 'all'), minPrice = ref<string | number>(''), maxPrice = ref<string | number>('')
const inventoryTab = ref(props.embedded && props.initialTask === 'fba' ? 'fba' : 'all'), bulkAction = ref(''), currentPage = ref(1), pageSize = ref(10)
const warehouseStage = ref('待分拣'), selectedOrder = ref(''), carrier = ref(''), shipmentCarrier = ref(''), tracking = ref('')
const shipmentService = ref('标准'), shipmentDate = ref(new Date().toLocaleDateString('sv-SE'))
const orderFilter = ref('all'), demoOrder = ref(''), warehouseSelected = ref<string[]>([]), detailOrder = ref<Order>()
const warehouseQuery = ref('')
const warehouseReceipt = ref<{ ids: string[]; stage: string }>()
const shippingQuotes = ref<SampleShippingQuote[]>([])
const calculatorOpen = ref(false)
const running = ref(false), paused = ref(false), runStatus = ref('就绪'), runTask = ref('product'), currentStep = ref(''), steps = ref<string[]>([]), cursor = ref(0)
const runPace = ref<'guided' | 'flow'>('guided'), demoAction = ref(''), activeTask = ref('product')
const demoReading = ref('')
const outcome = ref<DemoOutcome>()
const recentlySavedProductId = ref('')
const recentlySavedProduct = computed(() => state.products.find(product => product.id === recentlySavedProductId.value))
const fbaSelection = ref<string[]>([])
const welcomeKey = 'kst-public-simulation:welcome-v1'
const welcome = ref(false)
if (!props.embedded) {
  try { welcome.value = sessionStorage.getItem(welcomeKey) !== 'seen' } catch { welcome.value = true }
}
function dismissWelcome() { welcome.value = false; try { sessionStorage.setItem(welcomeKey, 'seen') } catch { /* The introduction remains dismissible without storage. */ } }
function prepareTask(task: DemoTask) { if (running.value) return; dismissWelcome(); runTask.value = task; toolsOpen.value = true; calculatorOpen.value = false }
const timings = { guided: { character: 80, field: 400, click: 700, step: 1100, reading: 2000 }, flow: { character: 5, field: 30, click: 30, step: 90, reading: 0 } }
let demoTarget: HTMLElement | undefined
let generation = 0
const knownPages: Page[] = ['course', 'seller', 'inventory', 'category', 'product', 'orders', 'shipment', 'warehouse', 'templates', 'fba', 'advertising']
const copy = <T,>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T
type SyncedState = State & { _sampleSync?: { revision: string; reset: string } }
let resetVersion = (initial.state as SyncedState)._sampleSync?.reset || ''
const workflowEpoch = ref(resetVersion)
let productBaseline: Product | undefined, shipmentBaseline: Order | undefined, formResetVersion = resetVersion
let pendingMutation: Promise<void> = Promise.resolve(), activeRun: number | undefined
const same = (first: unknown, second: unknown) => JSON.stringify(first) === JSON.stringify(second)
const revision = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
const productActive = (product: Product) => product.status === 'active' && product.variants.some(variant => !variant.deleted && variant.status === 'active')
function newLocalProduct(categoryId?: string) {
  const product = newProduct(categoryId), templateId = state.templateData?.defaultTemplateId
  if (templateId && state.templates.some(template => template.id === templateId)) product.offer.templateId = templateId
  return product
}
function bindProduct(product: Product) {
  draft.value = copy(product); productBaseline = copy(state.products.find(item => item.id === product.id)); formResetVersion = resetVersion; editConflict.value = ''; missingProduct.value = false
}
function conflict(text = '该商品已在其他标签页修改，当前未保存表单已保留。请重新加载最新样例后再保存。') {
  editConflict.value = text; result(text, true)
}
function synchronizeLatest() {
  if (disposed || !storage) return false
  let raw: string | null = null
  const latest = readState({ getItem(key) { raw = storage!.getItem(key); return raw } })
  if (latest.temporary) { temporary.value = true; storage = undefined; result(latest.notice, true); return false }
  if (raw === lastStoredRaw) return false
  const previousReset = resetVersion
  resetVersion = (latest.state as SyncedState)._sampleSync?.reset || ''
  workflowEpoch.value = resetVersion
  state.products = copy(latest.state.products); state.orders = copy(latest.state.orders); state.templates = copy(latest.state.templates)
  state.fba = copy(latest.state.fba || createFbaData()); state.advertising = copy(latest.state.advertising || createAdvertisingData()); state.templateData = copy(latest.state.templateData || createTemplateData())
  outcome.value = undefined
  lastStoredRaw = raw
  if (page.value === 'product' && (previousReset !== resetVersion || !same(productBaseline, state.products.find(item => item.id === draft.value.id)))) conflict()
  if (page.value === 'shipment' && (previousReset !== resetVersion || !same(shipmentBaseline, state.orders.find(item => item.id === selectedOrder.value)))) conflict('该订单已在其他标签页修改，当前承运人和运单输入已保留。请重新加载最新样例后再确认。')
  if (running.value) { generation++; running.value = false; paused.value = false; clearDemoTarget(); demoAction.value = ''; runStatus.value = '已停止：其他标签页修改了样例'; result('其他标签页已修改或重置样例，自动操作已停止；未保存表单已保留。', true) }
  return true
}
function storageChanged(event: StorageEvent) {
  if (event.storageArea === storage && (event.key === SIMULATION_STORAGE_KEY || event.key === null)) synchronizeLatest()
}
window.addEventListener('storage', storageChanged)
function persist() {
  if (disposed || props.embedded) return
  const payload: SyncedState = { version: 2, products: copy(state.products), orders: copy(state.orders), templates: copy(state.templates), fba: copy(state.fba), advertising: copy(state.advertising), templateData: copy(state.templateData), _sampleSync: { revision: revision(), reset: resetVersion } }
  temporary.value = !persistState(storage, payload)
  if (!temporary.value) lastStoredRaw = JSON.stringify(payload)
  else storage = undefined
}
// Every mutation rereads storage inside one cross-tab lock, before touching the
// latest objects. A delayed storage event cannot turn an old snapshot into a write.
function mutate(work: () => string | undefined, after?: () => void) {
  if (disposed) return Promise.resolve()
  const expectedRun = running.value ? generation : undefined
  const execute = () => {
    // A queued Web Lock may resolve after the visitor closes the feature.
    // Never mutate or persist a detached experience, including manual saves.
    if (disposed) return
    const previousStorage = storage
    synchronizeLatest()
    if (previousStorage && !storage) return
    if (expectedRun !== undefined && expectedRun !== generation) return
    const text = work()
    if (!text) return
    persist(); after?.(); result(text)
  }
  pendingMutation = pendingMutation.then(async () => {
    if (disposed) return
    if (navigator.locks) await navigator.locks.request(SIMULATION_STORAGE_KEY, execute)
    else { storage = undefined; temporary.value = !props.embedded; execute() }
  }).catch(error => { if (!disposed) result(error instanceof Error ? error.message : '本地样例操作未完成。', true) })
  return pendingMutation
}
async function workflowSubmit(baseline: string, fingerprint: (state: State) => string, apply: (state: State) => WorkflowReply): Promise<WorkflowReply> {
  const epoch = resetVersion
  let reply: WorkflowReply = { ok: false, message: '样例已变化或操作已停止，请重新打开表单。' }
  await mutate(() => {
    if (epoch !== resetVersion || baseline !== fingerprint(state)) { reply = { ok: false, message: '这些数据已在其他标签页修改，请重新打开最新表单再保存。' }; result(reply.message, true); return }
    const candidate = copy(state)
    reply = apply(candidate)
    if (!reply.ok) { result(reply.message, true); return }
    Object.assign(state, candidate)
    return reply.message
  })
  return reply
}
const submitFba = (command: FbaCommand, baseline: string) => workflowSubmit(baseline, state => fbaFingerprint(state, state.fba!), state => applyFbaCommand(state, state.fba!, command))
const submitTemplate = (command: TemplateCommand, baseline: string) => workflowSubmit(baseline, state => templateFingerprint(state, state.templateData!), state => applyTemplateCommand(state, state.templateData!, command))
const submitAdvertising = (command: AdvertisingCommand, baseline: string) => workflowSubmit(baseline, state => advertisingFingerprint(state, state.advertising!), state => applyAdvertisingCommand(state, state.advertising!, command))
function reloadForm() {
  synchronizeLatest(); reloadOpen.value = false; editConflict.value = ''; errors.value = []
  if (page.value === 'product') {
    const latest = state.products.find(item => item.id === draft.value.id)
    if (latest) bindProduct(latest)
    else { missingProduct.value = true; productBaseline = undefined }
  } else if (page.value === 'shipment') bindShipment()
  message.value = ''; failed.value = false
}
function bindShipment() {
  const latest = state.orders.find(item => item.id === selectedOrder.value)
  shipmentBaseline = copy(latest); shipmentCarrier.value = latest?.carrier || ''; tracking.value = latest?.tracking || ''; formResetVersion = resetVersion; editConflict.value = ''
  shipmentService.value = latest?.shippingService || '标准'; shipmentDate.value = latest?.shippingDate || new Date().toLocaleDateString('sv-SE')
  shippingQuotes.value = []
}
function loadRoute() {
  if (disposed) return
  synchronizeLatest()
  calculatorOpen.value = false
  const target = String(route.query.page || 'course')
  page.value = knownPages.includes(target as Page) ? target as Page : 'course'
  if (!running.value) runTask.value = page.value === 'inventory' && deliveryFilter.value === 'FBA' ? 'fba' : recommendedTask(page.value)
  if (page.value === 'product') {
    const existing = state.products.find(product => product.id === route.query.product)
    if (existing) bindProduct(existing)
    else if (draft.value.id === route.query.product) bindProduct(draft.value)
    else missingProduct.value = true
  }
  if (page.value === 'shipment') { selectedOrder.value = String(route.query.order || state.orders[0]?.id || ''); bindShipment() }
  else if (page.value !== 'product') editConflict.value = ''
  closeMenu()
}
watch(() => route.fullPath, loadRoute, { immediate: true })
watch(() => route.fullPath, async () => {
  await nextTick(); if (disposed) return; dockResizeObserver?.disconnect()
  const footer = root.value?.querySelector<HTMLElement>('.v2-editor-footer')
  if (footer) dockResizeObserver?.observe(footer)
  if (root.value) dockResizeObserver?.observe(root.value)
  updateDockClearance()
}, { immediate: true })
watch([running, toolsOpen, demoAction], async () => { await nextTick(); if (!disposed) updateDockClearance() })
function navigate(target: Page, params: Record<string, string> = {}) {
  if (disposed) return
  message.value = ''; failed.value = false; closeMenu()
  if (props.embedded) {
    embeddedRoute.query = { page: target, ...params }
    embeddedRoute.fullPath = `local:${new URLSearchParams(embeddedRoute.query).toString()}`
    root.value?.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  } else void router!.push({ path: '/demo', query: { page: target, ...params } })
}
function viewOutcome() {
  if (!outcome.value) return
  const saved = outcome.value
  if (saved.task === 'product') { queryInput.value = saved.facts.find(fact => fact.label === '父 SKU')?.value || ''; query.value = queryInput.value; inventoryTab.value = 'all'; deliveryFilter.value = 'all'; statusFilter.value = 'all'; minPrice.value = ''; maxPrice.value = ''; expanded.value = [saved.objectId] }
  if (saved.task === 'shipping') orderFilter.value = '已发货'
  toolsOpen.value = false; navigate(saved.page as Page, saved.params)
  void nextTick(() => {
    const target = saved.task === 'product'
      ? root.value?.querySelector<HTMLElement>('[data-testid="product-publish-result"]')
      : root.value?.querySelector<HTMLElement>(`[data-parent="${saved.objectId}"]`)
    target?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' })
  })
}
function showPublishedProduct() {
  const product = recentlySavedProduct.value
  if (!product) return
  queryInput.value = product.parentSku; query.value = product.parentSku
  inventoryTab.value = 'all'; statusFilter.value = 'all'; deliveryFilter.value = 'all'
  minPrice.value = ''; maxPrice.value = ''; currentPage.value = 1; expanded.value = [product.id]
  void nextTick(() => root.value?.querySelector<HTMLElement>(`[data-parent="${product.id}"]`)?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
}
function nextTask() { const tasks = Object.keys(demoTasks) as DemoTask[]; prepareTask(tasks[(tasks.indexOf(outcome.value?.task || 'product') + 1) % tasks.length]!) }
const fbaBalances = computed(() => new Map(fbaRows(state, state.fba!).map(row => [row.variant.id, row])))
function openFba(ids: string[] = [], mode = 'inventory') { fbaSelection.value = [...ids]; navigate('fba', { mode }) }
function result(text: string, error = false) { message.value = text; failed.value = error }
function courseOpen(area: string) {
  if (area === 'amazon') portalOpen.value = true
  else if (area === 'warehouse') navigate('warehouse')
  else boundary.value = area === 'grades' ? '成绩与评分不在本轮本地样板范围，模拟体验不会改变真实成绩。' : '这个入口保留原平台的位置。本轮交付课程地图、库存、商品编辑和国内仓库样板；此分支尚未复现，不会跳到假页面。'
}
function enterSeller(newTab = false) {
  portalOpen.value = false
  if (newTab && !props.embedded) window.open(router!.resolve({ path: '/demo', query: { page: 'seller' } }).href, '_blank', 'noopener,noreferrer')
  else navigate('seller')
}
function openProduct(product?: Product) {
  synchronizeLatest(); errors.value = []
  const latest = product && state.products.find(item => item.id === product.id)
  if (product && !latest) { missingProduct.value = true; navigate('product', { product: product.id }); return }
  bindProduct(latest || newLocalProduct()); navigate('product', { product: draft.value.id, category: draft.value.categoryId })
}
function chooseCategory(id: string) { synchronizeLatest(); bindProduct(newLocalProduct(id)); errors.value = []; navigate('product', { product: draft.value.id, category: id }) }
function saveEdited(product: Product, complete: boolean) {
  return mutate(() => {
    if (editConflict.value || formResetVersion !== resetVersion || !same(productBaseline, state.products.find(item => item.id === product.id))) { conflict(); return }
    const saved = saveProduct(state, product, complete)
    errors.value = saved.errors
    if (!saved.ok) { result('请检查标记的字段。本地样例尚未完成。', true); return }
    const readback = state.products.find(item => item.id === saved.id)!
    bindProduct(readback)
    if (complete) {
      recentlySavedProductId.value = saved.id
      query.value = readback.parentSku; queryInput.value = readback.parentSku; statusFilter.value = 'all'; deliveryFilter.value = 'all'; inventoryTab.value = 'all'; minPrice.value = ''; maxPrice.value = ''; currentPage.value = 1
      expanded.value = [saved.id]
      return '商品已保存并完成。可在列表中展开并核对子 SKU。'
    }
    return readback.status === 'active' ? '已保存商品修改，仍停留在编辑页；商品保持已发布状态。' : '已保存为本地草稿，仍停留在编辑页；尚未完成发布。'
  }, () => { if (complete) navigate('inventory') })
}
const categoryMatches = computed(() => categories.filter(category => `${category.name} ${category.path}`.includes(categorySearch.value.trim())))
const visibleGroups = computed(() => state.products.map(product => ({ product, variants: product.variants.filter(variant => {
  if (variant.deleted) return false
  const active = product.status === 'active' && variant.status === 'active'
  if (statusFilter.value === 'active' && !active || statusFilter.value === 'inactive' && active) return false
  if (inventoryTab.value === 'draft' && product.status !== 'draft') return false
  if (deliveryFilter.value !== 'all' && variant.delivery !== deliveryFilter.value) return false
  if (minPrice.value !== '' && variant.price < Number(minPrice.value) || maxPrice.value !== '' && variant.price > Number(maxPrice.value)) return false
  return `${product.title} ${product.parentSku} ${product.asin} ${variant.sku} ${variant.code}`.toLowerCase().includes(query.value.toLowerCase().trim())
}) })).filter(group => group.variants.length || group.product.status === 'draft' && !group.product.variants.some(variant => !variant.deleted) && statusFilter.value === 'all' && deliveryFilter.value === 'all' && minPrice.value === '' && maxPrice.value === '' && inventoryTab.value !== 'fba' && `${group.product.title} ${group.product.parentSku} ${group.product.asin}`.toLowerCase().includes(query.value.toLowerCase().trim())))
const pageCount = computed(() => Math.max(1, Math.ceil(visibleGroups.value.length / pageSize.value)))
watch(pageCount, total => { currentPage.value = Math.min(currentPage.value, total) })
const pagedGroups = computed(() => visibleGroups.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))
watch([query, statusFilter, deliveryFilter, minPrice, maxPrice, inventoryTab, pageSize], () => { currentPage.value = 1; selected.value = [] })
const visibleVariantIds = computed(() => pagedGroups.value.flatMap(group => group.variants.map(variant => variant.id)))
const allSelected = computed(() => visibleVariantIds.value.length > 0 && visibleVariantIds.value.every(id => selected.value.includes(id)))
function selectAll(checked: boolean) { selected.value = checked ? [...visibleVariantIds.value] : [] }
function toggleGroup(id: string) { expanded.value = expanded.value.includes(id) ? expanded.value.filter(item => item !== id) : [...expanded.value, id] }
function activateTab(tab: string) {
  if (tab === 'shipments') { openFba([], 'shipments'); return }
  if (tab === 'pricing') { boundary.value = '管理定价尚未加入本地体验。'; return }
  inventoryTab.value = tab; deliveryFilter.value = tab === 'fba' ? 'FBA' : 'all'
  if (!running.value) runTask.value = tab === 'fba' ? 'fba' : 'product'
}
function applyBulk() {
  if (!selected.value.length || !bulkAction.value) { result('请先勾选子 SKU 并选择批量操作。', true); return }
  if (bulkAction.value === 'FBA') { openFba(selected.value, 'convert'); return }
  const action = bulkAction.value, baseline = inventoryRows(state).filter(({ variant }) => selected.value.includes(variant.id)).map(({ variant }) => copy(variant)), reset = resetVersion
  return mutate(() => {
    const rows = inventoryRows(state).filter(({ variant }) => baseline.some(item => item.id === variant.id))
    const key = action === 'FBM' ? 'delivery' : 'status'
    if (reset !== resetVersion || rows.length !== baseline.length || rows.some(({ variant }) => variant[key] !== baseline.find(item => item.id === variant.id)![key])) { result('所选子 SKU 已在其他标签页修改或重置，请核对最新列表后再操作。', true); return }
    for (const { variant } of rows) {
      if (action === 'FBM') variant.delivery = 'FBM'
      if (action === 'inactive') variant.status = 'inactive'
      if (action === 'active') variant.status = 'active'
    }
    return `已更新 ${rows.length} 条本地子 SKU，其他变体没有改变。`
  })
}
function updateInline(variant: Variant, key: 'quantity' | 'price', event: Event) {
  const input = event.target as HTMLInputElement, value = Number(input.value)
  if (value < 0 || !Number.isFinite(value) || key === 'quantity' && !Number.isInteger(value)) { input.value = String(variant[key]); result('请输入有效的非负数字；数量必须是整数。', true); return }
  const expected = variant[key], id = variant.id, reset = resetVersion
  return mutate(() => {
    const latest = inventoryRows(state).find(row => row.variant.id === id)?.variant
    if (!latest || reset !== resetVersion || latest[key] !== expected) { if (latest) input.value = String(latest[key]); result('这条子 SKU 已在其他标签页修改或重置，未写入当前数字，请核对最新列表。', true); return }
    latest[key] = value
    return `${latest.sku} 的${key === 'quantity' ? '可售数量' : '价格'}已保存。`
  })
}
function rowAction(product: Product, variant: Variant, event: Event) {
  const action = (event.target as HTMLSelectElement).value; (event.target as HTMLSelectElement).value = ''
  if (action === 'edit') openProduct(product)
  else if (action === 'convert') openFba([variant.id], 'convert')
  else if (action === 'inactive' || action === 'active') {
    const expected = variant.status, id = variant.id, reset = resetVersion
    return mutate(() => {
      const latest = inventoryRows(state).find(row => row.variant.id === id)?.variant
      if (!latest || reset !== resetVersion || latest.status !== expected) { result('这条子 SKU 已在其他标签页修改或重置，请核对最新列表后再操作。', true); return }
      latest.status = action
      return `${latest.sku} 已${action === 'active' ? '出售' : '停售'}。`
    })
  }
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
  closeMenu()
  if (item === '管理库存') { inventoryTab.value = 'all'; deliveryFilter.value = 'all'; navigate('inventory') }
  else if (item === '管理亚马逊库存') { inventoryTab.value = 'fba'; deliveryFilter.value = 'FBA'; navigate('inventory') }
  else if (item === '补全您的草稿') { inventoryTab.value = 'draft'; deliveryFilter.value = 'all'; statusFilter.value = 'all'; navigate('inventory') }
  else if (item === '添加商品' || item === '添加新商品') navigate('category')
  else if (item === '管理订单') navigate('orders')
  else if (item === '管理亚马逊货件') openFba([], 'shipments')
  else if (item === '广告活动管理') navigate('advertising')
  else boundary.value = '该分支尚未纳入首轮高还原样板，保留入口供后续按原平台扩展。'
}
const order = computed(() => state.orders.find(item => item.id === selectedOrder.value))
const focusedOrderId = computed(() => page.value === 'orders' ? String(route.query.focus || '') : '')
const displayedOrders = computed(() => state.orders.filter(item => (!focusedOrderId.value || item.id === focusedOrderId.value) && (orderFilter.value === 'all' || item.status === orderFilter.value)))
const demoOrders = computed(() => state.orders.filter(item => item.status === '未发货').map(item => ({ id: item.id, label: `${item.id} · ${item.country} · ${item.warehouseStage}` })))
watch(demoOrders, orders => { if (!orders.some(item => item.id === demoOrder.value)) demoOrder.value = orders[0]?.id || '' }, { immediate: true })
const warehouseOrders = computed(() => state.orders.filter(item => item.warehouseStage === warehouseStage.value && (!warehouseQuery.value.trim() || [item.id, orderProduct(item)?.title, orderVariant(item)?.sku, item.tracking].some(value => value?.toLowerCase().includes(warehouseQuery.value.trim().toLowerCase())))))
watch(warehouseStage, () => { warehouseSelected.value = []; warehouseQuery.value = '' })
const orderProduct = (item: Order) => state.products.find(product => product.id === item.productId)
const orderVariant = (item: Order) => orderProduct(item)?.variants.find(variant => variant.id === item.variantId)
const orderWeight = (item: Order) => { const product = orderProduct(item); return product ? readSampleShippingWeight(product) : 0 }
const warehouseActionLabel = computed(() => warehouseStage.value === '待分拣' ? '分拣产品' : warehouseStage.value === '待打包' ? '打包产品' : '立即发货')
function openShipment(item: Order) { synchronizeLatest(); selectedOrder.value = item.id; bindShipment(); navigate('shipment', { order: item.id }) }
function warehouseAction(item: Order) {
  return warehouseBatch([item.id])
}
function warehouseBatch(ids = warehouseSelected.value) {
  if (!ids.length) { result('请先勾选本阶段的订单。', true); return Promise.resolve() }
  const baselines = ids.map(id => copy(state.orders.find(item => item.id === id))), reset = resetVersion, selectedCarrier = carrier.value, stage = warehouseStage.value
  let receipt: { ids: string[]; stage: string } | undefined
  return mutate(() => {
    const items = baselines.map(baseline => state.orders.find(item => item.id === baseline?.id))
    if (reset !== resetVersion || items.some((item, index) => !item || !same(item, baselines[index]))) { result('该订单已在其他标签页修改或重置，未重复操作，请核对最新订单。', true); return }
    if (items.some(item => item!.status === '已发货')) { result('该订单已经完成。', true); return }
    if (stage === '已出库' || items.some(item => item!.warehouseStage !== stage)) { result('该订单已有发货记录或不在当前阶段，不重复操作。', true); return }
    if (stage === '待出库') {
      if (!['中邮', 'E 邮宝', '燕文', 'UPS'].includes(selectedCarrier)) { result('请先选择承运人。', true); return }
      const totals = new Map<string, { variant: Variant; quantity: number }>()
      for (const item of items) {
        const variant = orderVariant(item!)
        if (!variant) { result('库存不足，本地样例未出库。', true); return }
        const key = `${item!.productId}:${variant.id}`, existing = totals.get(key)
        totals.set(key, { variant, quantity: item!.quantity + (existing?.quantity || 0) })
      }
      if ([...totals.values()].some(item => item.variant.quantity < item.quantity)) { result('库存不足，本地样例未出库。', true); return }
      for (const item of totals.values()) item.variant.quantity -= item.quantity
    }
    for (const item of items) {
      item!.warehouseStage = stage === '待分拣' ? '待打包' : stage === '待打包' ? '待出库' : '已出库'
      if (stage === '待出库') { item!.carrier = selectedCarrier; item!.tracking = `DEMO-PARCEL-${item!.id.slice(-5)}` }
    }
    receipt = { ids: items.map(item => item!.id), stage: items[0]!.warehouseStage }
    return `${receipt.ids.join('、')} 已转入${receipt.stage}。`
  }, () => { warehouseSelected.value = []; warehouseReceipt.value = receipt })
}
function confirmShipment() {
  const id = selectedOrder.value, enteredTracking = tracking.value, enteredCarrier = shipmentCarrier.value, service = shipmentService.value.trim(), date = shipmentDate.value
  return mutate(() => {
    if (editConflict.value || formResetVersion !== resetVersion || !same(shipmentBaseline, state.orders.find(item => item.id === id))) { conflict('该订单已在其他标签页修改，当前承运人和运单输入已保留。请重新加载最新样例后再确认。'); return }
    const item = state.orders.find(item => item.id === id)
    if (!item || item.status === '已发货') { result('该订单已完成或不存在。', true); return }
    if (!service || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { result('请填写配送服务与配送日期。', true); return }
    if (item.warehouseStage !== '已出库' || !enteredTracking || enteredTracking !== item.tracking || enteredCarrier !== item.carrier) { result('请先完成国内仓库发货，再填入同一订单的承运人和运单号。', true); return }
    item.status = '已发货'; item.shippingService = service; item.shippingDate = date
    return `${item.id} 已确认发货。`
  }, () => navigate('orders'))
}
function clearDemoTarget() { demoTarget?.classList.remove('v2-demo-target'); demoTarget = undefined; demoReading.value = '' }
function stop() { generation++; running.value = false; paused.value = false; toolsOpen.value = false; clearDemoTarget(); demoAction.value = ''; runStatus.value = '已停止，已保存的样例变化保留' }
function togglePause() { paused.value = !paused.value; if (!paused.value) toolsOpen.value = false }
function resetSamples() {
  stop()
  return mutate(() => {
    Object.assign(state, createSeed()); resetVersion = revision(); recentlySavedProductId.value = ''
    workflowEpoch.value = resetVersion; outcome.value = undefined; fbaSelection.value = []
    resetOpen.value = false; expanded.value = []; selected.value = []; warehouseSelected.value = []; warehouseReceipt.value = undefined; detailOrder.value = undefined; errors.value = []; steps.value = []; cursor.value = 0; currentStep.value = ''; editConflict.value = ''; reloadOpen.value = false; runStatus.value = '就绪'
    return '已重置本机 V2 样例。'
  }, () => navigate('course'))
}
async function settlePage() { await nextTick(); await new Promise<void>(resolve => requestAnimationFrame(() => resolve())) }
function node<T extends HTMLElement>(selector: string): T { const found = root.value?.querySelector<T>(selector); if (!found) throw new Error('当前页面没有找到操作位置，样例操作已停止。'); return found }
function assertRun(expectedRun = activeRun) { if (disposed || expectedRun === undefined || expectedRun !== generation || expectedRun !== activeRun) throw new Error('样例自动操作已经停止。') }
// Content pacing is independent from reduced-motion. Pause/stop/storage checks
// run before every DOM action and every character, not just between task steps.
async function demoWait(duration: number, expectedRun: number) {
  let remaining = duration
  do {
    assertRun(expectedRun); synchronizeLatest(); assertRun(expectedRun)
    if (paused.value) { await new Promise(resolve => setTimeout(resolve, 25)); continue }
    if (remaining <= 0) return
    const interval = Math.min(25, remaining), started = performance.now()
    await new Promise(resolve => setTimeout(resolve, interval))
    if (!paused.value) remaining -= performance.now() - started
  } while (remaining > 0 || paused.value)
}
function markDemoTarget(control: HTMLElement, action: string) {
  clearDemoTarget(); demoTarget = control; control.classList.add('v2-demo-target'); demoAction.value = action
  if (props.embedded && root.value) {
    // Do not let scrollIntoView move the marketing page or its horizontal
    // position. Only scroll this feature's own panels and table viewports.
    let parent = control.parentElement
    while (parent && parent !== root.value) {
      const overflow = getComputedStyle(parent)
      const box = parent.getBoundingClientRect(), target = control.getBoundingClientRect()
      const canScrollY = /(auto|scroll)/.test(overflow.overflowY) && parent.scrollHeight > parent.clientHeight
      const canScrollX = /(auto|scroll)/.test(overflow.overflowX) && parent.scrollWidth > parent.clientWidth
      if (canScrollY && (target.top < box.top + 12 || target.bottom > box.bottom - 12)) {
        parent.scrollTop += target.top - box.top - Math.max(12, (parent.clientHeight - target.height) / 2)
      }
      if (canScrollX) {
        const visible = control.getBoundingClientRect()
        if (visible.left < box.left + 12) parent.scrollLeft += visible.left - box.left - 12
        else if (visible.right > box.right - 12) parent.scrollLeft += visible.right - box.right + 12
      }
      parent = parent.parentElement
    }
    if (!control.closest('.v2-modal-backdrop, .kst-freight-panel, .kst-demo-panel')) {
      const viewport = root.value.getBoundingClientRect(), target = control.getBoundingClientRect()
      root.value.scrollBy({ top: target.top - viewport.top - Math.max(12, (root.value.clientHeight - target.height) / 2), behavior: 'instant' })
    }
  } else control.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  control.focus({ preventScroll: true })
}
async function demoClick(selector: string, expectedRun: number) {
  await demoWait(0, expectedRun)
  const control = node<HTMLButtonElement>(selector)
  markDemoTarget(control, `正在点击：${(control.getAttribute('aria-label') || control.textContent || '页面按钮').trim().replace(/\s+/g, ' ').slice(0, 42)}`)
  await demoWait(timings[runPace.value].click, expectedRun)
  if (!control.isConnected || control.disabled) throw new Error('当前操作位置已变化，演示已停止。')
  control.click()
}
const demoFields: Record<string, string> = { categorySearch: '商品类目', title: '商品名称', brand: '品牌', manufacturer: '制造商', partNumber: '制造商零件编号', parentSku: '父 SKU', variantTerms: '颜色与尺寸', templateId: '配送模板', weight: '商品重量', description: '商品描述', carrier: '出库承运人', shipmentCarrier: '订单承运人', shipmentService: '配送服务', tracking: '运单号', quoteCountry: '目的国', quoteWeight: 'ShippingWeight / kg', templateName: '模板名称', templateRuleBase0: '每单运费', templateRulePerUnit0: '单位运费', templateRuleUnit0: '计费单位', adGroupName: '广告组名称', adCampaignName: '活动名称', adBudget: '每日预算', adDefaultBid: '默认竞价', adStartAt: '开始日期', adEndAt: '结束日期' }
function fieldLabel(name: string) {
  if (demoFields[name]) return demoFields[name]
  const variant = name.match(/^variant(Sku|Code|Price|Quantity)-(\d+)$/)
  if (variant) return `第 ${Number(variant[2]) + 1} 个变体${({ Sku: ' SKU', Code: '商品编码', Price: '价格', Quantity: '数量' } as Record<string, string>)[variant[1]!]}`
  return name.startsWith('feature-') ? '商品要点' : name.startsWith('searchTerms-') ? '搜索关键字' : '当前字段'
}
async function demoFill(name: string, value: string, expectedRun: number) {
  await demoWait(0, expectedRun)
  const control = node<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`)
  markDemoTarget(control, `正在填写：${fieldLabel(name)}`)
  await demoWait(timings[runPace.value].field, expectedRun)
  const write = (text: string) => {
    assertRun(expectedRun)
    if (!control.isConnected) throw new Error('正在填写的字段已变化，演示已停止。')
    control.value = text; control.dispatchEvent(new Event('input', { bubbles: true }))
  }
  // Native number/date/select controls cannot represent intermediate strings
  // such as "19.". Show focus and a field pause, then commit one valid value.
  if (control instanceof HTMLSelectElement || control instanceof HTMLInputElement && ['number', 'date', 'datetime-local'].includes(control.type)) write(value)
  else {
    write('')
    let entered = ''
    for (const character of Array.from(value)) { await demoWait(timings[runPace.value].character, expectedRun); entered += character; write(entered) }
  }
  await demoWait(0, expectedRun)
  control.dispatchEvent(new Event('change', { bubbles: true }))
  await demoWait(timings[runPace.value].field, expectedRun)
}
async function automatic() {
  if (disposed || running.value) return
  detailOrder.value = undefined; warehouseReceipt.value = undefined; outcome.value = undefined; dismissWelcome()
  await pendingMutation; synchronizeLatest()
  if (disposed || running.value) return
  const run = ++generation; activeRun = run; running.value = true; paused.value = false; runStatus.value = '正在操作'; toolsOpen.value = false; message.value = ''; failed.value = false; errors.value = []; clearDemoTarget(); demoAction.value = '正在准备演示'
  activeTask.value = runTask.value; steps.value = []; cursor.value = 0; currentStep.value = ''
  // Bind every continuation to this run. An old awaited page transition cannot
  // borrow a new run's token after Stop followed immediately by Start.
  const click = (selector: string) => demoClick(selector, run)
  const check = async (selector: string, checked = true) => { if (node<HTMLInputElement>(selector).checked !== checked) await click(selector) }
  const fill = (name: string, value: string) => demoFill(name, value, run)
  const settle = async () => { await settlePage(); await demoWait(0, run) }
  const read = async (key: string, selector: string, description: string) => {
    await settle()
    const duration = timings[runPace.value].reading
    if (!duration) return
    const target = node<HTMLElement>(selector)
    markDemoTarget(target, `正在核对：${description} · 留时间看清结果`)
    demoReading.value = key
    try {
      await demoWait(duration, run)
      if (!target.isConnected) throw new Error('正在核对的页面已变化，演示已停止。')
    } finally {
      if (activeRun === run) demoReading.value = ''
    }
  }
  const sku = `KST-${Date.now().toString(36).toUpperCase()}`
  let taskSteps: { label: string; perform: () => void | Promise<void> }[]
  let completedOutcome: () => DemoOutcome = () => {
    const saved = state.products.find(product => product.parentSku === `${sku}-PARENT`)!
    return { task: 'product', objectId: saved.id, title: saved.title, before: '未创建', after: '在售 · 2 个子 SKU', facts: [{ label: '父 SKU', value: saved.parentSku }, { label: '子 SKU', value: saved.variants.filter(variant => !variant.deleted).map(variant => variant.sku).join(' / ') }, { label: '配送模板', value: state.templates.find(template => template.id === saved.offer.templateId)?.name || '未分配' }], page: 'inventory' }
  }
  if (runTask.value === 'product') taskSteps = [
    { label: '打开课程地图中的 Amazon 入口', perform: async () => { navigate('course'); await settle(); await click('[data-area="amazon"]') } },
    { label: '进入亚马逊卖家后台', perform: () => click('[data-action="enter-seller"]') },
    { label: '从目录菜单打开添加商品', perform: async () => { await click('[data-action="menu-目录"]'); await settle(); await click('[data-action="menu-item-添加商品"]') } },
    { label: '搜索并选择商品类目', perform: async () => { await fill('categorySearch', '收纳袋'); await settle(); await click('[data-category="home-storage"]') } },
    { label: '填写重要信息与父 SKU', perform: async () => { await fill('title', '轻旅便携旅行收纳袋'); await fill('brand', '旅序'); await fill('manufacturer', '旅序用品工作室（虚构）'); await fill('partNumber', 'TR-2026'); await fill('parentSku', `${sku}-PARENT`) } },
    { label: '添加两个变体', perform: async () => { await click('[data-action="tab-variants"]'); await settle(); await fill('variantTerms', '海蓝色 / M, 墨绿色 / L'); await click('[data-action="add-variants"]') } },
    { label: '填写每个子 SKU 的价格与数量', perform: async () => { await fill('variantSku-0', `${sku}-BLUE`); await fill('variantCode-0', `DEMO${sku}01`); await fill('variantPrice-0', '19.9'); await fill('variantQuantity-0', '50'); await fill('variantSku-1', `${sku}-GREEN`); await fill('variantCode-1', `DEMO${sku}02`); await fill('variantPrice-1', '21.9'); await fill('variantQuantity-1', '30') } },
    { label: '选择配送设置', perform: async () => { await click('[data-action="tab-offer"]'); await settle(); await fill('templateId', draft.value.offer.templateId) } },
    { label: '填写商品重量', perform: async () => { await click('[data-action="tab-compliance"]'); await settle(); await fill('weight', '0.25') } },
    { label: '填写描述与搜索关键字', perform: async () => { await click('[data-action="tab-description"]'); await settle(); await fill('feature-0', '轻量折叠，分区收纳'); await fill('description', '轻量折叠设计，两种颜色与尺寸。此商品用于本机样例操作。'); await click('[data-action="tab-keywords"]'); await settle(); await fill('searchTerms-0', '旅行 收纳袋 便携') } },
    { label: '保存并完成', perform: () => click('[data-action="save-product-complete"]') },
    { label: '在库存中核对两个子 SKU', perform: async () => { const saved = state.products.find(product => product.parentSku === `${sku}-PARENT`); if (!saved || saved.status !== 'active' || saved.variants.filter(variant => !variant.deleted).length !== 2 || !root.value?.textContent?.includes(`${sku}-GREEN`)) throw new Error(message.value || '库存未回读到两个子 SKU。'); await read('product-saved', `[data-parent="${saved.id}"]`, '在售商品与两个子 SKU') } },
  ]
  else if (runTask.value === 'shipping') {
    const item = state.orders.find(item => item.id === demoOrder.value && item.status === '未发货')
    if (!item) { result('当前没有未发货样例订单，可重置样例。', true); running.value = false; runStatus.value = '未完成'; demoAction.value = ''; toolsOpen.value = true; activeRun = undefined; return }
    const itemId = item.id
    // A stopped run (or a manual selection) can leave checked warehouse rows.
    // This run owns only its selected order, never a previous batch selection.
    warehouseSelected.value = []
    const currentOrder = () => { const latest = state.orders.find(order => order.id === itemId); if (!latest) throw new Error('该样例订单已不存在，自动操作已停止。'); return latest }
    let chosenCarrier = item.carrier
    const originalStage = item.warehouseStage
    completedOutcome = () => { const saved = currentOrder(); return { task: 'shipping', objectId: saved.id, title: orderProduct(saved)?.title || '订单发货', before: `未发货 · ${originalStage}`, after: '已出库 · 已确认发货', facts: [{ label: '承运人', value: saved.carrier }, { label: '运单号', value: saved.tracking }, { label: '配送服务', value: saved.shippingService || '标准' }, { label: '目的国', value: saved.country }], page: 'orders', params: { focus: saved.id } } }
    taskSteps = [
      { label: '管理订单筛选未发货，定位所选订单', perform: async () => { navigate('orders'); await settle(); await click('[data-action="order-filter-未发货"]'); await settle(); node(`[data-order-row="${itemId}"]`) } },
      { label: '从订单商品详情读取 ShippingWeight', perform: async () => { await click(`[data-order-details="${itemId}"]`); await settle(); const weight = orderWeight(currentOrder()), valid = weight > 0 && node('[data-testid="order-shipping-weight"]').textContent?.includes(String(weight)); if (!valid) throw new Error('商品缺少有效配送重量，没有自动生成报价或发货。'); await read('shipping-weight', '[data-testid="order-shipping-weight"]', '同一订单商品的配送重量'); await click('[data-action="close-order-details"]') } },
      { label: '打开原订单确认页，读取目的国', perform: async () => { await click(`[data-order-ship="${itemId}"]`); await settle(); if (!node('[data-testid="shipment-country"]').textContent?.includes(currentOrder().country)) throw new Error('当前确认页不是所选订单的目的国。'); await read('shipping-country', '[data-testid="shipment-country"]', '所选订单的目的国') } },
      ...(item.warehouseStage === '已出库' ? [{ label: '读取已有发货承运人，不重复出库', perform: () => { if (!chosenCarrier || !currentOrder().tracking) throw new Error('已有出库记录缺少承运人或运单号，请人工核对。') } }] : [{ label: '计算样例运费，选择最低可用渠道', perform: async () => { await click('[data-action="open-shipping-calculator"]'); await settle(); await fill('quoteCountry', currentOrder().country); await fill('quoteWeight', String(orderWeight(currentOrder()))); await click('[data-action="calculate-shipping"]'); await settle(); const cheapest = shippingQuotes.value[0]; if (!cheapest || cheapest.totalCny <= 0) throw new Error('没有正价可用样例报价，未进入仓库发货。'); await read('shipping-quotes', '.v2-quote-summary', '目的国、计费重量与可用样例渠道'); await click(`[data-quote-carrier="${cheapest.carrier}"]`); chosenCarrier = cheapest.carrier; await read('shipping-choice', `[data-testid="shipping-quotes"] tr:has([data-quote-carrier="${cheapest.carrier}"]) .v2-quote-total`, `已选择 ${cheapest.carrier}，最低可用样例价`); await click('[data-action="close-shipping-calculator"]') } }]),
      { label: '从课程地图进入国内仓库', perform: async () => { await click('[data-action="go-course"]'); await settle(); await click('[data-area="warehouse"]') } },
      ...(['待分拣', '待打包', '待出库'] as const).filter(stage => item.warehouseStage !== '已出库' && ['待分拣', '待打包', '待出库'].indexOf(stage) >= ['待分拣', '待打包', '待出库'].indexOf(item.warehouseStage)).map(stage => ({ label: `${stage === '待分拣' ? '勾选本订单，分拣并确认结果' : stage === '待打包' ? '勾选本订单，打包并确认结果' : '勾选本订单，选择承运人并发货'}`, perform: async () => { await click(`[data-stage="${stage}"]`); await settle(); await click(`[data-warehouse-select="${itemId}"]`); if (stage === '待出库') await fill('carrier', chosenCarrier); await click('[data-action="warehouse-batch"]'); await pendingMutation; await settle(); if (!warehouseReceipt.value?.ids.includes(itemId)) throw new Error(message.value || '仓库操作没有生成同一订单的结果。'); await read(stage === '待分拣' ? 'warehouse-pick' : stage === '待打包' ? 'warehouse-pack' : 'warehouse-dispatch', '[role="dialog"][aria-label="仓库操作结果"]', `本订单已转入${warehouseReceipt.value.stage}`); await click('[data-action="warehouse-result-confirm"]'); await settle(); if (currentOrder().warehouseStage !== (stage === '待分拣' ? '待打包' : stage === '待打包' ? '待出库' : '已出库')) throw new Error('仓库订单状态回读不一致。') } })),
      { label: '查看发货记录取得运单', perform: async () => { await click('[data-stage="已出库"]'); await settle(); if (!node<HTMLElement>(`[data-tracking="${itemId}"]`).textContent?.includes(currentOrder().tracking)) throw new Error('本地发货记录未回读。'); await read('shipping-tracking', `[data-tracking="${itemId}"]`, '同一订单的出库运单号') } },
      { label: '回原订单填写标准服务、承运人与运单', perform: async () => { await click('[data-action="return-shipment"]'); await settle(); await fill('shipmentService', '标准'); await fill('shipmentCarrier', currentOrder().carrier); await fill('tracking', currentOrder().tracking); await read('shipping-confirmation', '[name="tracking"]', '确认提交前的承运人、服务与运单号') } },
      { label: '确认发货，再回已发货列表核对', perform: async () => { await click('[data-action="confirm-shipment"]'); await pendingMutation; await settle(); await click('[data-action="order-filter-已发货"]'); await settle(); const row = node(`[data-order-row="${itemId}"]`), latest = currentOrder(); if (latest.status !== '已发货' || latest.shippingService !== '标准' || !row.textContent?.includes(latest.tracking) || !row.textContent?.includes(latest.carrier)) throw new Error('已发货列表未回读到同一订单的配送结果。'); await read('shipping-saved', `[data-order-row="${itemId}"] td:nth-child(5)`, '原订单已发货，承运人与运单回读一致') } },
    ]
  }
  else if (runTask.value === 'template') {
    const name = `旅行配送 ${sku}`
    const savedTemplate = () => state.templates.find(template => template.name === name)
    completedOutcome = () => { const saved = savedTemplate()!; return { task: 'template', objectId: saved.id, title: saved.name, before: '未创建', after: '已保存 · 2 条配送规则', facts: [{ label: '国家', value: '美国 / 英国 / 德国' }, { label: '计费单位', value: '每单 + 每 lb' }, { label: '下一步', value: '可设为默认或分配到商品' }], page: 'templates', params: { focus: saved.id } } }
    taskSteps = [
      { label: '打开设置中的配送模板', perform: async () => { navigate('seller'); await settle(); await click('[data-action="open-template-settings"]') } },
      { label: '创建一个配送模板', perform: async () => { await click('[data-action="template-create"]'); await settle(); await fill('templateName', name) } },
      { label: '设置美国标准配送与单位运费', perform: async () => { await fill('templateRuleBase0', '3.5'); await fill('templateRulePerUnit0', '1.5'); await fill('templateRuleUnit0', 'lb') } },
      { label: '添加英国和德国的国际配送', perform: async () => { await click('[data-action="template-add-international"]'); await settle(); await click('[data-template-rule="1"] [data-action="template-countries"]'); await settle(); await check('[name="templateCountries"][value="英国"]'); await check('[name="templateCountries"][value="德国"]'); await click('[data-action="template-country-confirm"]') } },
      { label: '保存并回读配送规则', perform: async () => { await click('[data-action="template-save"]'); await pendingMutation; await settle(); const saved = savedTemplate(); if (!saved || !state.templateData!.details.find(detail => detail.templateId === saved.id && detail.rules.length === 2)) throw new Error(message.value || '模板未保存。') } },
      { label: '从列表重新打开并核对模板', perform: async () => { await click(`[data-action="template-select"][data-template-id="${savedTemplate()!.id}"]`); await settle(); const rules = Array.from(root.value?.querySelectorAll('[data-testid="template-rule-readback"]') || []); if (!rules.some(rule => rule.textContent?.includes('德国'))) throw new Error('模板详情未回读到国际配送规则。'); await read('template-saved', '[data-testid="template-detail-name"]', '新模板及已保存配送规则') } },
    ]
  }
  else if (runTask.value === 'fba') {
    const row = inventoryRows(state).find(({ product, variant }) => product.status === 'active' && variant.status === 'active' && variant.delivery === 'FBM' && variant.sku.trim())
    if (!row) { running.value = false; runStatus.value = '未完成'; result('没有可转换的卖家配送子 SKU，可先发布商品或重置样例。', true); activeRun = undefined; demoAction.value = ''; toolsOpen.value = true; return }
    const variantId = row.variant.id, selectedSku = row.variant.sku
    completedOutcome = () => { const saved = fbaBalances.value.get(variantId)!; return { task: 'fba', objectId: variantId, title: saved.product.title, before: '卖家自行配送', after: '亚马逊配送', facts: [{ label: '子 SKU', value: selectedSku }, { label: 'FNSKU', value: saved.fnsku }, { label: '到仓可售', value: `${saved.available} 件（尚未入库）` }], page: 'fba', params: { focus: variantId } } }
    taskSteps = [
      { label: '打开 FBA 库存与转换入口', perform: async () => { fbaSelection.value = []; openFba(); await settle(); await click('[data-action="fba-show-inventory"]'); await settle(); await click('[data-action="fba-new-conversion"]') } },
      { label: '勾选一个卖家配送子 SKU', perform: async () => { await settle(); await check(`[name="fbaSku"][value="${variantId}"]`); await click('[data-action="fba-selection-confirm"]') } },
      { label: '确认仅转换配送方式', perform: () => click('[data-action="fba-only-convert"]') },
      { label: '填写电池与危险品信息', perform: async () => { await settle(); await click(`[data-action="fba-hazard-open"][data-fba-variant="${variantId}"]`); await settle(); await check('[name="fbaBattery"][value="no"]'); await check('[name="fbaHazardous"][value="no"]'); await click('[data-action="fba-hazard-save"]') } },
      { label: '保存并转换为亚马逊配送', perform: () => click('[data-action="fba-save-conversion"]') },
      { label: '回读同一子 SKU 的 FNSKU 与 FBA 状态', perform: async () => { await settle(); const saved = fbaBalances.value.get(variantId); if (!saved || saved.variant.delivery !== 'FBA' || !node(`[data-fba-row="${variantId}"]`).textContent?.includes(saved.fnsku)) throw new Error(message.value || 'FBA 库存未回读到同一子 SKU。'); await read('fba-saved', `[data-fba-row="${variantId}"] [data-testid="fba-fnsku"]`, '同一子 SKU 的 FNSKU，转换不代表到仓') } },
    ]
  }
  else {
    const candidate = advertisingCandidates(state).find(item => item.delivery === 'FBA') || advertisingCandidates(state)[0]
    if (!candidate) { running.value = false; runStatus.value = '未完成'; result('当前没有在售子商品，请先保存并完成商品。', true); activeRun = undefined; demoAction.value = ''; toolsOpen.value = true; return }
    const name = `旅行推广 ${sku}`
    const savedCampaign = () => state.advertising!.campaigns.find(campaign => campaign.name === name)
    completedOutcome = () => { const saved = savedCampaign()!; return { task: 'advertising', objectId: saved.id, title: saved.name, before: '未创建', after: '已安排 · 自动投放', facts: [{ label: '广告组', value: saved.groupName }, { label: '子 SKU', value: candidate.sku }, { label: '子 ASIN', value: candidate.asin }, { label: '预算 / 竞价', value: `$${saved.budgetUsd}/日 · $${saved.defaultBidUsd}` }], page: 'advertising', params: { focus: saved.id } } }
    taskSteps = [
      { label: '打开广告活动管理', perform: async () => { navigate('seller'); await settle(); await click('[data-action="menu-广告"]'); await settle(); await click('[data-action="menu-item-广告活动管理"]') } },
      { label: '创建商品推广活动', perform: async () => { await settle(); await click('[data-action="ad-create"]'); await settle(); await click('[data-action="ad-continue"]') } },
      { label: '填写广告组并添加子商品', perform: async () => { await settle(); await fill('adGroupName', `旅行广告组 ${sku}`); await fill('adDeliveryFilter', candidate.delivery); await fill('adProductSearch', candidate.sku); await settle(); await click(`[data-action="ad-add-product"][data-ad-product="${candidate.variantId}"]`) } },
      { label: '选择自动投放和默认竞价', perform: async () => { await check('[name="adTargeting"][value="automatic"]'); await fill('adDefaultBid', '0.53') } },
      { label: '填写活动名称和每日预算', perform: async () => { await fill('adCampaignName', name); await fill('adBudget', '10') } },
      { label: '保存并安排广告活动', perform: () => click('[data-action="ad-launch"]') },
      { label: '回读广告组与 SKU / ASIN 关联', perform: async () => { await settle(); const saved = savedCampaign(); if (!saved || saved.status !== 'scheduled' || saved.products.length !== 1 || saved.products[0]?.variantId !== candidate.variantId || !node('[data-testid="ad-product-details"]').textContent?.includes(candidate.asin)) throw new Error(message.value || '广告组详情未回读到同一子商品。'); await read('advertising-saved', '[data-testid="ad-readback-bid"]', '已保存广告组的默认竞价与子商品关联') } },
    ]
  }
  steps.value = taskSteps.map(step => step.label); cursor.value = 0
  try {
    for (let index = 0; index < taskSteps.length; index++) {
      await demoWait(0, run)
      synchronizeLatest()
      if (run !== generation) return
      currentStep.value = taskSteps[index]!.label; cursor.value = index; await taskSteps[index]!.perform(); await pendingMutation; await settle()
      if (run !== generation) return
      if (failed.value || errors.value.length) throw new Error(message.value || '字段校验没有通过。')
      clearDemoTarget(); demoAction.value = '这一步已完成，核对当前页面后再继续'
      await demoWait(timings[runPace.value].step, run)
      cursor.value = index + 1
    }
    synchronizeLatest()
    if (run === generation) {
      outcome.value = completedOutcome()
      recentlySavedProductId.value = outcome.value.task === 'product' ? outcome.value.objectId : ''
      running.value = false; runStatus.value = '已完成，保存状态核对通过'; cursor.value = taskSteps.length; toolsOpen.value = true
    }
  } catch (error) { if (run === generation) { running.value = false; runStatus.value = '未完成'; toolsOpen.value = true; result(error instanceof Error ? error.message : '样例操作未完成。', true) } }
  finally { if (activeRun === run) { activeRun = undefined; clearDemoTarget(); demoAction.value = '' } }
}
let dialogReturnFocus: HTMLElement | null = null
const modalVisible = computed(() => portalOpen.value || !!boundary.value || resetOpen.value || reloadOpen.value || !!detailOrder.value || !!warehouseReceipt.value)
watch([portalOpen, boundary, resetOpen, reloadOpen, detailOrder, warehouseReceipt], async () => {
  if (modalVisible.value) {
    if (!dialogReturnFocus && document.activeElement instanceof HTMLElement) dialogReturnFocus = document.activeElement
    await nextTick()
    const dialogs = root.value?.querySelectorAll<HTMLElement>('[role="dialog"]')
    dialogs?.[dialogs.length - 1]?.querySelector<HTMLElement>('button, input, select, a[href]')?.focus()
  } else { dialogReturnFocus?.focus(); dialogReturnFocus = null }
})
function dialogKeyboard(event: KeyboardEvent) {
  if (toolsOpen.value && event.target instanceof Element && event.target.closest('.kst-demo-panel')) return
  if (!modalVisible.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    if (detailOrder.value) detailOrder.value = undefined
    else if (warehouseReceipt.value) warehouseReceipt.value = undefined
    else if (boundary.value || resetOpen.value || reloadOpen.value) { boundary.value = ''; resetOpen.value = false; reloadOpen.value = false }
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
function dismissMenu(event: MouseEvent) { if (!(event.target instanceof Element) || !event.target.closest('.v2-nav-entry')) closeMenu() }
function closeExperience() { stop(); disposed = true; emit('close') }
onBeforeUnmount(() => {
  disposed = true; generation++; activeRun = undefined; running.value = false; paused.value = false
  clearDemoTarget(); dockResizeObserver?.disconnect()
  window.removeEventListener('resize', updateDockClearance)
  window.removeEventListener('scroll', updateDockClearance, true)
  window.removeEventListener('storage', storageChanged)
})
</script>

<template>
  <div
    ref="root"
    class="v2-experience"
    :class="{ 'is-embedded': props.embedded, 'is-demo-paused': paused, 'has-demo-controls': !toolsOpen && (props.embedded || running || (runTask === activeTask && steps.length > 0)) }"
    :style="{ '--v2-demo-dock-clearance': `${dockClearance}px` }"
    data-testid="simulation"
    :data-demo-reading="demoReading || undefined"
    :data-embedded-page="props.embedded ? page : undefined"
    @keydown="dialogKeyboard"
    @click="dismissMenu"
    @scroll="props.embedded && updateDockClearance()"
  >
    <div class="v2-experience-strip">
      <div class="v2-demo-identity">
        <img
          class="v2-demo-brand-logo"
          :src="kstLogo"
          alt="课赛通 KST"
        ><span><strong>模拟体验</strong><small>{{ props.embedded ? '本次操作会保留，退出后重新开始' : temporary ? '临时体验，刷新可能不保留' : '本机样例 · 不影响真实平台' }}</small></span>
      </div>
      <div class="v2-demo-entry-links">
        <button
          data-action="go-course"
          @click="navigate('course')"
        >
          课程地图
        </button>
        <button
          v-if="page==='shipment' && order"
          data-action="open-shipping-calculator"
          @click="calculatorOpen=true; toolsOpen=false"
        >
          运费计算
        </button>
        <button
          class="v2-demo-entry"
          :aria-expanded="toolsOpen"
          data-action="open-tools"
          @click="toolsOpen = !toolsOpen; calculatorOpen=false; dismissWelcome()"
        >
          <span aria-hidden="true">▶</span> 一键演示
        </button>
        <button @click="resetOpen = true">
          重置样例
        </button>
        <button
          v-if="props.embedded"
          class="kst-home-link"
          type="button"
          data-action="close-embedded-experience"
          @click="closeExperience"
        >
          收起体验
        </button>
        <RouterLink
          v-else
          to="/"
          class="kst-home-link"
          aria-label="返回课赛通官网"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          ><path d="m12 5-7 7 7 7M5 12h14" /></svg><span>返回官网</span>
        </RouterLink>
      </div>
    </div>
    <section
      v-if="welcome && !running"
      class="kst-demo-welcome"
      aria-label="首次体验引导"
    >
      <div><strong>从一件商品、一笔订单开始</strong><p>自己操作页面，或展开工具栏看课赛通逐步填写、保存，再核对结果。</p></div>
      <div class="kst-demo-welcome-actions">
        <button
          data-action="welcome-manual"
          @click="dismissWelcome()"
        >
          自己操作
        </button><button
          data-action="welcome-product"
          @click="prepareTask('product')"
        >
          看自动上架
        </button><button
          data-action="welcome-shipping"
          @click="prepareTask('shipping')"
        >
          看自动发货
        </button>
      </div>
      <button
        class="kst-demo-welcome-dismiss"
        aria-label="关闭首次体验引导"
        @click="dismissWelcome()"
      >
        ×
      </button>
    </section>
    <V2CourseMap
      v-if="page === 'course'"
      :published-count="state.products.filter(p => p.status === 'active').length"
      :order-count="state.orders.filter(o => o.status === '已发货').length"
      @open="courseOpen"
    />
    <template v-else-if="page !== 'warehouse'">
      <header class="v2-seller-header">
        <button
          class="v2-seller-logo"
          @click="navigate('seller')"
        >
          seller <b>central</b><small>美国站 ▾</small>
        </button>
        <form
          class="v2-header-search"
          @submit.prevent="query = queryInput; navigate('inventory')"
        >
          <input
            v-model="queryInput"
            aria-label="搜索商品或 SKU"
            placeholder="搜索"
          ><button aria-label="搜索商品">
            ⌕
          </button>
        </form>
        <span class="v2-company-label">旅序用品工作室 <small>美国 ▾</small></span>
        <div class="v2-quick-nav">
          <button @click="boundary = '买家消息不在本轮样板内。'">
            买家消息
          </button><button @click="prepareTask(recommendedTask(page))">
            帮助
          </button><div class="v2-nav-entry v2-settings-entry">
            <button
              data-action="open-template-settings"
              @click="navigate('templates')"
            >
              设置 ▾
            </button>
          </div>
        </div>
      </header>
      <nav
        class="v2-seller-nav"
        aria-label="卖家后台主导航"
        @keydown.esc="closeMenu()"
      >
        <div
          v-for="entry in menus"
          :key="entry.name"
          class="v2-nav-entry"
          @mouseenter="hoverMenu(entry.name)"
          @mouseleave="leaveMenu()"
        >
          <button
            :data-action="`menu-${entry.name}`"
            :aria-expanded="menu === entry.name"
            @click="openMenu(entry.name)"
          >
            {{ entry.name }}
          </button><div
            v-if="menu === entry.name"
            class="v2-nav-menu"
          >
            <button
              v-for="item in entry.items"
              :key="item"
              :data-action="`menu-item-${item}`"
              :disabled="excluded.has(item)"
              :title="excluded.has(item) ? '已明确排除，本轮不展开' : ''"
              @click="menuAction(item)"
            >
              {{ item }}
            </button>
          </div>
        </div>
      </nav>
      <main class="v2-seller-content">
        <div
          v-if="message && message !== editConflict && (failed || !['templates','fba','advertising'].includes(page))"
          class="v2-message"
          :class="{error: failed}"
          role="status"
          data-testid="form-result"
        >
          {{ message }}
        </div>
        <div
          v-if="editConflict"
          class="v2-message error"
          role="alert"
          data-testid="edit-conflict"
        >
          <p>{{ editConflict }}</p><button
            class="v2-button"
            data-action="reload-latest"
            @click="reloadOpen = true"
          >
            重新加载最新样例
          </button>
        </div>
        <template v-if="page === 'seller'">
          <div class="v2-dashboard-heading">
            <h1>卖家中心</h1><span>欢迎，旅序用品工作室</span>
          </div>
          <div class="v2-dashboard">
            <section>
              <h2>您的订单</h2><div><b>{{ state.orders.filter(o => o.status === '未发货').length }}</b> 待处理订单</div><button
                class="v2-link"
                @click="navigate('orders')"
              >
                查看管理订单
              </button>
            </section><section>
              <h2>管理商品</h2><p>{{ state.products.filter(productActive).length }} 个在售父商品 · {{ inventoryRows(state).length }} 个子 SKU</p><button
                class="v2-link"
                data-action="nav-inventory"
                @click="navigate('inventory')"
              >
                管理库存
              </button><button
                class="v2-link"
                @click="navigate('category')"
              >
                添加商品
              </button>
            </section><section><h2>存款方式</h2><p>此处为独立本地样例，未连接支付、结算或真实账户。</p><span class="v2-muted">没有真实资金变动</span></section>
          </div>
          <section class="v2-dashboard-notice">
            <h2>本轮可验收的操作</h2><p>从目录选择类目，编辑八个商品分页和多行变体，保存后在库存展开核对子 SKU。订单可经过国内仓库分拣、打包、发货，再回填运单。</p><button
              class="v2-button"
              @click="navigate('inventory')"
            >
              进入管理库存
            </button>
          </section>
        </template>
        <template v-else-if="page === 'inventory'">
          <nav
            class="v2-inventory-tabs"
            aria-label="库存标签"
          >
            <button
              :class="{active:inventoryTab === 'all'}"
              @click="activateTab('all')"
            >
              所有库存
            </button><button @click="activateTab('pricing')">
              管理定价
            </button><button
              :class="{active:inventoryTab === 'fba'}"
              @click="activateTab('fba')"
            >
              亚马逊库存
            </button><button @click="activateTab('shipments')">
              货件处理进度
            </button><button
              v-if="inventoryTab === 'draft'"
              class="active"
            >
              草稿
            </button>
          </nav>
          <div class="v2-inventory-heading">
            <h1>{{ inventoryTab === 'fba' ? '管理亚马逊库存' : inventoryTab === 'draft' ? '补全您的草稿' : '管理库存' }}</h1><div>
              <button
                class="v2-button"
                @click="selected.length ? openProduct(state.products.find(p => p.variants.some(v => selected.includes(v.id)))) : boundary = '先勾选一个商品的子 SKU，再进入编辑页添加变体。'"
              >
                添加一个商品变体
              </button><button
                class="v2-button"
                data-action="new-product"
                @click="navigate('category')"
              >
                添加新商品
              </button>
            </div>
          </div>
          <section
            v-if="recentlySavedProduct"
            class="v2-publish-confirmation"
            data-testid="product-publish-result"
            aria-label="已发布商品"
          >
            <div>
              <span class="v2-publish-confirmation-label">商品已发布到本机样例库存</span>
              <strong>{{ recentlySavedProduct.title }}</strong>
              <p>
                父 SKU：{{ recentlySavedProduct.parentSku }} ·
                {{ recentlySavedProduct.variants.filter(variant => !variant.deleted).length }} 个子 SKU
              </p>
            </div>
            <button
              class="v2-button v2-dark"
              type="button"
              @click="showPublishedProduct"
            >
              展开查看商品
            </button>
          </section>
          <form
            class="v2-inventory-tools"
            @submit.prevent="query = queryInput"
          >
            <select
              v-model="bulkAction"
              aria-label="批量操作"
            >
              <option value="">
                应用于 {{ selected.length }} 件选定商品
              </option><option value="FBA">
                转换为亚马逊配送
              </option><option value="FBM">
                转换为卖家自行配送
              </option><option value="inactive">
                停售
              </option><option value="active">
                出售
              </option>
            </select><button
              class="v2-button"
              type="button"
              @click="applyBulk"
            >
              应用
            </button><input
              v-model="queryInput"
              type="search"
              name="inventorySearch"
              aria-label="搜索 SKU、标题、ISBN、ASIN"
              placeholder="搜索 SKU、标题、ISBN、ASIN"
            ><button
              class="v2-button v2-dark"
              type="submit"
            >
              搜索
            </button><span>{{ visibleGroups.length }} 件商品</span><button
              v-if="query"
              class="v2-link"
              type="button"
              @click="query = ''; queryInput = ''"
            >
              清除搜索
            </button>
          </form>
          <div class="v2-filter-bar">
            <span class="v2-muted">筛选条件：</span><fieldset>
              <legend>商品状态：</legend><label><input
                v-model="statusFilter"
                type="radio"
                value="all"
              >所有</label><label><input
                v-model="statusFilter"
                type="radio"
                value="active"
              >在售</label><label><input
                v-model="statusFilter"
                type="radio"
                value="inactive"
              >不可售</label>
            </fieldset><fieldset>
              <legend>配送类型：</legend><label><input
                v-model="deliveryFilter"
                type="radio"
                value="all"
              >所有</label><label><input
                v-model="deliveryFilter"
                type="radio"
                value="FBA"
              >亚马逊</label><label><input
                v-model="deliveryFilter"
                type="radio"
                value="FBM"
              >卖家</label>
            </fieldset><label>价格高于：$ <input
              v-model="minPrice"
              class="v2-price-filter"
              type="number"
              min="0"
              aria-label="价格高于"
              placeholder="0.00"
            ></label><label>价格低于：$ <input
              v-model="maxPrice"
              class="v2-price-filter"
              type="number"
              min="0"
              aria-label="价格低于"
              placeholder="0.00"
            ></label>
          </div>
          <div
            class="v2-table-scroll"
            aria-label="库存表格可横向滚动"
          >
            <table class="v2-inventory-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="选择当前页全部子 SKU"
                      :checked="allSelected"
                      @change="selectAll(($event.target as HTMLInputElement).checked)"
                    >
                  </th><th>状态</th><th>图片</th><th>SKU &amp; 状况</th><th>商品名称 &amp; ASIN/UPC</th><th>创建日期 &amp; 更新时间</th><th v-if="inventoryTab === 'fba'">
                    FNSKU
                  </th><th>可售</th><th>费用预览</th><th>价格 + 运费</th><th>操作</th>
                </tr>
              </thead><tbody>
                <template
                  v-for="group in pagedGroups"
                  :key="group.product.id"
                >
                  <tr
                    class="v2-parent-row"
                    :data-parent="group.product.id"
                  >
                    <td>
                      <button
                        :aria-label="`${expanded.includes(group.product.id) ? '收起' : '展开'} ${group.product.title} 的变体`"
                        :aria-expanded="expanded.includes(group.product.id)"
                        class="v2-expand"
                        @click="toggleGroup(group.product.id)"
                      >
                        {{ expanded.includes(group.product.id) ? '▾' : '▸' }}
                      </button>
                    </td><td><span :class="productActive(group.product) ? 'v2-active' : 'v2-muted'">{{ productActive(group.product) ? '在售' : group.product.status === 'draft' ? '草稿' : '不可售' }}</span></td><td>
                      <V2ProductImage
                        :title="group.product.title"
                        :image="group.product.images[0]"
                      />
                    </td><td>
                      <button
                        class="v2-link"
                        @click="openProduct(group.product)"
                      >
                        {{ group.product.parentSku }}
                      </button><small>父项 · {{ group.variants.length }} 个变体</small>
                    </td><td>
                      <button
                        class="v2-link v2-title-link"
                        @click="openProduct(group.product)"
                      >
                        {{ group.product.title }}
                      </button><small>{{ group.product.asin || '尚未生成本地编码' }}</small><button
                        class="v2-link"
                        @click="toggleGroup(group.product.id)"
                      >
                        {{ expanded.includes(group.product.id) ? '收起变体' : '查看变体' }}
                      </button>
                    </td><td>{{ group.product.createdAt.slice(0,10) }}<small>本机样例</small></td><td v-if="inventoryTab === 'fba'">
                      —
                    </td><td>{{ group.variants.reduce((total,v) => total+(inventoryTab === 'fba' ? (fbaBalances.get(v.id)?.available || 0) : v.quantity),0) }}</td><td class="v2-muted">
                      —
                    </td><td>{{ group.variants.length ? '$' + Math.min(...group.variants.map(v=>v.price)).toFixed(2) : '—' }}<small>{{ state.templates.find(t=>t.id===group.product.offer.templateId)?.name }}</small></td><td>
                      <button
                        class="v2-button"
                        :data-edit="group.product.id"
                        @click="openProduct(group.product)"
                      >
                        编辑
                      </button>
                    </td>
                  </tr><template v-if="expanded.includes(group.product.id)">
                    <tr
                      v-for="variant in group.variants"
                      :key="variant.id"
                      class="v2-variant-row"
                      :data-variant="variant.id"
                    >
                      <td>
                        <input
                          v-model="selected"
                          type="checkbox"
                          :aria-label="`选择 ${variant.sku}`"
                          :value="variant.id"
                        >
                      </td><td>{{ group.product.status === 'active' && variant.status === 'active' ? '在售' : '不可售' }}</td><td>
                        <V2ProductImage
                          :title="group.product.title"
                          :image="variant.image || group.product.images[0]"
                          :color="variant.color"
                        />
                      </td><td>
                        <button
                          class="v2-link"
                          @click="openProduct(group.product)"
                        >
                          {{ variant.sku }}
                        </button><small>{{ variant.condition }}</small>
                      </td><td><span>{{ variant.term }}</span><small>{{ variant.code }}</small><small>{{ variant.delivery === 'FBA' ? '亚马逊配送' : '卖家自行配送' }}</small></td><td>{{ group.product.createdAt.slice(0,10) }}</td><td v-if="inventoryTab === 'fba'">
                        {{ fbaBalances.get(variant.id)?.fnsku }}
                      </td><td>
                        <span v-if="inventoryTab === 'fba'">{{ fbaBalances.get(variant.id)?.available || 0 }}</span><input
                          v-else
                          class="v2-inline-number"
                          type="number"
                          min="0"
                          :value="variant.quantity"
                          :aria-label="`${variant.sku} 可售数量`"
                          @change="updateInline(variant,'quantity',$event)"
                        >
                      </td><td
                        class="v2-muted"
                        title="没有真实费率或收费"
                      >
                        —
                      </td><td>
                        $ <input
                          class="v2-inline-number"
                          type="number"
                          min="0"
                          step=".01"
                          :value="variant.price"
                          :aria-label="`${variant.sku} 价格`"
                          @change="updateInline(variant,'price',$event)"
                        ><small>{{ state.templates.find(t=>t.id===group.product.offer.templateId)?.name }}</small>
                      </td><td>
                        <select
                          :aria-label="`${variant.sku} 操作`"
                          @change="rowAction(group.product,variant,$event)"
                        >
                          <option value="">
                            -操作-
                          </option><option value="edit">
                            编辑
                          </option><option value="inactive">
                            停售
                          </option><option value="active">
                            出售
                          </option><option value="convert">
                            转换为亚马逊配送
                          </option>
                        </select>
                      </td>
                    </tr>
                  </template>
                </template><tr v-if="!pagedGroups.length">
                  <td
                    :colspan="inventoryTab === 'fba' ? 11 : 10"
                    class="v2-empty"
                  >
                    没有符合条件的商品。请调整搜索或筛选条件。
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="v2-pagination">
            <span>显示 {{ visibleGroups.length ? (currentPage-1)*pageSize+1 : 0 }}–{{ Math.min(currentPage*pageSize,visibleGroups.length) }} 条，共 {{ visibleGroups.length }} 条父商品</span><label>每页 <select v-model="pageSize"><option :value="5">5</option><option :value="10">10</option><option :value="20">20</option></select></label><button
              class="v2-button"
              :disabled="currentPage <= 1"
              @click="currentPage--"
            >
              上一页
            </button><span>{{ currentPage }} / {{ pageCount }}</span><button
              class="v2-button"
              :disabled="currentPage >= pageCount"
              @click="currentPage++"
            >
              下一页
            </button>
          </div>
        </template>
        <TemplateWorkflow
          v-else-if="page === 'templates'"
          :key="`template-${workflowEpoch}`"
          :state="state"
          :data="state.templateData!"
          :submit="submitTemplate"
          :focus-id="route.query.focus === undefined ? undefined : String(route.query.focus)"
        />
        <FbaWorkflow
          v-else-if="page === 'fba'"
          :key="`fba-${workflowEpoch}`"
          :state="state"
          :data="state.fba!"
          :submit="submitFba"
          :selection="fbaSelection"
          :initial-mode="String(route.query.mode || '')"
          :focus-id="route.query.focus === undefined ? undefined : String(route.query.focus)"
        />
        <AdvertisingWorkflow
          v-else-if="page === 'advertising'"
          :key="`ad-${workflowEpoch}`"
          :state="state"
          :data="state.advertising!"
          :submit="submitAdvertising"
          :focus-id="route.query.focus === undefined ? undefined : String(route.query.focus)"
        />
        <template v-else-if="page === 'category'">
          <h1>添加商品</h1><section class="v2-category-panel">
            <h2>选择商品分类</h2><p>为您要销售的商品选择最合适的类别。</p><form
              class="v2-category-search"
              @submit.prevent
            >
              <input
                v-model="categorySearch"
                name="categorySearch"
                type="search"
                placeholder="搜索商品分类"
                aria-label="搜索商品分类"
              ><button
                class="v2-button v2-dark"
                type="submit"
              >
                查找分类
              </button>
            </form><div class="v2-category-path">
              所有商品类别 <span>›</span> {{ categorySearch ? '搜索结果' : '浏览分类' }}
            </div><button
              v-for="category in categoryMatches"
              :key="category.id"
              class="v2-category-item"
              :data-category="category.id"
              @click="chooseCategory(category.id)"
            >
              <span>{{ category.path }}</span><b>选择 ›</b>
            </button><p
              v-if="!categoryMatches.length"
              class="v2-empty"
            >
              没有匹配的本地类目。
            </p><p class="v2-local-note">
              本轮提供 6 个本地类目样例；不是原平台全量类目库。
            </p>
          </section>
        </template>
        <template v-else-if="page === 'product'">
          <section v-if="missingProduct">
            <h1>找不到本地商品</h1><p>该商品不存在，或尚未保存的表单已因刷新失去。其他样例数据没有改变。</p><button
              class="v2-button"
              data-action="back-to-inventory"
              @click="navigate('inventory')"
            >
              返回库存
            </button>
          </section><V2ProductEditor
            v-else
            ref="editor"
            :product="draft"
            :templates="state.templates"
            :errors="errors"
            @save="saveEdited"
            @cancel="navigate('inventory')"
          />
        </template>
        <template v-else-if="page === 'orders'">
          <h1>管理订单</h1>
          <div
            v-if="focusedOrderId"
            class="v2-message"
            :class="{ error: !state.orders.some(item => item.id === focusedOrderId) }"
            data-testid="order-result-focus"
          >
            <span>{{ state.orders.some(item => item.id === focusedOrderId) ? `正在查看订单 ${focusedOrderId} 的结果` : `找不到订单 ${focusedOrderId}` }}</span><button
              class="v2-link"
              @click="navigate('orders')"
            >
              查看所有订单
            </button>
          </div>
          <div class="v2-order-tabs">
            <button
              v-for="filter in ['all','未发货','已发货']"
              :key="filter"
              :class="{active:orderFilter===filter}"
              :data-action="`order-filter-${filter}`"
              @click="orderFilter=filter"
            >
              {{ filter==='all' ? '所有订单' : filter }} ({{ state.orders.filter(item=>filter==='all'||item.status===filter).length }})
            </button>
          </div>
          <div class="v2-table-scroll">
            <table class="v2-order-table">
              <thead><tr><th>订单日期</th><th>订单信息</th><th>商品信息</th><th>数量</th><th>订单状态</th><th>操作</th></tr></thead><tbody>
                <tr
                  v-for="item in displayedOrders"
                  :key="item.id"
                  :data-order-row="item.id"
                >
                  <td>2026-10-08<small>本机样例</small></td><td class="v2-link">
                    {{ item.id }}<small>{{ item.country }}</small>
                  </td><td>
                    <button
                      class="v2-link v2-title-link"
                      :data-order-details="item.id"
                      @click="detailOrder=item"
                    >
                      {{ orderProduct(item)?.title }}
                    </button><small>SKU：{{ orderVariant(item)?.sku }}</small><small>ASIN：{{ orderProduct(item)?.asin }}</small>
                  </td><td>{{ item.quantity }}</td><td>
                    {{ item.status }}<template v-if="item.status==='已发货'">
                      <small>{{ item.carrier }} · {{ item.shippingService || '服务未记录' }}</small><small>{{ item.tracking }}</small><small>{{ item.shippingDate }}</small>
                    </template>
                  </td><td>
                    <button
                      v-if="item.status==='未发货'"
                      class="v2-button"
                      :data-order-ship="item.id"
                      @click="openShipment(item)"
                    >
                      确认发货
                    </button><span v-else>已完成</span>
                  </td>
                </tr>
                <tr v-if="!displayedOrders.length">
                  <td
                    colspan="6"
                    class="v2-empty"
                  >
                    当前没有符合条件的订单。
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
        <template v-else-if="page === 'shipment' && order">
          <h1>确认发货</h1>
          <div class="v2-order-summary">
            <b>订单号：{{ order.id }}</b><p>{{ orderProduct(order)?.title }}</p><p>ASIN：{{ orderProduct(order)?.asin }} · SKU：{{ orderVariant(order)?.sku }} · 数量 {{ order.quantity }}</p><p>目的国家：<span data-testid="shipment-country">{{ order.country }}</span></p>
          </div>
          <form
            class="v2-shipment-form"
            @submit.prevent="confirmShipment"
          >
            <label>发货日期<input
              v-model="shipmentDate"
              name="shipmentDate"
              type="date"
              required
            ></label>
            <label>承运人<select
              v-model="shipmentCarrier"
              name="shipmentCarrier"
            ><option value="">请选择</option><option>中邮</option><option>E 邮宝</option><option>燕文</option><option>UPS</option></select></label>
            <label>配送服务<input
              v-model="shipmentService"
              name="shipmentService"
              placeholder="标准"
              required
            ></label>
            <label>快递运单号<input
              v-model="tracking"
              name="tracking"
            ></label>
            <p class="v2-local-note">
              {{ order.warehouseStage === '已出库' ? '从同一订单的仓库发货记录核对承运人、服务与运单号，再确认发货。' : '打开此页尚未发货。先完成国内仓库分拣、打包和发货，再回到此订单填写运单。' }}
            </p>
            <div>
              <button
                class="v2-button"
                type="button"
                data-action="go-warehouse"
                @click="navigate('warehouse')"
              >
                打开国内仓库
              </button><button
                class="v2-button v2-yellow"
                type="submit"
                data-action="confirm-shipment"
              >
                确认发货
              </button>
            </div>
          </form>
        </template>
        <template v-else-if="page === 'shipment'">
          <h1>订单不存在</h1><p>没有找到这个本地样例订单，其他商品与订单没有改变。</p><button
            class="v2-button"
            data-action="back-to-orders"
            @click="navigate('orders')"
          >
            返回管理订单
          </button>
        </template>
      </main>
    </template>
    <template v-else>
      <header class="v2-warehouse-header">
        <strong>国内仓库</strong><span>旅序用品工作室 · 本机样例仓库</span><button @click="navigate('course')">
          返回课程首页
        </button>
      </header>
      <nav class="v2-warehouse-nav">
        <button
          v-for="stage in ['待分拣','待打包','待出库','已出库']"
          :key="stage"
          :data-stage="stage"
          :class="{active:warehouseStage===stage}"
          @click="warehouseStage=stage; message=''"
        >
          {{ stage==='待分拣' ? '分拣产品' : stage==='待打包' ? '开始打包' : stage==='待出库' ? '立即发货' : '发货记录' }} ({{ state.orders.filter(o=>o.warehouseStage===stage).length }})
        </button>
      </nav>
      <main class="v2-warehouse-content">
        <div
          v-if="message"
          class="v2-message"
          :class="{error:failed}"
          role="status"
          data-testid="form-result"
        >
          {{ message }}
        </div>
        <h1>{{ warehouseStage==='已出库' ? '发货记录' : warehouseStage==='待出库' ? '立即发货' : warehouseStage==='待打包' ? '订单打包' : '订单分拣' }}</h1>
        <div class="v2-warehouse-toolbar">
          <label v-if="warehouseStage!=='已出库'"><input
            type="checkbox"
            aria-label="选择本页订单"
            :checked="warehouseOrders.length>0 && warehouseOrders.every(item=>warehouseSelected.includes(item.id))"
            @change="warehouseSelected=($event.target as HTMLInputElement).checked ? warehouseOrders.map(item=>item.id) : []"
          > 本页全选</label><input
            v-model="warehouseQuery"
            name="warehouseSearch"
            type="search"
            aria-label="搜索仓库订单"
            placeholder="订单号 / SKU / 商品名称"
          ><label v-if="warehouseStage==='待出库'">承运人 <select
            v-model="carrier"
            name="carrier"
          ><option value="">请选择物流公司</option><option>中邮</option><option>E 邮宝</option><option>燕文</option><option>UPS</option></select></label><button
            v-if="warehouseStage!=='已出库'"
            class="v2-button"
            data-action="warehouse-batch"
            @click="warehouseBatch()"
          >
            {{ warehouseActionLabel }} ({{ warehouseSelected.length }})
          </button>
        </div>
        <div class="v2-table-scroll">
          <table
            class="v2-order-table v2-warehouse-table"
            :class="{'is-shipped':warehouseStage==='已出库'}"
          >
            <thead>
              <tr>
                <th v-if="warehouseStage!=='已出库'">
                  选择
                </th><th>订单 ID</th><th v-if="warehouseStage==='已出库'">
                  承运人 / 快递运单号
                </th><th>图片</th><th>产品信息</th><th>状态 / 操作</th>
              </tr>
            </thead><tbody>
              <tr
                v-for="item in warehouseOrders"
                :key="item.id"
                :data-warehouse-row="item.id"
              >
                <td v-if="warehouseStage!=='已出库'">
                  <input
                    v-model="warehouseSelected"
                    type="checkbox"
                    :aria-label="`选择仓库订单 ${item.id}`"
                    :data-warehouse-select="item.id"
                    :value="item.id"
                  >
                </td><td>{{ item.id }}</td><td v-if="warehouseStage==='已出库'">
                  <strong :data-tracking="item.id">{{ item.tracking }}</strong><small>{{ item.carrier }}</small>
                </td><td>
                  <V2ProductImage
                    :title="orderProduct(item)?.title || '商品'"
                    :image="orderProduct(item)?.images[0]"
                  />
                </td><td><strong>{{ orderProduct(item)?.title }}</strong><small>SKU：{{ orderVariant(item)?.sku }}</small><small>数量：{{ item.quantity }} · 目的国家：{{ item.country }}</small><small>单件配送重量：{{ orderWeight(item) || '未填写' }} kg</small></td><td>
                  {{ item.warehouseStage }}<small v-if="warehouseStage!=='已出库'"><button
                    class="v2-button"
                    :data-warehouse-order="item.id"
                    @click="warehouseAction(item)"
                  >{{ warehouseStage==='待分拣' ? '分拣' : warehouseStage==='待打包' ? '打包' : '立即发货' }}</button></small>
                </td>
              </tr>
              <tr v-if="!warehouseOrders.length">
                <td
                  colspan="6"
                  class="v2-empty"
                >
                  当前没有{{ warehouseStage }}的匹配样例订单。
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <button
          v-if="selectedOrder"
          class="v2-button v2-return-order"
          data-action="return-shipment"
          @click="navigate('shipment',{order:selectedOrder})"
        >
          返回订单 {{ selectedOrder }} 的确认页
        </button>
      </main>
    </template>
    <aside
      v-if="page==='shipment' && order && calculatorOpen"
      class="kst-freight-panel"
      aria-label="课赛通运费计算"
    >
      <header>
        <img
          :src="kstLogo"
          alt="课赛通 KST"
        ><strong>运费计算</strong><button
          class="v2-button"
          data-action="close-shipping-calculator"
          @click="calculatorOpen=false"
        >
          收起计算
        </button>
      </header><div class="kst-freight-body">
        <ShippingQuotePanel
          :key="order.id"
          :country="order.country"
          :weight-kg="orderWeight(order)"
          :quantity="order.quantity"
          @quoted="shippingQuotes=$event; if (!$event.length) carrier=''"
          @selected="carrier=$event"
        /><p
          v-if="carrier"
          class="kst-freight-selection"
        >
          已选 {{ carrier }}，接下来在国内仓库使用此承运人。
        </p>
      </div>
    </aside>
    <div
      v-if="detailOrder"
      class="v2-modal-backdrop"
    >
      <section
        class="v2-product-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="商品详情"
      >
        <header>
          <span>商品详情</span><button
            class="v2-button"
            data-action="close-order-details"
            @click="detailOrder=undefined"
          >
            返回管理订单
          </button>
        </header><p class="v2-local-note">
          {{ orderProduct(detailOrder)?.categoryName }} › {{ orderProduct(detailOrder)?.title }}
        </p><div class="v2-detail-product">
          <V2ProductImage
            :title="orderProduct(detailOrder)?.title || '商品'"
            :image="orderProduct(detailOrder)?.images[0]"
          /><div>
            <h2>{{ orderProduct(detailOrder)?.title }}</h2><p>品牌：{{ orderProduct(detailOrder)?.brand }}</p><p class="v2-detail-price">
              $ {{ orderVariant(detailOrder)?.price.toFixed(2) }}
            </p><p>所选变体：{{ orderVariant(detailOrder)?.term }}</p><p>卖家：旅序用品工作室</p>
          </div>
        </div><h3>商品信息</h3><table class="v2-detail-info">
          <tbody>
            <tr><th>ASIN</th><td>{{ orderProduct(detailOrder)?.asin }}</td></tr><tr><th>SKU</th><td>{{ orderVariant(detailOrder)?.sku }}</td></tr><tr>
              <th>配送重量 / Shipping Weight</th><td data-testid="order-shipping-weight">
                {{ orderWeight(detailOrder) || '未填写' }} kg
              </td>
            </tr><tr><th>制造商</th><td>{{ orderProduct(detailOrder)?.manufacturer }}</td></tr>
          </tbody>
        </table><p class="v2-local-note">
          {{ orderProduct(detailOrder)?.description }}
        </p>
      </section>
    </div>
    <div
      v-if="warehouseReceipt"
      class="v2-modal-backdrop"
    >
      <section
        class="v2-small-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="仓库操作结果"
      >
        <h2>操作成功</h2><p>{{ warehouseReceipt.ids.join('、') }}<br>已转入{{ warehouseReceipt.stage }}。{{ warehouseReceipt.stage==='已出库' ? '可到发货记录核对本订单的承运人和运单号。' : '可在下一阶段核对同一订单。' }}</p><footer>
          <button
            class="v2-button v2-yellow"
            data-action="warehouse-result-confirm"
            @click="warehouseReceipt=undefined"
          >
            确定
          </button>
        </footer>
      </section>
    </div>
    <div
      v-if="portalOpen"
      class="v2-modal-backdrop"
      @click.self="portalOpen=false"
    >
      <section
        class="v2-portal"
        role="dialog"
        aria-modal="true"
        aria-label="Amazon 入口"
      >
        <header>
          <span>Amazon</span><button
            aria-label="关闭 Amazon 入口"
            @click="portalOpen=false"
          >
            ×
          </button>
        </header><div class="v2-portal-options">
          <button @click="boundary='选品工具由真实工具负责人开发，不在本轮模拟样板内。'">
            <V2PortalScene kind="selection" /><strong>选品工具</strong>
          </button><button @click="boundary='这里不打开真实1688网站，也不进行订货。'">
            <V2PortalScene kind="purchasing" /><strong>1688订货平台</strong>
          </button><button
            data-action="enter-seller"
            @click="enterSeller()"
          >
            <V2PortalScene kind="seller" /><strong>亚马逊卖家后台</strong>
          </button>
        </div><footer>
          <span>独立模拟入口，不使用真实账号</span><button
            v-if="!props.embedded"
            class="v2-link"
            @click="enterSeller(true)"
          >
            在新标签页打开卖家后台 ↗
          </button>
        </footer>
      </section>
    </div>
    <div
      v-if="boundary || resetOpen"
      class="v2-modal-backdrop"
      @click.self="boundary=''; resetOpen=false"
    >
      <section
        class="v2-small-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="resetOpen ? '重置本机样例' : '样板范围说明'"
      >
        <h2>{{ resetOpen ? '重置本机样例？' : '样板范围说明' }}</h2><p>{{ resetOpen ? '只重置这套 V2 体验的商品、变体和订单。原有演示数据及其他网站设置不会删除。' : boundary }}</p><footer>
          <button
            class="v2-button"
            @click="boundary='';resetOpen=false"
          >
            {{ resetOpen ? '取消' : '知道了' }}
          </button><button
            v-if="resetOpen"
            class="v2-button v2-yellow"
            data-action="confirm-reset"
            @click="resetSamples"
          >
            确认重置
          </button>
        </footer>
      </section>
    </div>
    <div
      v-if="reloadOpen"
      class="v2-modal-backdrop"
      @click.self="reloadOpen=false"
    >
      <section
        class="v2-small-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="重新加载最新样例"
      >
        <h2>重新加载最新样例？</h2><p>这会放弃当前未保存的表单输入，并读取其他标签页的最新商品或订单。不刷新页面，也不重置其他样例。</p><footer>
          <button
            class="v2-button"
            @click="reloadOpen=false"
          >
            取消
          </button><button
            class="v2-button v2-yellow"
            data-action="confirm-reload-latest"
            @click="reloadForm"
          >
            确认重新加载
          </button>
        </footer>
      </section>
    </div>
    <V2DemoController
      v-model:task="runTask"
      v-model:pace="runPace"
      :open="toolsOpen"
      :selected-order="demoOrder"
      :orders="demoOrders"
      :active-task="activeTask"
      :running="running"
      :paused="paused"
      :status="runStatus"
      :failure-message="runStatus === '未完成' ? message : ''"
      :current-step="currentStep"
      :action="demoAction"
      :steps="steps"
      :cursor="cursor"
      :outcome="outcome"
      @update:order="demoOrder=$event"
      @view-result="viewOutcome"
      @next-task="nextTask"
      @close="toolsOpen = false"
      @toggle="toolsOpen = !toolsOpen"
      @start="automatic"
      @pause="togglePause"
      @stop="stop"
    />
  </div>
</template>

<style src="./v2-simulation.css" />
<style src="./v2-demo-presentation.css" />
<style src="./v2-embedded.css" />
