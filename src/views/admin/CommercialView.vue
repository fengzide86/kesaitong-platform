<template>
  <section class="framework-page commercial-page" aria-label="管理可售套餐与服务">
    <PageHeader title="管理可售套餐与服务" description="决定新订单可以选择什么套餐、包含哪些工具和服务。调整这里不会改变客户已经买到的授权。" />
    <p v-if="!canManage" class="notice">当前账号不能修改套餐。价格、包含内容和启用状态请交由超级管理员核对。</p>
    <p v-if="error && !loadError" role="alert" class="error">{{ error }}</p><p v-if="message" role="status" class="notice kst-confirm">{{ message }}</p>
    <p v-if="loadState === 'loading'" role="status" class="hint">正在读取商品与订单…</p>
    <div v-if="loadError" role="alert" class="error">商品与订单读取失败：{{ loadError }}<button :disabled="busy" @click="run(load)">重新加载</button></div>
    <nav class="commercial-overview" aria-label="本页功能">
      <button type="button" aria-controls="commercial-catalog" @click="scrollToSection('catalog')">套餐与服务</button>
      <button type="button" aria-controls="commercial-orders" @click="scrollToSection('orders')">新建项目订单</button>
      <button type="button" aria-controls="commercial-fulfillment" @click="scrollToSection('fulfillment')">登记服务完成</button>
    </nav>
    <section id="commercial-catalog" ref="catalogPanel" class="panel" tabindex="-1">
      <div class="catalog-heading"><div><h2>套餐与服务</h2><p class="hint">先导入草稿，再核对包含内容，最后确认启用。</p></div><div class="actions"><button :disabled="busy || !canManage" @click="seed">导入标准商品草稿</button><button :disabled="busy" @click="run(load)">刷新</button></div></div>
      <div v-if="loadState === 'ready'" class="catalog-toolbar">
        <div class="catalog-statuses" role="group" aria-label="按套餐状态查看">
          <button v-for="filter in offerFilters" :key="filter.value" type="button" :aria-pressed="offerStatus === filter.value" @click="offerStatus = filter.value">{{ filter.label }} <span>{{ offers.filter(item => item.status === filter.value).length }}</span></button>
        </div>
        <label class="catalog-search"><span class="visually-hidden">查找套餐或服务</span><input v-model="offerQuery" type="search" placeholder="查找套餐或服务" /></label>
      </div>
      <p v-if="loadState === 'ready'" class="catalog-state-hint">{{ catalogStateHint }}</p>
      <div v-if="loadState === 'ready' && filteredOffers.length" class="table-wrap"><table class="catalog-table"><thead><tr><th>名称与包含内容</th><th>价格</th><th>使用约定</th><th>操作</th></tr></thead><tbody>
        <tr v-for="offer in filteredOffers" :key="offer.id" :data-offer-id="offer.id">
          <td><strong>{{ offer.definition.name }}</strong><div class="offer-meta">{{ businessLineText(offer.definition.business_line) }} · 第 {{ offer.version }} 版</div><details class="offer-inclusions"><summary>查看包含内容</summary><p>{{ offer.definition.description || '尚未填写公开说明' }}</p><ul><li v-for="capability in offer.definition.allowed_capabilities" :key="capability">{{ capabilityText(capability) }}</li><li v-for="service in offer.definition.services" :key="service.code">{{ serviceText(service) }}</li></ul><p v-if="!offer.definition.allowed_capabilities.length && !offer.definition.services.length">尚未配置工具或服务，请先核对。</p><small>商品编号：{{ offer.sku }}</small></details></td>
          <td class="offer-price">¥{{ offer.definition.price }}</td>
          <td><div>{{ termText(offer.definition.term_type) }}</div><small class="offer-availability">{{ availabilityText(offer.definition.availability) }}</small></td>
          <td><div class="offer-actions"><button :disabled="busy || !canManage" @click="edit(offer)">{{ offer.status === 'draft' ? '编辑草稿' : '复制为新版本' }}</button><button v-if="offer.status === 'draft'" class="primary" :disabled="busy || !canManage || Boolean(activationBlock(offer))" @click="activate(offer)">确认启用</button></div><p v-if="activationBlock(offer)" class="offer-block">{{ activationBlock(offer) }}</p></td>
        </tr>
      </tbody></table></div>
      <p v-if="loadState === 'ready' && !offers.length" class="empty">尚无新商品。可先导入草稿，旧套餐不受影响。</p>
      <div v-else-if="loadState === 'ready' && !filteredOffers.length" class="empty"><p>{{ offerQuery.trim() ? '当前分类中没有找到对应套餐或服务。' : '当前分类暂无套餐或服务。' }}</p><button v-if="offerQuery.trim()" type="button" @click="offerQuery = ''">清除搜索</button></div>
      <div class="catalog-boundary"><p>已启用只代表可以按此版本建立新订单，不代表其中工具已获准运行；旧订单与已发授权保留购买时的内容。</p><button :disabled="busy || !canManage" @click="exportCatalog">导出已启用的公开目录</button><small>供官网核对价格和内容，不会自动发布官网，也不包含内部底价、分成或成员信息。</small></div>
    </section>
    <section v-if="editing && canManage" ref="editPanel" class="panel kst-reveal" tabindex="-1">
      <h2>{{ editing.status === 'draft' ? '核对并编辑草稿' : '从现有版本建立新草稿' }}</h2><p class="hint">核对名称、价格和包含内容。保存草稿不会立即对客户生效。</p><form @submit.prevent="saveOffer"><fieldset :disabled="busy" style="border:0;padding:0"><div class="fields">
        <label>商品编号<input v-model="draftSku" required :readonly="editing.status === 'draft'"></label>
        <label>名称<input v-model="editing.definition.name" required></label>
        <label>价格（元）<input v-model="editing.definition.price" inputmode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" required></label>
        <label>工具支持范围说明<select v-model="editing.definition.availability"><option value="consult">需确认支持范围</option><option value="limited">部分开放</option><option value="available">已开放</option></select></label>
        <label>公开说明<textarea v-model="editing.definition.description" /></label>
      </div><div class="edit-inclusions"><h3>本版包含内容</h3><p>{{ termText(editing.definition.term_type) }}</p><ul><li v-for="capability in editing.definition.allowed_capabilities" :key="capability">{{ capabilityText(capability) }}</li><li v-for="service in editing.definition.services" :key="service.code">{{ serviceText(service) }}</li></ul><p v-if="!editing.definition.allowed_capabilities.length && !editing.definition.services.length">尚未配置工具或服务。</p></div><p class="hint">工具和包含服务从草稿模板继承。已启用商品不可原地改价，保存会建立新版本。这里的支持范围说明不会修改工具运行权限。</p><div class="actions"><button class="primary">保存草稿</button><button type="button" @click="editing = null">关闭</button></div></fieldset></form>
    </section>
    <details class="panel single-tool-panel"><summary><strong>按需添加单个工具 · 39 元</strong><span>{{ !canManage ? '需由超级管理员配置' : loadState === 'ready' && !selectableTools.length ? '暂无已审核工具，暂不能新增' : '次级选购，不替代套餐' }}</span></summary><p class="hint">39 元单工具是次级选购项；199 元完整包仍是主推方案。</p><p v-if="canManage && loadState === 'ready' && !selectableTools.length" class="notice">暂时没有可选的已审核工具，不能建立可用的单工具商品。请先完成工具审核。</p><form @submit.prevent="createSingle"><fieldset :disabled="busy || !canManage"><div class="fields"><label>已审核工具<select v-model="singleCapability" required><option value="" disabled>选择一个工具</option><option v-for="tool in selectableTools" :key="tool.capability" :value="tool.capability">{{ tool.name }}</option></select></label></div><p class="hint">只授予所选工具，仍受场景、项目期限与运行审批限制。未审核工具不能因付款而开放。</p><div class="actions"><button :disabled="busy || !canManage || !singleCapability">保存为草稿</button></div></fieldset></form></details>
    <section id="commercial-orders" ref="ordersPanel" class="panel" tabindex="-1"><h2>项目订单</h2><p class="hint">选择已启用的套餐与服务，确认适用项目和结束时间，再确认收款、发放授权。免费体验不创建付款订单，不参与收款分成。</p><form @submit.prevent="createOrder"><fieldset :disabled="busy || !canOperate" style="border:0;padding:0"><div class="fields">
      <label>已启用商品<select v-model.number="orderForm.offer_id" required><option :value="0" disabled>选择商品</option><option v-for="offer in offers.filter(o => o.status === 'active')" :key="offer.id" :value="offer.id">{{ offer.definition.name }} · ¥{{ offer.definition.price }}</option></select></label>
      <template v-if="selectedOffer?.definition.term_type === 'project_end'">
        <label>项目编号<input v-model="orderForm.project_id" required></label><label>适用平台网址<input v-model="orderForm.site_origin" type="url" required placeholder="https://www.idtrade.cn"><small>填写网站地址，不含课程页面路径。</small></label>
        <label>结束时间（本机时区）<input v-model="orderForm.expiry" type="datetime-local" required></label>
        <label>站内模块<select v-model="orderForm.platform_key"><option value="amazon">Amazon</option><option value="aliexpress">AliExpress</option></select></label>
        <label v-if="selectedOffer.definition.business_line === 'single_tool'">场景<select v-model="orderForm.scene_type"><option value="training">实训</option><option value="competition">比赛</option></select></label>
      </template><label v-if="selectedOffer?.definition.business_line === 'trial'">体验用户编号<input v-model.number="orderForm.user_id" type="number" min="1" required></label>
    </div><div class="actions"><button class="primary" :disabled="!selectedOffer">{{ selectedOffer?.definition.business_line === 'trial' ? '发放免费体验' : '建立待收款订单' }}</button></div></fieldset></form>
      <p v-if="issuedCode" role="status">本次授权码：<code>{{ issuedCode }}</code></p>
    </section>
    <section class="panel"><h2>订单处理</h2><div class="table-wrap"><table><thead><tr><th>订单</th><th>商品</th><th>金额 / 状态</th><th>项目到期</th><th>操作</th></tr></thead><tbody>
      <tr v-for="order in orders" :key="order.id"><td>{{ order.order_no }}<br><small>#{{ order.id }}</small></td><td>{{ order.commercial.definition.name }}</td><td>¥{{ order.amount }} / {{ statusText(order.status) }}</td><td>{{ order.commercial.ends_at || '按服务履约' }}</td><td><button v-if="order.status === 'pending'" :disabled="busy || !canOperate" @click="receive(order)">确认收款</button> <button v-if="order.status === 'paid' && order.commercial.ends_at" :disabled="busy || !canOperate" @click="issue(order.id)">发放授权</button> <button :disabled="busy || !canOperate" @click="openFulfillment(order.id)">服务履约</button></td></tr>
    </tbody></table></div><p v-if="loadState === 'ready' && !orders.length" class="empty">暂无新商品订单</p></section>
    <section id="commercial-fulfillment" ref="fulfillmentPanel" class="panel" tabindex="-1"><h2>服务履约</h2><p class="hint">已包含的资料、诊断和答疑在这里登记完成次数，不另行收费。先在订单列表选择要处理的订单。</p><div v-if="fulfillmentOrder" class="fulfillment-detail kst-reveal"><h3>正在处理订单 #{{ fulfillmentOrder }}</h3><div class="fields"><label>实际执行员工编号<input v-model.number="performer" type="number" min="1"></label><label>凭证／工单编号<input v-model="evidence" required></label></div>
      <div class="table-wrap"><table><thead><tr><th>项目</th><th>剩余</th><th>每次时长</th><th>操作</th></tr></thead><tbody><tr v-for="item in fulfillments" :key="item.id"><td>{{ serviceName(item.service_code) }}</td><td>{{ item.remaining_count }} / {{ item.total_count }}</td><td>{{ item.minutes_per_unit ? `${item.minutes_per_unit} 分钟` : '按次' }}</td><td><button :disabled="busy || !canOperate || !evidence.trim() || performer < 1 || item.remaining_count < 1" @click="complete(item)">确认完成 1 次</button></td></tr></tbody></table></div><p v-if="!fulfillments.length" class="empty">该订单无包含服务。</p>
      </div><p v-else class="empty">先在“订单处理”里点击“服务履约”，这里会显示该订单还剩多少次服务。</p>
    </section>
    <RefundEntitlementsPanel v-if="canManage" :orders="orders" @changed="run(load)" />
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { z } from 'zod'
import PageHeader from '@/components/PageHeader.vue'
import { api, markOrderPaid } from '@/utils/api'
import { authService } from '@/utils/auth'
import { hasStaffPermission } from '@/features/auth/permissions'
import { confirmAction } from '@/shared/ui/confirm'
import { scrollToWorkflowTarget } from '@/shared/ui/workflowMotion'
import { commercialApi, savePublicCatalog, type Offer, type OfferDefinition, type CommercialOrder, type Fulfillment, type ToolOption, type Envelope } from '@/features/admin/commercial'
import { useFrameworkTask } from '@/features/admin/useFrameworkTask'
import RefundEntitlementsPanel from '@/features/admin/RefundEntitlementsPanel.vue'
import '@/features/admin/framework.css'
const { busy, error, message, run } = useFrameworkTask()
const canManage = computed(() => hasStaffPermission(authService.getRole(), 'settings.manage'))
const canOperate = computed(() => hasStaffPermission(authService.getRole(), 'expenses.write'))
const loadState = ref<'loading' | 'ready' | 'error'>('loading'), loadError = ref('')
const catalogPanel = ref<HTMLElement | null>(null), ordersPanel = ref<HTMLElement | null>(null), fulfillmentPanel = ref<HTMLElement | null>(null)
const editPanel = ref<HTMLElement | null>(null)
function scrollToSection(section: 'catalog' | 'orders' | 'fulfillment') {
  const target = { catalog: catalogPanel, orders: ordersPanel, fulfillment: fulfillmentPanel }[section].value
  target?.focus({ preventScroll: true })
  scrollToWorkflowTarget(target, { block: 'start' })
}
const offers = ref<Offer[]>([]), orders = ref<CommercialOrder[]>([]), tools = ref<ToolOption[]>([])
const offerFilters = [{ value: 'active', label: '已启用' }, { value: 'draft', label: '待核对草稿' }, { value: 'retired', label: '历史版本' }] as const
const offerStatus = ref<'active' | 'draft' | 'retired'>('active'), offerQuery = ref('')
let catalogInitialized = false
const catalogStateHint = computed(() => ({ active: '新订单可以选择这些套餐与服务；使用范围仍需按项目确认。', draft: '这些内容尚未对客户生效。先展开核对工具、服务次数和使用期限，再确认启用。', retired: '这些版本不再用于新订单，但原订单和授权仍保留原约定。' })[offerStatus.value])
const filteredOffers = computed(() => {
  const query = offerQuery.value.trim().toLocaleLowerCase()
  return offers.value.filter(offer => offer.status === offerStatus.value && (!query || `${offer.definition.name} ${offer.sku}`.toLocaleLowerCase().includes(query)))
})
const selectableTools = computed(() => tools.value.filter(tool => tool.selectable))
const offerListSchema = z.array(z.object({
  id: z.number().int().positive(), sku: z.string().min(1), version: z.number().int().positive(), revision: z.number().int().positive(),
  status: z.enum(['draft', 'active', 'retired']),
  definition: z.object({
    name: z.string().min(1), price: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
    business_line: z.enum(['trial', 'competition', 'training', 'service', 'single_tool']), term_type: z.enum(['project_end', 'service_fulfillment']),
    description: z.string(), allowed_capabilities: z.array(z.string()), availability: z.enum(['consult', 'limited', 'available']),
    services: z.array(z.object({ code: z.string(), count: z.number().int().positive(), minutes_per_unit: z.number().int().nonnegative() })),
  }),
})).superRefine((items, context) => {
  const activeSkus = new Set<string>()
  for (const offer of items.filter(item => item.status === 'active')) {
    if (activeSkus.has(offer.sku)) context.addIssue({ code: 'custom', message: '同一商品存在多个已启用版本，请刷新并核对。' })
    activeSkus.add(offer.sku)
  }
})
const capabilityNames: Record<string, string> = { 'company.register': '公司注册', 'product.create': '商品发布', 'template.create': '物流模板', 'freight.quote': '运费计算', selection_compare: '选品比较', cost_calculator: '成本计算', price_calculator: '售价计算', profit_calculator: '利润计算', ad_script: '广告', flash_sale: '秒杀', coupon: '优惠券', fba_agl: 'FBA 配送', ship_script: '订单发货' }
const serviceNames: Record<string, string> = { 'materials-topic': '专题资料', 'materials-full': '完整资料', diagnosis: '账号诊断', 'group-qa': '集中答疑', appointment: '预约答疑' }
const capabilityText = (value: string) => tools.value.find(tool => tool.capability === value)?.name || capabilityNames[value] || `其他工具（${value}）`
const serviceName = (value: string) => serviceNames[value] || `其他服务（${value}）`
const serviceText = (service: OfferDefinition['services'][number]) => `${serviceName(service.code)} ${service.count} ${service.code === 'materials-full' ? '套' : service.code === 'materials-topic' ? '份' : '次'}${service.minutes_per_unit ? `，每次 ${service.minutes_per_unit} 分钟` : ''}`
const businessLineText = (value: string) => ({ trial: '免费体验', competition: '比赛', training: '实训', single_tool: '单个工具', service: '资料与答疑' }[value] || value)
const termText = (value: string) => value === 'project_end' ? '按约定项目和结束日期' : '按约定次数与时长'
const availabilityText = (value: string) => ({ consult: '需先确认支持范围', limited: '部分工具开放', available: '已开放范围内使用' }[value] || value)
function activationBlock(offer: Offer): string {
  if (offer.status !== 'draft' || offer.definition.business_line !== 'single_tool') return ''
  if (offer.sku === 'single-tool-39' || offer.definition.allowed_capabilities.length !== 1) return '这是单工具参考模板，请在下方选择具体工具建立草稿。'
  if (!selectableTools.value.some(tool => tool.capability === offer.definition.allowed_capabilities[0])) return '所选工具尚未审核开放，暂不能启用。'
  return ''
}
const editing = ref<Offer | null>(null), draftSku = ref(''), singleCapability = ref(''), issuedCode = ref('')
const orderForm = reactive({ offer_id: 0, project_id: '', site_origin: '', expiry: '', platform_key: 'amazon', scene_type: 'training', user_id: 1 })
const selectedOffer = computed(() => offers.value.find(o => o.id === orderForm.offer_id && o.status === 'active'))
const fulfillments = ref<Fulfillment[]>([]), fulfillmentOrder = ref(0), performer = ref(1), evidence = ref('')
const statusText = (value: string) => ({ draft: '草稿', active: '已启用', retired: '历史版本', pending: '待收款', paid: '已收款', refunded: '已退款' }[value] || value)
async function load() {
  loadState.value = 'loading'; loadError.value = ''
  try {
    const [nextOffers, nextOrders, nextTools] = await Promise.all([commercialApi.offers(), commercialApi.orders(), canManage.value ? commercialApi.tools() : Promise.resolve([])])
    const parsed = offerListSchema.safeParse(nextOffers)
    if (!parsed.success) throw new Error('套餐数据不完整或启用版本冲突，请刷新后重新核对。')
    offers.value = parsed.data; orders.value = nextOrders; tools.value = nextTools
    if (!catalogInitialized) {
      offerStatus.value = offers.value.some(offer => offer.status === 'active') ? 'active' : offers.value.some(offer => offer.status === 'draft') ? 'draft' : offers.value.some(offer => offer.status === 'retired') ? 'retired' : 'active'
      catalogInitialized = true
    }
    loadState.value = 'ready'
  } catch (cause) {
    loadState.value = 'error'; loadError.value = cause instanceof Error && cause.message ? cause.message : '请稍后重试'
    throw cause
  }
}
async function seed() { if (!canManage.value) return; await run(async () => { await api.post('/api/commercial/offers/seed-drafts'); await load(); offerStatus.value = 'draft'; offerQuery.value = '' }, '标准商品已保存为草稿，尚未启用') }
async function edit(offer: Offer) { if (!canManage.value) return; editing.value = JSON.parse(JSON.stringify(offer)) as Offer; draftSku.value = offer.sku; await nextTick(); editPanel.value?.focus({ preventScroll: true }); scrollToWorkflowTarget(editPanel.value, { block: 'nearest' }) }
async function saveOffer() { if (!canManage.value) return; await run(async () => { if (!editing.value) return; const item = editing.value; if (item.status === 'draft') await api.patch(`/api/commercial/offers/${item.id}`, { expected_revision: item.revision, definition: item.definition }); else await api.post('/api/commercial/offers', { sku: draftSku.value, definition: item.definition }); editing.value = null; await load(); offerStatus.value = 'draft' }, '草稿已保存') }
async function activate(offer: Offer) { if (!canManage.value || activationBlock(offer)) return; await run(async () => { if (!await confirmAction({ title: '确认启用商品版本', message: `${offer.definition.name}，价格 ¥${offer.definition.price}。仅影响今后的新订单，不改历史授权，也不会自动发布官网。确认启用？` })) return; await api.post(`/api/commercial/offers/${offer.id}/activate`, { expected_revision: offer.revision }); await load(); offerStatus.value = 'active' }) }
async function createSingle() { if (!canManage.value) return; await run(async () => { const tool = tools.value.find(t => t.capability === singleCapability.value && t.selectable); if (!tool) throw new Error('请选择已审核工具'); const definition: OfferDefinition = { name: `${tool.name} · 单工具`, price: '39.00', business_line: 'single_tool', term_type: 'project_end', description: '仅包含所选工具，绑定本次比赛或实训项目及结束日期。', allowed_capabilities: [tool.capability], services: [], availability: 'limited' }; await api.post('/api/commercial/offers', { sku: `single-${tool.capability.replace(/[^a-z0-9-]/g, '-')}`, definition }); await load(); offerStatus.value = 'draft'; offerQuery.value = '' }, '单工具已存为草稿') }
async function createOrder() { if (!canOperate.value) return; await run(async () => { const spec = selectedOffer.value; if (!spec) return; const scope = spec.definition.term_type === 'project_end' ? { project_id: orderForm.project_id, site_origin: orderForm.site_origin, ends_at: new Date(orderForm.expiry).toISOString(), platform_key: orderForm.platform_key, scene_type: orderForm.scene_type } : {}; issuedCode.value = ''; if (spec.definition.business_line === 'trial') { const result = await api.post<Envelope<{ auth_code: string }>>('/api/commercial/trial-grants', { offer_id: spec.id, user_id: orderForm.user_id, ...scope }); issuedCode.value = result.data.auth_code } else await api.post('/api/commercial/orders', { offer_id: spec.id, ...scope }); await load() }, '已完成，请核对订单或授权信息') }
async function receive(order: CommercialOrder) { if (!canOperate.value) return; await run(async () => { if (!await confirmAction({ title: '确认实际收款', message: `订单 ${order.order_no}，¥${order.amount}。请确认资金已到账。收款不会自动产生团队分配。` })) return; await markOrderPaid(order.id); await load() }) }
async function issue(id: number) { if (!canOperate.value) return; await run(async () => { const result = await api.post<Envelope<{ auth_code: string }>>(`/api/commercial/orders/${id}/grant`); issuedCode.value = result.data.auth_code }, '授权已发放，可在上方查看本次授权码') }
async function openFulfillment(id: number) { await run(async () => { fulfillments.value = await commercialApi.fulfillments(id); fulfillmentOrder.value = id; await nextTick(); scrollToSection('fulfillment') }) }
async function complete(item: Fulfillment) { if (!canOperate.value) return; await run(async () => { if (!await confirmAction({ title: '确认服务已完成', message: `${serviceName(item.service_code)} 完成 1 次，此操作将扣减剩余次数。` })) return; await api.post(`/api/commercial/fulfillments/${item.id}/complete`, { expected_revision: item.revision, operation_id: crypto.randomUUID(), count: 1, minutes: item.minutes_per_unit, performed_by_staff_id: performer.value, evidence_ref: evidence.value }); fulfillments.value = await commercialApi.fulfillments(item.order_id); evidence.value = '' }) }
async function exportCatalog() { if (!canManage.value) return; await run(async () => { const data = await api.get('/api/commercial/catalog-export', {}, { cache: false }); savePublicCatalog('kst-public-catalog.json', data) }) }
onMounted(() => run(load))
</script>

<style scoped>
.commercial-page { padding-top: 0; }
.commercial-overview { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 0; padding-bottom: 8px; border-bottom: 1px solid var(--color-border); }
.commercial-overview button { min-height: 36px; padding: 8px 14px; border-color: transparent; background: transparent; color: var(--color-text-secondary); font-size: 14px; }
.commercial-overview button:hover { color: var(--color-primary); background: var(--color-primary-soft); }
.catalog-heading, .catalog-toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; }
.catalog-heading h2 { margin-bottom: 6px; }
.catalog-heading .hint, .catalog-heading .actions { margin: 0; }
.catalog-toolbar { margin-top: 22px; }
.catalog-statuses { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; background: var(--color-surface-soft); border-radius: 8px; }
.catalog-statuses button { min-height: 34px; padding: 6px 10px; border-color: transparent; background: transparent; color: var(--color-text-secondary); font-size: 14px; }
.catalog-statuses button[aria-pressed='true'] { background: var(--color-surface); border-color: var(--color-border); color: var(--color-primary); }
.catalog-statuses span { margin-left: 4px; font-size: 12px; font-variant-numeric: tabular-nums; }
.catalog-search { flex: 1 1 200px; max-width: 260px; }
.catalog-search input { min-height: 40px; }
.catalog-state-hint { margin: 12px 0 18px; color: var(--color-text-secondary); font-size: 13px; line-height: 1.7; }
.catalog-table { table-layout: fixed; }
.catalog-table th:first-child { width: 35%; }
.catalog-table th:nth-child(2) { width: 12%; }
.catalog-table th:nth-child(3) { width: 24%; }
.catalog-table th:last-child { width: 29%; }
.catalog-table td { overflow-wrap: anywhere; line-height: 1.6; }
.catalog-table strong { font-weight: 600; }
.offer-meta, .offer-availability { display: block; margin-top: 6px; font-size: 12px; line-height: 1.6; color: var(--color-text-secondary); }
.offer-price { font-variant-numeric: tabular-nums; white-space: nowrap; font-weight: 600; }
.offer-inclusions { margin-top: 10px; font-size: 13px; }
.offer-inclusions summary { color: var(--color-primary); cursor: pointer; }
.offer-inclusions p { margin: 10px 0; color: var(--color-text-secondary); }
.offer-inclusions ul, .edit-inclusions ul { margin: 10px 0; padding-left: 18px; }
.offer-inclusions small { color: var(--color-text-tertiary, #667085); }
.offer-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.offer-actions button { min-height: 36px; padding: 6px 10px; font-size: 13px; }
.offer-block { margin: 8px 0 0; font-size: 12px; color: var(--color-text-secondary); line-height: 1.6; }
.catalog-boundary { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--color-border); color: var(--color-text-secondary); font-size: 13px; line-height: 1.7; }
.catalog-boundary p { width: 100%; margin: 0; }
.catalog-boundary button { padding: 6px 0; min-height: 36px; border: 0; color: var(--color-primary); background: transparent; font-size: 13px; }
.catalog-boundary small { font-size: 12px; }
.single-tool-panel summary { cursor: pointer; font-size: 15px; line-height: 1.7; }
.single-tool-panel summary span { margin-left: 16px; color: var(--color-text-secondary); font-size: 13px; font-weight: 400; }
.single-tool-panel fieldset { margin: 0; padding: 0; border: 0; }
.edit-inclusions { margin-top: 20px; padding: 16px 20px; border-radius: 8px; background: var(--color-surface-soft); color: var(--color-text-secondary); font-size: 14px; line-height: 1.7; }
.edit-inclusions h3 { margin: 0; color: var(--color-text); font-size: 14px; }
.edit-inclusions p { margin: 6px 0; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.fulfillment-detail { padding-top: 4px; }
.fulfillment-detail h3 { margin: 0 0 16px; font-size: 16px; }
@media (max-width: 1100px) { .catalog-heading { align-items: flex-start; } .catalog-table th:first-child { width: 33%; } .catalog-table th:nth-child(3) { width: 25%; } .catalog-table th:last-child { width: 30%; } }
</style>
