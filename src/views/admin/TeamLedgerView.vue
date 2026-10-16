<template>
  <section class="framework-page" aria-label="成员结算台账">
    <PageHeader title="成员结算台账" description="查看每位成员的分成与付款记录，再处理本次分配或待核对事项。" />
    <p v-if="error && !loadError" role="alert" class="error">{{ error }}</p><p v-if="message" role="status" class="notice kst-confirm">{{ message }}</p>
    <p v-if="loadState === 'loading'" role="status" class="hint">正在读取成员台账…</p>
    <div v-if="loadError" role="alert" class="error">成员台账读取失败：{{ loadError }}<button :disabled="busy" @click="run(load)">重新加载</button></div>
    <section class="ledger-overview" aria-label="全部成员累计总览" data-testid="ledger-overview">
      <div v-for="metric in balanceMetrics" :key="metric.key"><span>{{ metric.label }}</span><strong>{{ summary ? `¥${summary.totals[metric.key]}` : '—' }}</strong><small>{{ metric.note }}</small></div>
    </section>
    <section class="panel" aria-labelledby="member-balances-heading">
      <header class="ledger-section-heading"><div><h2 id="member-balances-heading">成员余额</h2><p class="hint">以下筛选不影响上方全部成员的累计金额。暂留尚未计入应分。</p></div><button type="button" :disabled="busy" @click="run(load)">刷新台账</button></header>
      <div class="ledger-filters ledger-filters--members">
        <label>查找成员<input v-model="memberSearch" type="search" placeholder="输入成员姓名"></label>
        <label>余额情况<select v-model="balanceFilter"><option value="all">全部成员</option><option value="unpaid">有待付款</option><option value="held">有暂留金额</option></select></label>
        <button v-if="memberSearch || balanceFilter !== 'all'" type="button" @click="memberSearch = ''; balanceFilter = 'all'">清除成员筛选</button>
      </div>
      <div v-if="summary && filteredMembers.length" class="table-wrap"><table class="ledger-balances-table"><thead><tr><th>成员</th><th>累计应分（元）</th><th>暂留（元）</th><th>已付（元）</th><th>待付（元）</th><th>操作</th></tr></thead><tbody><tr v-for="member in filteredMembers" :key="member.id" data-testid="member-balance-row"><td>{{ member.name }}</td><td class="amount">{{ member.due }}</td><td class="amount">{{ member.held }}</td><td class="amount">{{ member.paid }}</td><td class="amount">{{ member.unpaid }}</td><td><button :disabled="busy" @click="selectPayment(member)">登记线下付款</button></td></tr></tbody></table></div>
      <p v-if="summary && !filteredMembers.length" class="empty">{{ summary.members.length ? '没有符合筛选条件的成员。' : '还没有成员，新增后可分配收入并登记付款。' }}</p>
      <p v-else-if="!summary" class="hint">成员余额尚未加载，不能按零余额理解。</p>
      <details class="ledger-add-member"><summary>新增成员</summary><form @submit.prevent="addMember"><div class="actions"><label>成员名称<input v-model="memberName" required maxlength="100"></label><button :disabled="busy || !memberName.trim()">新增成员</button></div></form></details>
      <form v-if="payment.member_id" class="ledger-payment kst-reveal" @submit.prevent="pay"><h3>登记付款 · {{ memberLabel(payment.member_id) }}</h3><p class="hint">只记录已经发生的线下付款，不发起银行转账。</p><fieldset :disabled="busy" style="border:0;padding:0"><div class="fields"><label>本次实际付款金额<input v-model="payment.amount" inputmode="decimal" required placeholder="例如 100.00"></label><label>凭据编号<input v-model="payment.evidence" required></label><label>说明<input v-model="payment.note" required></label></div><div class="actions"><button class="primary">确认登记</button><button type="button" @click="payment.member_id = 0">取消</button></div></fieldset></form>
    </section>
    <section class="panel" aria-labelledby="ledger-records-heading">
      <header class="ledger-section-heading"><div><h2 id="ledger-records-heading">已确认的成员台账</h2><p class="hint">查询已入账的分成、暂留和付款。未确认的分配预览不计入这里。</p></div></header>
      <div class="ledger-filters ledger-filters--entries">
        <label>成员<select v-model="entryMember"><option value="all">全部成员</option><option value="unassigned">未分配成员</option><option v-for="member in entryMemberOptions" :key="member.id" :value="String(member.id)">{{ member.name }}</option></select></label>
        <label>查找订单<input v-model="orderSearch" type="search" placeholder="输入订单号或订单编号"></label>
        <label>记录状态<select v-model="entryBucket"><option value="all">全部状态</option><option value="due">应分</option><option value="held">暂留</option><option value="paid">已付</option></select></label>
        <button v-if="entriesFiltered" type="button" @click="clearEntryFilters">清除明细筛选</button>
      </div>
      <p v-if="loadState === 'ready'" class="hint ledger-record-count">已加载 {{ entries.length }} 条明细，当前显示 {{ filteredEntries.length }} 条。仅筛选已加载记录（最多最近 200 条），不是全历史搜索。</p>
      <div v-if="loadState === 'ready' && filteredEntries.length" class="table-wrap"><table class="ledger-entries-table"><thead><tr><th>订单 / 记录</th><th>成员 / 分配项</th><th>状态</th><th>金额（元）</th><th>说明</th></tr></thead><tbody><tr v-for="entry in filteredEntries" :key="entry.id" data-testid="ledger-entry-row"><td><strong>{{ entry.order_id ? orderLabel(entry.order_id) : '无关联订单' }}</strong><small>明细 #{{ entry.id }}{{ entry.order_id ? ` · 订单编号 #${entry.order_id}` : '' }}</small></td><td><strong>{{ memberLabel(entry.member_id) }}</strong><small :title="entry.item_code ? `原始分配项编号：${entry.item_code}` : undefined">{{ entryItemLabel(entry) }}</small></td><td><span class="status">{{ bucketText(entry.bucket) }}</span></td><td class="amount">{{ entry.amount }}</td><td>{{ entry.note || '—' }}</td></tr></tbody></table></div>
      <p v-if="loadState === 'ready' && !filteredEntries.length" class="empty">{{ entries.length ? '已加载记录中没有匹配的明细，可清除筛选再查看。' : '暂无已确认的台账明细。完成本次分配并确认后，记录会显示在这里。' }}</p>
    </section>
    <details class="ledger-disclosure" data-testid="ledger-settlement-settings">
      <summary><span><strong>登记本次分成</strong><small>先填写订单分配金额，再预览并确认入账</small></span></summary>
      <div class="ledger-disclosure-body">
        <p class="hint">订单收款不会自动成为成员收入；本次分配金额由管理员填写。</p>
        <section class="panel panel--step"><h2>第一步：填写每单本次分配金额</h2><form @submit.prevent="saveAllocation"><fieldset :disabled="busy" style="border:0;padding:0"><div class="fields"><label>新商品已收款订单<select v-model.number="allocation.order_id" required @change="selectAllocation"><option :value="0" disabled>选择订单</option><option v-for="order in orders.filter(o => o.status === 'paid')" :key="order.id" :value="order.id">#{{ order.id }} {{ order.commercial.definition.name }} · 实收 ¥{{ order.amount }}</option></select></label><label>本次分配金额（手工填写）<input v-model="allocation.amount" inputmode="decimal" required></label><label>结算期<input v-model="allocation.period" type="month" required></label><label>金额说明<input v-model="allocation.note" required></label><label>有效获客成员<select v-model.number="allocation.acquisition_member_id"><option :value="0">未归因（暂留）</option><option v-for="member in members.filter(m => m.active)" :key="member.id" :value="member.id">{{ member.name }}</option></select></label><label>咨询成交成员<select v-model.number="allocation.closing_member_id"><option :value="0">未归因（暂留）</option><option v-for="member in members.filter(m => m.active)" :key="member.id" :value="member.id">{{ member.name }}</option></select></label></div><div class="actions"><label class="check"><input v-model="allocation.is_repeat_purchase" type="checkbox">复购（不再计新获客）</label><button class="primary" :disabled="!allocation.order_id">保存分配金额</button></div></fieldset></form><p class="hint">不会自动把实收填入此处。金额不得超过净实收；已结算订单只能追加调账。</p></section>
        <section class="panel panel--step"><h2>第二步：按商品和结算期预览</h2><form @submit.prevent="makePreview"><div class="fields"><label>已启用规则<select v-model.number="previewForm.policy_id" required><option :value="0" disabled>选择规则</option><option v-for="policy in policies.filter(p => p.status === 'active')" :key="policy.id" :value="policy.id">{{ policy.name }}</option></select></label><label>商品<select v-model="previewForm.product_sku" required><option :value="''" disabled>选择商品</option><option v-for="sku in previewPolicy?.product_skus || []" :key="sku" :value="sku">{{ productLabel(sku) }}</option></select></label><label>结算期<input v-model="previewForm.period" type="month" required></label></div><div class="actions"><button :disabled="busy">生成分配预览</button></div></form>
          <template v-if="preview"><p class="notice kst-reveal">本次分配总额 ¥{{ preview.total_amount }}。确认前会再次检查金额、归属及履约版本。</p><div class="table-wrap kst-reveal"><table><thead><tr><th>订单 / 子项</th><th>成员</th><th>金额</th><th>状态 / 原因</th></tr></thead><tbody><tr v-for="(line, index) in preview.lines_snapshot" :key="index"><td>#{{ line.order_id }} {{ line.label }}</td><td>{{ memberLabel(line.member_id) }}</td><td>{{ line.amount }}</td><td>{{ bucketText(line.bucket) }} {{ line.held_reasons.map(reasonText).join('、') }}</td></tr></tbody></table></div><div class="actions"><button class="primary" :disabled="busy || preview.status !== 'preview'" @click="confirmPreview">确认进入成员台账</button></div></template>
        </section>
      </div>
    </details>
    <details class="ledger-disclosure" data-testid="ledger-adjustment-settings"><summary><span><strong>退款与台账调整</strong><small>核对退款、释放暂留或补记调整，保留原始记录</small></span></summary><div class="ledger-disclosure-body"><TeamLedgerAdjustments :orders="orders" :members="members" :service-codes="serviceCodes" @changed="run(load)" /></div></details>
    <details class="ledger-disclosure" data-testid="ledger-rule-settings"><summary><span><strong>分配规则与承担人</strong><small>调整规则、适用商品和各分配项的负责成员</small></span></summary><div class="ledger-disclosure-body">
    <section class="panel"><h2>分配规则</h2><p class="hint">这里维护各套餐的分配规则草稿。比例只用于内部结算，不会显示在官网，也不会自动指定负责人。</p><div class="actions"><button type="button" :disabled="busy" @click="loadPolicyTemplate">载入新版分成方案</button></div><p class="hint">载入后先核对明细，再导入草稿并手动启用。不会替换已启用规则或修改历史记录，新规则的承担人需要重新确认。</p>
      <details class="ledger-policy-file" data-testid="ledger-policy-file"><summary>从规则文件导入</summary><label>选择规则文件<input type="file" accept=".json,application/json" :disabled="busy" @change="readPolicy"></label></details>
      <section v-if="policyDraft" class="ledger-policy-preview kst-reveal" aria-label="待导入规则预览">
        <h3>{{ policyDraft.name }}</h3><p class="hint">适用商品：{{ policyDraft.product_skus.map(productLabel).join('、') }}</p>
        <div class="ledger-policy-summary" data-testid="ledger-policy-summary"><span>{{ policyDraft.items.length }} 项</span><span>{{ policyDraftTotal === null ? '比例合计待核对' : `合计 ${policyDraftTotal}%` }}</span><span class="ledger-policy-unsaved">仅预览，尚未保存</span></div>
        <p id="ledger-policy-scroll-hint" class="hint ledger-policy-scroll-hint">{{ policyDraft.items.length > 8 ? '向下滚动查看其余分配项；请核对完整列表中的交付要求后再导入。' : '请核对各项比例、分配方式和交付要求后再导入。' }}</p>
        <div class="table-wrap" role="region" aria-label="规则明细预览" aria-describedby="ledger-policy-scroll-hint" tabindex="0"><table><thead><tr><th>板块 / 子项</th><th>占总分配金额</th><th>分配方式</th><th>交付核对</th></tr></thead><tbody><tr v-for="item in policyDraft.items" :key="item.code"><td>{{ item.group }} / {{ item.label }}</td><td>{{ displayRatio(item.ratio) }}%</td><td>{{ methodText(item.method) }}</td><td>{{ item.service_code ? '内部职责凭证' : '—' }}{{ item.purchased_service_codes.length ? ' · 对应已购服务次数' : '' }}</td></tr></tbody></table></div>
        <div class="actions"><button :disabled="busy" @click="importPolicy">导入为草稿</button></div>
      </section>
      <div class="table-wrap"><table><thead><tr><th>规则</th><th>版本 / 状态</th><th>适用商品</th><th>操作</th></tr></thead><tbody><tr v-for="policy in policies" :key="policy.id"><td>{{ policy.name }}</td><td>{{ policy.version }} / {{ policy.status === 'draft' ? '草稿' : '已启用' }}</td><td>{{ policy.product_skus.map(productLabel).join('、') }}</td><td><button v-if="policy.status === 'draft'" :disabled="busy" @click="activatePolicy(policy)">确认启用</button></td></tr></tbody></table></div>
    </section>
    <section class="panel"><h2>谁负责哪一项</h2><p class="hint">给每个分配项指定负责人；如果还没确定，勾选“暂留”，金额会留在待处理里。</p><form @submit.prevent="saveOwnership"><fieldset :disabled="busy" style="border:0;padding:0"><div class="fields"><label>使用哪套规则<select v-model.number="ownership.policy_id" required><option :value="0" disabled>选择规则</option><option v-for="policy in policies" :key="policy.id" :value="policy.id">{{ policy.name }}</option></select></label><label>适用商品<select v-model="ownership.product_sku" required><option value="" disabled>选择商品</option><option v-for="sku in ownershipPolicy?.product_skus || []" :key="sku" :value="sku">{{ productLabel(sku) }}</option></select></label><label>分配项<select v-model="ownership.item_code" required><option value="" disabled>选择分配项</option><option v-for="item in ownershipPolicy?.items.filter(i => i.method === 'fixed') || []" :key="item.code" :value="item.code">{{ item.label }}</option></select></label><label>开始日期<input v-model="ownership.starts_on" type="date" required></label><label>结束日期（可空）<input v-model="ownership.ends_on" type="date"></label></div>
      <div v-for="(owner, index) in ownership.members" :key="index" class="actions"><label>承担人<select v-model.number="owner.member_id"><option :value="0" disabled>选择成员</option><option v-for="member in members.filter(m => m.active)" :key="member.id" :value="member.id">{{ member.name }}</option></select></label><label>子项内部权重（0–1）<input v-model="owner.weight" inputmode="decimal" required></label><button type="button" @click="ownership.members.splice(index, 1)">移除</button></div>
      <div class="actions"><button type="button" @click="ownership.members.push({ member_id: 0, weight: '' })">添加承担人</button><label class="check"><input v-model="ownership.disputed" type="checkbox">归属存在争议，暂留</label><button class="primary">保存归属</button><button type="button" @click="ownership.id = 0; ownership.expected_version = 0; ownership.members = []">新建</button></div><p class="hint">内部权重须合计为 1；无人认领、权重不完整或有争议的子项整体暂留。</p></fieldset></form>
      <div class="table-wrap"><table><thead><tr><th>商品 / 分配项</th><th>生效期间</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="row in ownerships" :key="row.id"><td>{{ productLabel(row.product_sku) }} / {{ itemLabel(row.policy_id, row.item_code) }}</td><td>{{ row.starts_on }} — {{ row.ends_on || '长期' }}</td><td>{{ row.disputed ? '争议暂留' : `${row.members.length} 名承担人` }}</td><td><button :disabled="busy" @click="editOwnership(row)">编辑</button></td></tr></tbody></table></div>
    </section>
    </div></details>
    <p class="hint ledger-boundary">本页只记账，不发起转账。代理佣金与历史分润独立保留。<router-link to="/admin/profit">查看分配概览 →</router-link></p>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import { z } from 'zod'
import { api } from '@/utils/api'
import { confirmAction } from '@/shared/ui/confirm'
import { commercialApi, type CommercialOrder, type Envelope } from '@/features/admin/commercial'
import { useFrameworkTask } from '@/features/admin/useFrameworkTask'
import TeamLedgerAdjustments from '@/features/admin/TeamLedgerAdjustments.vue'
import '@/features/admin/framework.css'
const itemSchema = z.object({ code: z.string(), label: z.string(), group: z.string(), ratio: z.string(), method: z.enum(['fixed', 'acquisition', 'closing']).default('fixed'), service_code: z.string().nullable().optional(), purchased_service_codes: z.array(z.string()).max(20).default([]) }).strict()
const policySchema = z.object({ name: z.string(), product_skus: z.array(z.string()), items: z.array(itemSchema) }).strict()
type PolicyDraft = z.infer<typeof policySchema>
type Policy = PolicyDraft & { id: number; version: number; status: string }
interface Member { id: number; name: string; active: boolean; version: number; ledger_version: number }
interface Balances { due: string; held: string; paid: string; unpaid: string }
interface LedgerSummary { totals: Balances; members: Array<Member & Balances> }
interface Ownership { id: number; version: number; policy_id: number; product_sku: string; item_code: string; starts_on: string; ends_on: string | null; members: Array<{ member_id: number; weight: string }>; disputed: boolean }
interface Allocation { order_id: number; version: number; amount: string; period: string; note: string; acquisition_member_id: number | null; closing_member_id: number | null; is_repeat_purchase: boolean }
interface Preview { id: number; version: number; status: string; fingerprint: string; total_amount: string; lines_snapshot: Array<{ order_id: number; member_id: number | null; label: string; amount: string; bucket: string; held_reasons: string[] }> }
interface Entry { id: number; order_id: number | null; member_id: number | null; item_code: string | null; bucket: string; kind: string; amount: string; note: string }
const { busy, error, message, run } = useFrameworkTask()
const loadState = ref<'loading' | 'ready' | 'error'>('loading'), loadError = ref('')
const policies = ref<Policy[]>([]), policyDraft = ref<PolicyDraft | null>(null), members = ref<Member[]>([]), memberName = ref('')
const orders = ref<CommercialOrder[]>([]), allocations = ref<Allocation[]>([]), ownerships = ref<Ownership[]>([]), entries = ref<Entry[]>([])
const summary = ref<LedgerSummary | null>(null)
const balanceMetrics: Array<{ key: keyof Balances; label: string; note: string }> = [
  { key: 'due', label: '累计应分', note: '已确认收入，包含已付部分' },
  { key: 'held', label: '暂留金额', note: '待核对，尚未计入应分' },
  { key: 'paid', label: '累计已付', note: '已登记的线下付款' },
  { key: 'unpaid', label: '待付款', note: '累计应分减去已付' },
]
const memberSearch = ref(''), balanceFilter = ref('all')
const entryMember = ref('all'), orderSearch = ref(''), entryBucket = ref('all')
const filteredMembers = computed(() => (summary.value?.members || []).filter(member => {
  const matchesName = member.name.toLocaleLowerCase().includes(memberSearch.value.trim().toLocaleLowerCase())
  // Display filtering only: all monetary totals still come from the server summary.
  const matchesBalance = balanceFilter.value === 'all' || Number(member[balanceFilter.value as 'unpaid' | 'held']) > 0
  return matchesName && matchesBalance
}))
const entryMemberOptions = computed(() => {
  const options = new Map(members.value.map(member => [member.id, { id: member.id, name: member.name }]))
  for (const entry of entries.value) {
    if (entry.member_id !== null && !options.has(entry.member_id)) options.set(entry.member_id, { id: entry.member_id, name: `成员 #${entry.member_id}` })
  }
  return [...options.values()]
})
const entriesFiltered = computed(() => entryMember.value !== 'all' || !!orderSearch.value || entryBucket.value !== 'all')
const filteredEntries = computed(() => entries.value.filter(entry => {
  const matchesMember = entryMember.value === 'all' || (entryMember.value === 'unassigned' ? entry.member_id === null : String(entry.member_id) === entryMember.value)
  const search = orderSearch.value.trim().toLocaleLowerCase().replace(/^#/, '')
  const order = orders.value.find(item => item.id === entry.order_id)
  const matchesOrder = !search || (entry.order_id !== null && (String(entry.order_id) === search || !!order?.order_no.toLocaleLowerCase().includes(search)))
  return matchesMember && matchesOrder && (entryBucket.value === 'all' || entry.bucket === entryBucket.value)
}))
function clearEntryFilters() { entryMember.value = 'all'; orderSearch.value = ''; entryBucket.value = 'all' }
const ownership = reactive({ id: 0, expected_version: 0, policy_id: 0, product_sku: '', item_code: '', starts_on: '', ends_on: '', members: [] as Array<{ member_id: number; weight: string }>, disputed: false })
const ownershipPolicy = computed(() => policies.value.find(p => p.id === ownership.policy_id))
const allocation = reactive({ order_id: 0, expected_version: 0, amount: '', period: '', note: '', acquisition_member_id: 0, closing_member_id: 0, is_repeat_purchase: false })
const previewForm = reactive({ policy_id: 0, product_sku: '', period: '' })
const previewPolicy = computed(() => policies.value.find(p => p.id === previewForm.policy_id))
const serviceCodes = computed(() => [...new Map(policies.value.flatMap(p => p.items.filter(i => i.service_code).map(i => [i.service_code!, { code: i.service_code!, label: i.label }] as const))).values()])
const preview = ref<Preview | null>(null)
const payment = reactive({ member_id: 0, amount: '', evidence: '', note: '', expected_ledger_version: 0, idempotency_key: '' })
const read = <T,>(path: string) => api.get<T>(`/api/team-ledger/${path}`, {}, { cache: false })
const memberLabel = (id: number | null) => id === null ? '未分配' : members.value.find(m => m.id === id)?.name || `成员 #${id}`
const orderLabel = (id: number) => orders.value.find(order => order.id === id)?.order_no || `订单 #${id}`
function entryItemLabel(entry: Entry) {
  // The payment API creates an unallocated, member-level payment record.
  if (entry.kind === 'payment' && !entry.item_code) return '线下付款'
  if (!entry.item_code) return '分配项待核对'
  const labels = new Set(policies.value.flatMap(policy => policy.items
    .filter(item => item.code === entry.item_code && item.label.trim())
    .map(item => item.label.trim())))
  return labels.size === 1 ? [...labels][0] : '分配项待核对'
}
const productLabel = (sku: string) => orders.value.find(order => order.commercial.sku === sku)?.commercial.definition.name || ({
  'competition-basic': '比赛基础包',
  'competition-full': '比赛完整包',
  'competition-guided': '比赛工具与指导包',
  'training-full': '实训完整工具包',
  'free-trial': '免费体验',
}[sku] || '其他商品（名称待补充）')
const itemLabel = (policyId: number, code: string) => policies.value.find(policy => policy.id === policyId)?.items.find(item => item.code === code)?.label || code
const displayRatio = (ratio: string) => (Number(ratio) * 100).toFixed(2).replace(/\.00$/, '')
// Preview annotation only; the server still validates and calculates all ledger amounts.
const policyDraftTotal = computed(() => {
  const ratios = policyDraft.value?.items.map(item => Number(item.ratio)) || []
  if (!ratios.length || ratios.some(ratio => !Number.isFinite(ratio))) return null
  return (ratios.reduce((sum, ratio) => sum + ratio, 0) * 100).toFixed(6).replace(/\.?0+$/, '')
})
const methodText = (method: string) => ({ fixed: '按子项承担人', acquisition: '有效获客净实收', closing: '咨询成交净实收' }[method] || method)
const bucketText = (bucket: string) => ({ due: '应分', held: '暂留', paid: '已付' }[bucket] || bucket)
const reasonText = (reason: string) => ({ unassigned: '无人认领', disputed: '归属争议', service_unfulfilled: '服务未完成', incomplete_ownership: '权重未完整', inactive_member: '成员停用', missing_attribution: '缺少归因' }[reason] || reason)
async function load() {
  loadState.value = 'loading'; loadError.value = ''
  summary.value = null
  try {
    const result = await Promise.all([read<Policy[]>('policies'), read<Member[]>('members'), read<Ownership[]>('ownerships'), read<Allocation[]>('allocations'), read<Entry[]>('entries'), read<LedgerSummary>('summary'), commercialApi.orders()])
    const values = result[5]
    if (!values?.totals || !Array.isArray(values.members) || !['due', 'held', 'paid', 'unpaid'].every(key => /^-?\d+(?:\.\d{1,2})?$/.test(String(values.totals[key as keyof Balances] ?? '')))) throw new Error('成员余额数据不完整，请刷新后重试')
    ;[policies.value, members.value, ownerships.value, allocations.value, entries.value, summary.value, orders.value] = result
    loadState.value = 'ready'
  } catch (cause) {
    loadState.value = 'error'; loadError.value = cause instanceof Error && cause.message ? cause.message : '请稍后重试'
    throw cause
  }
}
async function addMember() { await run(async () => { await api.post('/api/team-ledger/members', { name: memberName.value }); memberName.value = ''; await load() }) }
async function loadPolicyTemplate() { await run(async () => { policyDraft.value = null; const parsed = policySchema.safeParse(await read<unknown>('policy-template')); if (!parsed.success) throw new Error('新版分成方案格式不完整，请联系管理员核对后重试'); policyDraft.value = parsed.data }) }
async function readPolicy(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; await run(async () => { policyDraft.value = null; if (file.size > 256000) throw new Error('配置文件不能超过 256 KB'); policyDraft.value = policySchema.parse(JSON.parse(await file.text())) }) }
async function importPolicy() { await run(async () => { if (!policyDraft.value) return; await api.post('/api/team-ledger/policies', policyDraft.value); policyDraft.value = null; await load() }, '策略已保存为草稿，尚未启用') }
async function activatePolicy(policy: Policy) { await run(async () => { if (!await confirmAction({ title: '确认启用分配策略', message: `${policy.name} 将用于人工选择的后续结算，不回算旧账。确认启用？` })) return; await api.post(`/api/team-ledger/policies/${policy.id}/activate`, { expected_version: policy.version }); await load() }) }
function editOwnership(row: Ownership) { Object.assign(ownership, row, { expected_version: row.version, ends_on: row.ends_on || '', members: row.members.map(m => ({ ...m })) }) }
async function saveOwnership() { await run(async () => { const body = { policy_id: ownership.policy_id, item_code: ownership.item_code, product_sku: ownership.product_sku, starts_on: ownership.starts_on, ends_on: ownership.ends_on || null, members: ownership.members, disputed: ownership.disputed }; if (ownership.id) await api.put(`/api/team-ledger/ownerships/${ownership.id}`, { ...body, expected_version: ownership.expected_version }); else await api.post('/api/team-ledger/ownerships', body); await load(); ownership.id = 0; ownership.expected_version = 0; ownership.members = [] }, '承担人配置已保存') }
function selectAllocation() { const row = allocations.value.find(a => a.order_id === allocation.order_id); Object.assign(allocation, { expected_version: row?.version || 0, amount: row?.amount || '', period: row?.period || '', note: row?.note || '', acquisition_member_id: row?.acquisition_member_id || 0, closing_member_id: row?.closing_member_id || 0, is_repeat_purchase: row?.is_repeat_purchase || false }) }
async function saveAllocation() { await run(async () => { const { order_id, ...body } = allocation; await api.put(`/api/team-ledger/orders/${order_id}/allocation`, { ...body, acquisition_member_id: body.acquisition_member_id || null, closing_member_id: body.closing_member_id || null }); await load(); selectAllocation(); preview.value = null }, '分配金额已保存，尚未记入成员收入') }
async function makePreview() { await run(async () => { const result = await api.post<Envelope<Preview>>('/api/team-ledger/settlements/preview', { ...previewForm }); preview.value = result.data }) }
async function confirmPreview() { await run(async () => { const current = preview.value; if (!current || !await confirmAction({ title: '确认结算', message: `总额 ¥${current.total_amount}，包含明确标示的暂留项。确认后生成不可覆盖的成员明细。` })) return; const result = await api.post<Envelope<Preview>>(`/api/team-ledger/settlements/${current.id}/confirm`, { expected_version: current.version, fingerprint: current.fingerprint }); preview.value = result.data; await load() }) }
function selectPayment(member: Member) { Object.assign(payment, { member_id: member.id, expected_ledger_version: member.ledger_version, amount: '', note: '', evidence: '', idempotency_key: crypto.randomUUID() }) }
async function pay() { await run(async () => { const body = { ...payment }; if (!await confirmAction({ title: '登记已发生的线下付款', message: `向 ${memberLabel(body.member_id)} 实际支付 ¥${body.amount}。此操作只记账，不发起转账。` })) return; await api.post('/api/team-ledger/payments', body); payment.member_id = 0; await load() }) }
onMounted(() => run(load))
</script>

<style scoped>
.ledger-overview { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 20px; }
.ledger-overview > div { display: grid; min-width: 0; align-content: start; gap: 8px; padding: 20px; border: 1px solid var(--color-border, #e4e7ec); border-radius: 12px; background: white; }
.ledger-overview span, .ledger-overview small { color: var(--color-text-secondary, #475467); }
.ledger-overview span { font-size: 13px; }
.ledger-overview strong { font-size: 24px; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ledger-overview small { font-size: 12px; line-height: 1.6; }
.ledger-section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
.ledger-section-heading > div { min-width: 0; }
.ledger-section-heading h2 { margin: 0; }
.ledger-section-heading p { margin: 6px 0 0; }
.ledger-section-heading > button { flex: none; }
.ledger-filters { display: grid; align-items: end; gap: 12px; margin: 0 0 18px; }
.ledger-filters--members { grid-template-columns: minmax(180px, 280px) minmax(150px, 200px) max-content; }
.ledger-filters--entries { grid-template-columns: minmax(140px, 1fr) minmax(180px, 1.4fr) minmax(130px, 1fr); }
.ledger-filters > button { justify-self: start; }
.ledger-filters--entries > button { grid-column: 1 / -1; }
.ledger-record-count { margin: -4px 0 14px; }
.ledger-balances-table th, .ledger-balances-table td { vertical-align: middle; }
.ledger-balances-table th:last-child { width: 144px; }
.ledger-balances-table td:first-child { min-width: 75px; max-width: 180px; overflow-wrap: anywhere; }
.ledger-balances-table .amount, .ledger-entries-table .amount { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ledger-balances-table th:nth-child(n+2):nth-child(-n+5), .ledger-entries-table th:nth-child(4) { text-align: right; }
.ledger-entries-table { table-layout: fixed; }
.ledger-entries-table th:nth-child(1) { width: 23%; }
.ledger-entries-table th:nth-child(2) { width: 23%; }
.ledger-entries-table th:nth-child(3) { width: 12%; }
.ledger-entries-table th:nth-child(4) { width: 15%; }
.ledger-entries-table td { overflow-wrap: anywhere; }
.ledger-entries-table strong { display: block; font-size: 13px; font-weight: 500; }
.ledger-entries-table small { display: block; margin-top: 5px; color: var(--color-text-secondary, #475467); font-size: 12px; line-height: 1.6; }
.panel > .table-wrap { max-height: 440px; overflow: auto; }
.panel > .table-wrap th { position: sticky; top: 0; z-index: 1; background: white; }
.ledger-add-member { margin-top: 16px; border-top: 1px solid var(--color-border, #e4e7ec); padding-top: 14px; }
.ledger-add-member > summary { cursor: pointer; width: fit-content; font-size: 13px; color: var(--color-primary, #315fbc); }
.ledger-payment { padding: 20px; margin-top: 20px; background: var(--color-bg-secondary, #f8fafc); border: 1px solid var(--color-border, #e4e7ec); border-radius: 8px; }
.ledger-payment h3 { margin: 0; font-size: 15px; }
.ledger-payment > p { margin: 8px 0 16px; }
.ledger-disclosure { margin-top: 16px; border: 1px solid var(--color-border, #e4e7ec); border-radius: 12px; background: white; }
.ledger-disclosure > summary { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 18px 24px; cursor: pointer; list-style: none; }
.ledger-disclosure > summary::-webkit-details-marker { display: none; }
.ledger-disclosure > summary::after { content: '+'; color: var(--color-text-secondary, #475467); font-size: 20px; font-weight: 400; }
.ledger-disclosure[open] > summary::after { content: '−'; }
.ledger-disclosure strong { display: block; font-size: 15px; font-weight: 600; }
.ledger-disclosure small { display: block; margin-top: 5px; color: var(--color-text-secondary, #475467); font-size: 12px; line-height: 1.6; }
.ledger-disclosure-body { padding: 0 24px 24px; border-top: 1px solid var(--color-border, #e4e7ec); }
.ledger-disclosure-body > .panel { border-radius: 0; border: 0; padding: 20px 0 0; margin-top: 0; }
.ledger-disclosure-body > .panel + .panel { margin-top: 24px; border-top: 1px solid var(--color-border, #e4e7ec); }
.ledger-policy-file { margin: 16px 0; }
.ledger-policy-file > summary { cursor: pointer; width: fit-content; font-size: 13px; color: var(--color-primary, #315fbc); }
.ledger-policy-file > label { max-width: 420px; margin-top: 12px; }
.ledger-policy-preview { margin: 20px 0; padding-top: 18px; border-top: 1px solid var(--color-border, #e4e7ec); }
.ledger-policy-preview h3 { margin: 0; font-size: 15px; font-weight: 600; }
.ledger-policy-preview > p { margin: 8px 0; }
.ledger-policy-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; margin: 14px 0 10px; font-size: 13px; font-variant-numeric: tabular-nums; }
.ledger-policy-unsaved { padding: 4px 8px; border-radius: 4px; background: var(--color-bg-secondary, #f8fafc); color: var(--color-text-secondary, #475467); }
.ledger-policy-preview > .ledger-policy-scroll-hint { margin-bottom: 12px; }
.ledger-policy-preview > .table-wrap { max-height: 440px; overflow: auto; scrollbar-gutter: stable; }
.ledger-policy-preview th { position: sticky; top: 0; z-index: 1; background: white; }
.ledger-boundary { margin: 18px 0 0; }
.ledger-boundary a { margin-left: 12px; color: var(--color-primary, #315fbc); text-decoration: none; white-space: nowrap; }
@media (max-width: 1100px) { .ledger-overview { gap: 10px; } .ledger-overview > div { padding: 16px; } .ledger-overview strong { font-size: 22px; } }
@media (max-width: 760px) { .ledger-overview { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ledger-filters--members, .ledger-filters--entries { grid-template-columns: minmax(0, 1fr); } .ledger-section-heading { flex-wrap: wrap; } .ledger-entries-table { min-width: 600px; } .ledger-disclosure > summary { padding: 18px 20px; } .ledger-disclosure-body { padding: 0 20px 20px; } }
</style>
