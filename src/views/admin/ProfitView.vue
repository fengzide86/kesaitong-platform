<template>
  <div class="profit-page">
    <PageHeader title="分润管理" description="查看已确认的成员收入、待处理款项和内部规则；历史订单按原记录保留。" />
    <section class="profit-panel" aria-label="成员台账状态">
      <div class="section-heading"><div><h2>成员台账</h2><p>以下为全部平台的真实台账余额，包含已确认的退款和调账。</p></div><router-link to="/admin/team-ledger" class="action-link">打开成员台账 →</router-link></div>
      <AsyncStateNotice :state="ledgerState" :message="ledgerError" loading-text="正在读取成员台账…" @retry="loadLedger" />
      <div v-if="ledgerSummary && ledgerState === 'data'" class="balance-grid">
        <article data-testid="ledger-due"><span>累计应分</span><strong>¥{{ ledgerSummary.due }}</strong><small>已确认的成员收入，包含已付部分</small></article>
        <article data-testid="ledger-held"><span>暂留</span><strong>¥{{ ledgerSummary.held }}</strong><small>归属、履约或争议还待处理</small></article>
        <article data-testid="ledger-paid"><span>已付</span><strong>¥{{ ledgerSummary.paid }}</strong><small>已登记的实际线下付款</small></article>
        <article data-testid="ledger-unpaid"><span>尚未支付</span><strong>¥{{ ledgerSummary.unpaid }}</strong><small>累计应分减去已付，由台账计算</small></article>
      </div>
      <p v-else class="data-note">成员余额尚未加载，不能按零余额理解。</p>
      <p class="data-note">收到款项后，仍需填写“本次分配金额”、核对预览并确认，才会进入成员收入。</p>
    </section>
    <section class="profit-panel" aria-label="内部规则">
      <div class="section-heading"><div><h2>已启用的分配规则</h2><p>比例来自管理端保存的规则，以人工填写的分配金额为基数；这里不重算历史收入。</p></div><router-link v-if="canEditPolicy" to="/admin/team-ledger" class="action-link">管理规则与负责人 →</router-link></div>
      <AsyncStateNotice :state="policyState" :message="policyError" loading-text="正在读取内部规则…" @retry="loadPolicies" />
      <template v-if="policyState !== 'error' && policyState !== 'loading'">
        <label v-if="activePolicies.length" class="policy-picker">查看规则<select v-model.number="selectedPolicyId"><option v-for="policy in activePolicies" :key="policy.id" :value="policy.id">{{ policy.name }} · 第 {{ policy.version }} 版</option></select></label>
        <div v-if="selectedPolicy" class="policy-groups"><article v-for="group in policyGroups" :key="group.name"><h3>{{ group.name }}</h3><ul><li v-for="item in group.items" :key="item.code"><span>{{ item.label }}</span><strong>{{ formatRatio(item.ratio) }}%</strong></li></ul></article></div>
        <p v-else class="data-note">待配置：尚未启用分配规则。请先在成员台账中核对并启用规则。</p>
      </template>
      <p v-else class="data-note">规则尚未加载，暂不显示比例。</p>
    </section>
    <section class="profit-panel" aria-label="近期调账">
      <div class="section-heading"><div><h2>近期调账</h2><p>仅查看最近 200 条台账中的调整记录，不作为全部调账金额汇总；每条记录保留原始正负金额。</p></div><router-link to="/admin/team-ledger" class="action-link">处理调账 →</router-link></div>
      <AsyncStateNotice :state="entryState" :message="entryError" loading-text="正在读取近期调账…" @retry="loadEntries" />
      <template v-if="entryState !== 'error' && entryState !== 'loading'">
        <div v-if="adjustments.length" class="table-wrap"><table><thead><tr><th>订单</th><th>调整内容</th><th>变动金额</th><th>说明</th></tr></thead><tbody><tr v-for="entry in adjustments" :key="entry.id"><td>{{ entry.order_id ? `#${entry.order_id}` : '成员账务' }}</td><td>{{ bucketLabel(entry.bucket) }}</td><td>{{ entry.amount }} 元</td><td>{{ entry.note }}</td></tr></tbody></table></div>
        <p v-else class="data-note">最近读取的 {{ ledgerEntries.length }} 条台账中没有调账记录。</p>
      </template>
    </section>
    <section class="profit-panel" aria-label="历史分润快照">
      <div class="section-heading"><div><h2>旧订单历史分润</h2><p>以下按所选平台查看，保留当时的角色和金额快照，与上方成员台账独立。</p></div></div>
      <AsyncStateNotice :state="loadState" :message="loadError" loading-text="正在加载历史汇总…" @retry="loadData" />
      <p v-if="loadState !== 'loading' && loadState !== 'error'" class="data-note">历史有效金额：¥{{ formatMoney(summary.grand_total) }} · 已冲正：¥{{ formatMoney(summary.reversed_total) }}</p>
      <div class="section-heading"><p>共 {{ recordTotal }} 笔 · 含已冲正记录</p><el-select v-model="recordStatus" aria-label="历史分润状态" style="width: 132px"><el-option label="全部状态" value="" /><el-option label="有效" value="active" /><el-option label="已冲正" value="reversed" /></el-select></div>
      <AsyncStateNotice :state="recordState" :message="recordError" loading-text="正在加载历史明细…" @retry="loadRecords" />
      <el-table v-if="recordState !== 'error' && recordState !== 'loading'" :data="records" stripe>
        <el-table-column prop="order_id" label="关联订单" width="100" />
        <el-table-column label="收款金额" width="120"><template #default="{ row }">¥{{ formatMoney(row.order_amount_snapshot) }}</template></el-table-column>
        <el-table-column prop="policy_version" label="当时规则版本" width="120" />
        <el-table-column v-for="item in legacyItems" :key="item.key" :label="item.label" width="100"><template #default="{ row }">¥{{ formatMoney(row[`${item.key}_share`]) }}</template></el-table-column>
        <el-table-column label="状态" min-width="160"><template #default="{ row }">{{ row.status === 'reversed' ? '已冲正' : '有效' }}<small v-if="row.reversal_reason"> · {{ row.reversal_reason }}</small></template></el-table-column>
      </el-table>
      <div class="ledger-pagination"><el-pagination :current-page="recordPage" :page-size="20" :total="recordTotal" :pager-count="5" layout="prev, pager, next" @current-change="changeRecordPage" /></div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { z } from 'zod'
import { api, getProfitPage, getProfitSummary } from '@/utils/api'
import { usePlatformStore } from '@/stores/platform'
import { authService } from '@/utils/auth'
import { profitRecordSchema, profitSummarySchema, type ProfitRecord } from '@/features/admin/model'
import { hasStaffPermission } from '@/features/auth/permissions'
import { failedDataState, type AsyncDataState } from '@/features/async/state'
import AsyncStateNotice from '@/components/AsyncStateNotice.vue'
import PageHeader from '@/components/PageHeader.vue'

// Missing amounts are errors, not zero balances. Decimal strings stay unchanged for display.
const decimal = z.string().regex(/^-?\d+(?:\.\d{1,2})?$/)
const balancesSchema = z.object({ due: decimal, held: decimal, paid: decimal, unpaid: decimal })
const ledgerSchema = z.object({ totals: balancesSchema })
const policiesSchema = z.array(z.object({
  id: z.number().int().positive(), name: z.string().min(1), version: z.number().int().positive(), status: z.enum(['draft', 'active']),
  items: z.array(z.object({ code: z.string(), label: z.string(), group: z.string(), ratio: z.string().regex(/^(?:0(?:\.\d{1,8})?|1(?:\.0{1,8})?)$/) })),
}))
const entriesSchema = z.array(z.object({ id: z.number(), order_id: z.number().nullable(), bucket: z.enum(['due', 'held', 'paid']), kind: z.string(), amount: decimal, note: z.string() }))
const ledgerSummary = ref<z.infer<typeof balancesSchema> | null>(null)
const policies = ref<z.infer<typeof policiesSchema>>([]), ledgerEntries = ref<z.infer<typeof entriesSchema>>([])
const ledgerState = ref<AsyncDataState>('loading'), policyState = ref<AsyncDataState>('loading'), entryState = ref<AsyncDataState>('loading')
const ledgerError = ref(''), policyError = ref(''), entryError = ref(''), selectedPolicyId = ref(0)
const activePolicies = computed(() => policies.value.filter(policy => policy.status === 'active'))
const selectedPolicy = computed(() => activePolicies.value.find(policy => policy.id === selectedPolicyId.value))
const policyGroups = computed(() => {
  const groups = new Map<string, z.infer<typeof policiesSchema>[number]['items']>()
  for (const item of selectedPolicy.value?.items || []) groups.set(item.group, [...(groups.get(item.group) || []), item])
  return [...groups].map(([name, items]) => ({ name, items }))
})
const adjustments = computed(() => ledgerEntries.value.filter(entry => entry.kind === 'adjustment'))
const bucketLabel = (bucket: string) => ({ due: '应分调整', held: '暂留调整', paid: '付款调整' }[bucket] || '账务调整')
const formatRatio = (ratio: string) => Number((Number(ratio) * 100).toFixed(6)).toString()
const summary = ref(profitSummarySchema.parse({}))
const loadState = ref<AsyncDataState>('loading'), loadError = ref(''), hasLoaded = ref(false)
const records = ref<ProfitRecord[]>([]), recordPage = ref(1), recordTotal = ref(0), recordStatus = ref('')
const recordState = ref<AsyncDataState>('loading'), recordError = ref('')
let loadSequence = 0, recordSequence = 0, ledgerSequence = 0, policySequence = 0, entrySequence = 0
const platformStore = usePlatformStore()
const canEditPolicy = computed(() => hasStaffPermission(authService.getRole(), 'profit.policy.write'))
const legacyItems = [{ key: 'tech', label: '技术' }, { key: 'market', label: '市场' }, { key: 'product', label: '产品' }, { key: 'service', label: '客服' }, { key: 'coordination', label: '统筹' }, { key: 'record', label: '记录' }]
const formatMoney = (value: number) => value.toFixed(2)

async function loadLedger() {
  const sequence = ++ledgerSequence
  ledgerState.value = 'loading'; ledgerError.value = ''
  try {
    const response = ledgerSchema.parse(await api.get('/api/team-ledger/summary', {}, { cache: false }))
    if (sequence !== ledgerSequence) return
    ledgerSummary.value = response.totals; ledgerState.value = 'data'
  } catch {
    if (sequence !== ledgerSequence) return
    ledgerSummary.value = null; ledgerState.value = 'error'; ledgerError.value = '成员余额未加载成功，请重试；此时不能判断余额为零。'
  }
}
async function loadPolicies() {
  const sequence = ++policySequence
  policyState.value = 'loading'; policyError.value = ''
  try {
    const response = policiesSchema.parse(await api.get('/api/team-ledger/policies', {}, { cache: false }))
    if (sequence !== policySequence) return
    policies.value = response
    if (!activePolicies.value.some(policy => policy.id === selectedPolicyId.value)) selectedPolicyId.value = activePolicies.value[0]?.id || 0
    policyState.value = activePolicies.value.length ? 'data' : 'empty'
  } catch {
    if (sequence !== policySequence) return
    policies.value = []; policyState.value = 'error'; policyError.value = '内部规则未加载成功，请重试。'
  }
}
async function loadEntries() {
  const sequence = ++entrySequence
  entryState.value = 'loading'; entryError.value = ''
  try {
    const response = entriesSchema.parse(await api.get('/api/team-ledger/entries', { limit: 200 }, { cache: false }))
    if (sequence !== entrySequence) return
    ledgerEntries.value = response; entryState.value = response.length ? 'data' : 'empty'
  } catch {
    if (sequence !== entrySequence) return
    ledgerEntries.value = []; entryState.value = 'error'; entryError.value = '近期调账记录未加载成功，请重试。'
  }
}
async function loadRecords() {
  const sequence = ++recordSequence
  recordState.value = records.value.length ? 'data' : 'loading'; recordError.value = ''
  try {
    const response = await getProfitPage({ page: recordPage.value, page_size: 20, status: recordStatus.value || undefined, platform_key: platformStore.adminPlatform === 'all' ? undefined : platformStore.adminPlatform })
    if (sequence !== recordSequence) return
    records.value = response.items.map(item => profitRecordSchema.parse(item)); recordTotal.value = response.total
    recordState.value = records.value.length ? 'data' : 'empty'
  } catch (error) {
    if (sequence !== recordSequence) return
    recordError.value = error instanceof Error ? error.message : '历史分润明细加载失败'
    recordState.value = failedDataState(records.value.length > 0)
  }
}
function changeRecordPage(page: number) { recordPage.value = page; void loadRecords() }
async function loadData() {
  const sequence = ++loadSequence
  loadState.value = hasLoaded.value ? 'data' : 'loading'; loadError.value = ''
  try {
    const platformKey = platformStore.adminPlatform !== 'all' ? platformStore.adminPlatform : undefined
    const response = await getProfitSummary(platformKey ? { platform_key: platformKey } : {})
    if (sequence !== loadSequence) return
    summary.value = profitSummarySchema.parse(response); hasLoaded.value = true
    loadState.value = summary.value.grand_total > 0 ? 'data' : 'empty'
  } catch (error) {
    if (sequence !== loadSequence) return
    loadError.value = error instanceof Error ? error.message : '历史分润汇总未加载成功'
    loadState.value = failedDataState(hasLoaded.value)
  }
}
watch(() => platformStore.adminPlatform, () => { void loadData() })
watch([() => platformStore.adminPlatform, recordStatus], () => { recordPage.value = 1; void loadRecords() })
onMounted(() => { void loadData(); void loadRecords(); void loadLedger(); void loadPolicies(); void loadEntries() })
onBeforeUnmount(() => { loadSequence++; recordSequence++; ledgerSequence++; policySequence++; entrySequence++ })
</script>

<style scoped>
.profit-page { display: grid; gap: 20px; }
.profit-panel { min-width: 0; padding: 24px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.section-heading h2 { margin: 0; font-size: 18px; }
.section-heading p, .data-note { margin: 6px 0 0; color: var(--color-text-secondary); font-size: 13px; line-height: 1.7; }
.data-note { margin-top: 14px; }
.action-link { color: var(--color-primary); font-size: 14px; font-weight: 600; text-decoration: none; }
.action-link:hover { text-decoration: underline; }
.balance-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.balance-grid article { display: grid; gap: 8px; min-width: 0; padding: 18px; border-radius: var(--radius-md); background: var(--color-surface-soft); }
.balance-grid span, .balance-grid small { color: var(--color-text-secondary); font-size: 12px; line-height: 1.6; }
.balance-grid strong { color: var(--color-text); font-size: 24px; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.policy-picker { display: grid; gap: 8px; max-width: 480px; margin-bottom: 16px; font-size: 14px; }
.policy-picker select { width: 100%; min-height: 40px; padding: 8px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: inherit; font: inherit; }
.policy-groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.policy-groups article { min-width: 0; padding: 16px; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.policy-groups h3 { margin: 0 0 12px; font-size: 15px; }
.policy-groups ul { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.policy-groups li { display: flex; justify-content: space-between; gap: 12px; color: var(--color-text-secondary); font-size: 13px; line-height: 1.6; }
.policy-groups strong { color: var(--color-text); white-space: nowrap; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 12px; border-bottom: 1px solid var(--color-border); text-align: left; }
th { color: var(--color-text-secondary); white-space: nowrap; }
.ledger-pagination { display: flex; justify-content: flex-end; margin-top: 16px; overflow-x: auto; }
:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 3px; }
@media (max-width: 1100px) { .balance-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .profit-panel { padding: 16px; } .balance-grid, .policy-groups { grid-template-columns: 1fr; } }
</style>
