<template>
  <section class="framework-page" aria-label="商品版本与项目权益">
    <PageHeader title="商品版本与项目权益" description="新商品先存草稿，启用后才可开单。购买时冻结价格、工具范围、服务次数与项目结束时间，不倒改历史授权。" />
    <p class="notice">39 元单工具是次级选购项；199 元完整包仍是主推方案。免费体验不创建付款订单，不参与收款分成。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="message" role="status" class="notice">{{ message }}</p>
    <section class="panel">
      <h2>商品目录</h2><div class="actions"><button :disabled="busy" @click="seed">导入标准商品草稿</button><button :disabled="busy" @click="exportCatalog">导出已启用的公开目录</button><button :disabled="busy" @click="run(load)">刷新</button></div>
      <p class="hint">导出仅包含公开价格和权益；不会自动发布官网，也不包含内部底价、分成或成员信息。</p>
      <div class="table-wrap"><table><thead><tr><th>商品 / SKU</th><th>价格</th><th>版本</th><th>状态</th><th>操作</th></tr></thead><tbody>
        <tr v-for="offer in offers" :key="offer.id"><td>{{ offer.definition.name }}<br><small>{{ offer.sku }}</small></td><td>¥{{ offer.definition.price }}</td><td>{{ offer.version }}</td><td>{{ statusText(offer.status) }}</td><td><button :disabled="busy" @click="edit(offer)">{{ offer.status === 'draft' ? '编辑草稿' : '复制为新版本' }}</button> <button v-if="offer.status === 'draft'" :disabled="busy" @click="activate(offer)">确认启用</button></td></tr>
      </tbody></table></div><p v-if="!offers.length" class="empty">尚无新商品。可先导入草稿，旧套餐不受影响。</p>
    </section>
    <section v-if="editing" class="panel">
      <h2>编辑商品草稿</h2><form @submit.prevent="saveOffer"><fieldset :disabled="busy" style="border:0;padding:0"><div class="fields">
        <label>商品编号<input v-model="draftSku" required :readonly="editing.status === 'draft'"></label>
        <label>名称<input v-model="editing.definition.name" required></label>
        <label>价格（元）<input v-model="editing.definition.price" inputmode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" required></label>
        <label>开放状态<select v-model="editing.definition.availability"><option value="consult">需确认支持范围</option><option value="limited">部分开放</option><option value="available">已开放</option></select></label>
        <label>公开说明<textarea v-model="editing.definition.description" /></label>
      </div><p class="hint">工具和包含服务从草稿模板继承。已启用商品不可原地改价，保存会建立新版本。</p><div class="actions"><button class="primary">保存草稿</button><button type="button" @click="editing = null">关闭</button></div></fieldset></form>
    </section>
    <section class="panel"><h2>39 元单工具草稿</h2><form @submit.prevent="createSingle"><div class="fields"><label>已审核工具<select v-model="singleCapability" required><option value="" disabled>选择一个工具</option><option v-for="tool in tools.filter(t => t.selectable)" :key="tool.capability" :value="tool.capability">{{ tool.name }}</option></select></label></div><p class="hint">只授予所选工具，仍受场景、项目期限与运行审批限制。未审核工具不能因付款而开放。</p><div class="actions"><button :disabled="busy || !singleCapability">保存为草稿</button></div></form></section>
    <section class="panel"><h2>新订单／免费体验</h2><form @submit.prevent="createOrder"><fieldset :disabled="busy" style="border:0;padding:0"><div class="fields">
      <label>已启用商品<select v-model.number="orderForm.offer_id" required><option :value="0" disabled>选择商品</option><option v-for="offer in offers.filter(o => o.status === 'active')" :key="offer.id" :value="offer.id">{{ offer.definition.name }} · ¥{{ offer.definition.price }}</option></select></label>
      <template v-if="selectedOffer?.definition.term_type === 'project_end'">
        <label>项目编号<input v-model="orderForm.project_id" required></label><label>适用网站 origin<input v-model="orderForm.site_origin" type="url" required placeholder="https://www.idtrade.cn"></label>
        <label>结束时间（本机时区）<input v-model="orderForm.expiry" type="datetime-local" required></label>
        <label>站内模块<select v-model="orderForm.platform_key"><option value="amazon">Amazon</option><option value="aliexpress">AliExpress</option></select></label>
        <label v-if="selectedOffer.definition.business_line === 'single_tool'">场景<select v-model="orderForm.scene_type"><option value="training">实训</option><option value="competition">比赛</option></select></label>
      </template><label v-if="selectedOffer?.definition.business_line === 'trial'">体验用户编号<input v-model.number="orderForm.user_id" type="number" min="1" required></label>
    </div><div class="actions"><button class="primary" :disabled="!selectedOffer">{{ selectedOffer?.definition.business_line === 'trial' ? '发放免费体验' : '建立待收款订单' }}</button></div></fieldset></form>
      <p v-if="issuedCode" role="status">本次授权码：<code>{{ issuedCode }}</code></p>
    </section>
    <section class="panel"><h2>新商品订单</h2><div class="table-wrap"><table><thead><tr><th>订单</th><th>商品</th><th>金额 / 状态</th><th>项目到期</th><th>操作</th></tr></thead><tbody>
      <tr v-for="order in orders" :key="order.id"><td>{{ order.order_no }}<br><small>#{{ order.id }}</small></td><td>{{ order.commercial.definition.name }}</td><td>¥{{ order.amount }} / {{ statusText(order.status) }}</td><td>{{ order.commercial.ends_at || '按服务履约' }}</td><td><button v-if="order.status === 'pending'" :disabled="busy" @click="receive(order)">确认收款</button> <button v-if="order.status === 'paid' && order.commercial.ends_at" :disabled="busy" @click="issue(order.id)">发放授权</button> <button :disabled="busy" @click="openFulfillment(order.id)">服务履约</button></td></tr>
    </tbody></table></div><p v-if="!orders.length" class="empty">暂无新商品订单</p></section>
    <section v-if="fulfillmentOrder" class="panel"><h2>订单 #{{ fulfillmentOrder }} · 服务履约</h2><p class="hint">已包含的服务在此扣次，不另行收费。只填写工单／凭证编号，不粘贴客户账号、密码或页面原文。</p><div class="fields"><label>实际执行员工编号<input v-model.number="performer" type="number" min="1"></label><label>凭证／工单编号<input v-model="evidence" required></label></div>
      <div class="table-wrap"><table><thead><tr><th>项目</th><th>剩余</th><th>每次时长</th><th>操作</th></tr></thead><tbody><tr v-for="item in fulfillments" :key="item.id"><td>{{ item.service_code }}</td><td>{{ item.remaining_count }} / {{ item.total_count }}</td><td>{{ item.minutes_per_unit ? `${item.minutes_per_unit} 分钟` : '按次' }}</td><td><button :disabled="busy || !evidence.trim() || performer < 1 || item.remaining_count < 1" @click="complete(item)">确认完成 1 次</button></td></tr></tbody></table></div><p v-if="!fulfillments.length" class="empty">该订单无包含服务。</p>
    </section>
    <RefundEntitlementsPanel :orders="orders" @changed="run(load)" />
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import { api, markOrderPaid } from '@/utils/api'
import { confirmAction } from '@/shared/ui/confirm'
import { commercialApi, savePublicCatalog, type Offer, type OfferDefinition, type CommercialOrder, type Fulfillment, type ToolOption, type Envelope } from '@/features/admin/commercial'
import { useFrameworkTask } from '@/features/admin/useFrameworkTask'
import RefundEntitlementsPanel from '@/features/admin/RefundEntitlementsPanel.vue'
import '@/features/admin/framework.css'
const { busy, error, message, run } = useFrameworkTask()
const offers = ref<Offer[]>([]), orders = ref<CommercialOrder[]>([]), tools = ref<ToolOption[]>([])
const editing = ref<Offer | null>(null), draftSku = ref(''), singleCapability = ref(''), issuedCode = ref('')
const orderForm = reactive({ offer_id: 0, project_id: '', site_origin: '', expiry: '', platform_key: 'amazon', scene_type: 'training', user_id: 1 })
const selectedOffer = computed(() => offers.value.find(o => o.id === orderForm.offer_id))
const fulfillments = ref<Fulfillment[]>([]), fulfillmentOrder = ref(0), performer = ref(1), evidence = ref('')
const statusText = (value: string) => ({ draft: '草稿', active: '已启用', retired: '历史版本', pending: '待收款', paid: '已收款', refunded: '已退款' }[value] || value)
async function load() { [offers.value, orders.value, tools.value] = await Promise.all([commercialApi.offers(), commercialApi.orders(), commercialApi.tools()]) }
async function seed() { await run(async () => { await api.post('/api/commercial/offers/seed-drafts'); await load() }, '标准商品已保存为草稿，尚未启用') }
function edit(offer: Offer) { editing.value = JSON.parse(JSON.stringify(offer)) as Offer; draftSku.value = offer.sku }
async function saveOffer() { await run(async () => { if (!editing.value) return; const item = editing.value; if (item.status === 'draft') await api.patch(`/api/commercial/offers/${item.id}`, { expected_revision: item.revision, definition: item.definition }); else await api.post('/api/commercial/offers', { sku: draftSku.value, definition: item.definition }); editing.value = null; await load() }, '草稿已保存') }
async function activate(offer: Offer) { await run(async () => { if (!await confirmAction({ title: '确认启用商品版本', message: `${offer.definition.name}，价格 ¥${offer.definition.price}。仅影响今后的新订单，不改历史授权，也不会自动发布官网。确认启用？` })) return; await api.post(`/api/commercial/offers/${offer.id}/activate`, { expected_revision: offer.revision }); await load() }) }
async function createSingle() { await run(async () => { const tool = tools.value.find(t => t.capability === singleCapability.value && t.selectable); if (!tool) throw new Error('请选择已审核工具'); const definition: OfferDefinition = { name: `${tool.name} · 单工具`, price: '39.00', business_line: 'single_tool', term_type: 'project_end', description: '仅包含所选工具，绑定本次比赛或实训项目及结束日期。', allowed_capabilities: [tool.capability], services: [], availability: 'limited' }; await api.post('/api/commercial/offers', { sku: `single-${tool.capability.replace(/[^a-z0-9-]/g, '-')}`, definition }); await load() }, '单工具已存为草稿') }
async function createOrder() { await run(async () => { const spec = selectedOffer.value; if (!spec) return; const scope = spec.definition.term_type === 'project_end' ? { project_id: orderForm.project_id, site_origin: orderForm.site_origin, ends_at: new Date(orderForm.expiry).toISOString(), platform_key: orderForm.platform_key, scene_type: orderForm.scene_type } : {}; issuedCode.value = ''; if (spec.definition.business_line === 'trial') { const result = await api.post<Envelope<{ auth_code: string }>>('/api/commercial/trial-grants', { offer_id: spec.id, user_id: orderForm.user_id, ...scope }); issuedCode.value = result.data.auth_code } else await api.post('/api/commercial/orders', { offer_id: spec.id, ...scope }); await load() }, '已完成，请核对订单或授权信息') }
async function receive(order: CommercialOrder) { await run(async () => { if (!await confirmAction({ title: '确认实际收款', message: `订单 ${order.order_no}，¥${order.amount}。请确认资金已到账。收款不会自动产生团队分配。` })) return; await markOrderPaid(order.id); await load() }) }
async function issue(id: number) { await run(async () => { const result = await api.post<Envelope<{ auth_code: string }>>(`/api/commercial/orders/${id}/grant`); issuedCode.value = result.data.auth_code }, '授权已发放，可在上方查看本次授权码') }
async function openFulfillment(id: number) { await run(async () => { fulfillments.value = await commercialApi.fulfillments(id); fulfillmentOrder.value = id }) }
async function complete(item: Fulfillment) { await run(async () => { if (!await confirmAction({ title: '确认服务已完成', message: `${item.service_code} 完成 1 次，此操作将扣减剩余次数。` })) return; await api.post(`/api/commercial/fulfillments/${item.id}/complete`, { expected_revision: item.revision, operation_id: crypto.randomUUID(), count: 1, minutes: item.minutes_per_unit, performed_by_staff_id: performer.value, evidence_ref: evidence.value }); fulfillments.value = await commercialApi.fulfillments(item.order_id); evidence.value = '' }) }
async function exportCatalog() { await run(async () => { const data = await api.get('/api/commercial/catalog-export', {}, { cache: false }); savePublicCatalog('kst-public-catalog.json', data) }) }
onMounted(() => run(load))
</script>
