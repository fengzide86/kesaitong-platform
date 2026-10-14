<template>
  <section class="commission-page">
    <div class="page-heading">
      <div>
        <span class="eyebrow">返佣明细</span>
        <h1>返佣结算</h1>
        <p>按已确认收款金额和平台为你配置的比例计提。这里仅展示账目，不会自动转账。</p>
      </div>
      <el-button :loading="loading || entriesLoading || settlementsLoading" @click="refreshAll">刷新</el-button>
    </div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="state-alert" />
    <div v-loading="loading" class="summary-grid" aria-label="返佣汇总">
      <article v-for="item in summaryItems" :key="item.key" class="summary-card">
        <span>{{ item.label }}</span>
        <strong>{{ summary ? money(summary[item.key]) : '—' }}</strong>
        <small>{{ item.note }}</small>
      </article>
    </div>
    <section class="ledger-card">
      <header class="section-heading">
        <div><h2>返佣明细</h2><p>每一笔已确认收款或退款冲正都会保留记录。</p></div>
        <el-radio-group v-model="settledFilter" @change="onFilterChange">
          <el-radio-button label="all">全部</el-radio-button>
          <el-radio-button label="pending">待结算</el-radio-button>
          <el-radio-button label="settled">已结算</el-radio-button>
        </el-radio-group>
      </header>
      <el-alert v-if="entriesError" :title="entriesError" type="error" :closable="false" show-icon class="state-alert" />
      <el-table v-loading="entriesLoading" :data="entries" stripe row-key="id" class="ledger-table">
        <el-table-column prop="occurred_at" label="发生时间" min-width="170"><template #default="{ row }">{{ formatDate(row.occurred_at) }}</template></el-table-column>
        <el-table-column prop="order_no" label="订单编号" min-width="170" />
        <el-table-column label="类型" width="110"><template #default="{ row }"><el-tag :type="row.kind === 'refund' ? 'danger' : 'success'" effect="plain">{{ row.kind === 'refund' ? '退款冲正' : '确认收款' }}</el-tag></template></el-table-column>
        <el-table-column label="订单金额" width="130" align="right"><template #default="{ row }">{{ money(row.order_amount_snapshot) }}</template></el-table-column>
        <el-table-column label="返佣金额" width="130" align="right"><template #default="{ row }"><span :class="{ negative: row.amount < 0 }">{{ money(row.amount) }}</span></template></el-table-column>
        <el-table-column label="结算状态" width="150"><template #default="{ row }">{{ row.settlement_id ? `已结算 #${row.settlement_id}` : '待结算' }}</template></el-table-column>
        <template #empty><div class="empty-state">暂无符合条件的返佣记录</div></template>
      </el-table>
      <div class="pager-row">
        <span>共 {{ total }} 条记录</span>
        <el-pagination v-model:current-page="page" v-model:page-size="pageSize" layout="prev, pager, next" :total="total" :page-sizes="[20]" @current-change="loadEntries" />
      </div>
    </section>
    <section class="settlement-card">
      <header class="section-heading">
        <div><h2>线下结算记录</h2><p>仅记录平台负责人已确认的线下结算，不会自动转账。</p></div>
      </header>
      <el-alert v-if="settlementsError" :title="settlementsError" type="error" :closable="false" show-icon class="state-alert" />
      <el-table v-loading="settlementsLoading" :data="settlements" stripe row-key="id" class="ledger-table">
        <el-table-column prop="month" label="结算月份" width="130" />
        <el-table-column label="结算金额" width="140" align="right"><template #default="{ row }">{{ money(row.amount) }}</template></el-table-column>
        <el-table-column prop="count" label="包含笔数" width="110" align="right" />
        <el-table-column label="确认时间" min-width="180"><template #default="{ row }">{{ formatDate(row.confirmed_at) }}</template></el-table-column>
        <el-table-column prop="note" label="备注" min-width="220" show-overflow-tooltip />
        <template #empty><div class="empty-state">暂无线下结算记录</div></template>
      </el-table>
      <div class="pager-row" v-if="settlementsTotal > settlementPageSize">
        <span>共 {{ settlementsTotal }} 条记录</span>
        <el-pagination v-model:current-page="settlementPage" :page-size="settlementPageSize" layout="prev, pager, next" :total="settlementsTotal" @current-change="loadSettlements" />
      </div>
    </section>
    <p class="boundary">平台负责人按月核对并登记线下结算；退款会生成对应的冲正记录，不会删除历史账目。</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { agencyApi } from './api'
import { money } from './model'
import type { CommissionEntry, CommissionSettlement, CommissionSummary } from './commission-model'
import { authService } from '@/utils/auth'

const summary = ref<CommissionSummary | null>(null)
const entries = ref<CommissionEntry[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const settlements = ref<CommissionSettlement[]>([])
const settlementsTotal = ref(0)
const settlementPage = ref(1)
const settlementPageSize = 20
const settledFilter = ref<'all' | 'pending' | 'settled'>('all')
const loading = ref(false)
const entriesLoading = ref(false)
const settlementsLoading = ref(false)
const error = ref('')
const entriesError = ref('')
const settlementsError = ref('')
let revision = 0
let entriesRevision = 0
const summaryItems: { key: keyof CommissionSummary; label: string; note: string }[] = [
  { key: 'pending_amount', label: '待结算', note: '尚未登记线下结算' },
  { key: 'settled_amount', label: '已结算', note: '负责人已登记的金额' },
  { key: 'accrued_amount', label: '累计计提', note: '确认收款产生的返佣' },
  { key: 'refunded_amount', label: '退款冲正', note: '退款对应的反向记录' },
]
const formatDate = (value: string | null | undefined): string => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
}
function agencyId(): number {
  const raw = authService.getUser() as { agency_id?: number } | null
  if (!raw?.agency_id || !Number.isInteger(raw.agency_id) || raw.agency_id <= 0) throw new Error('当前代理归属未加载，请重新登录')
  return raw.agency_id
}
async function load(): Promise<void> {
  const current = ++revision; loading.value = true; error.value = ''
  try { const next = await agencyApi.commissionSummary(agencyId()); if (current === revision) summary.value = next }
  catch (cause) { if (current === revision) { summary.value = null; error.value = cause instanceof Error ? cause.message : '返佣汇总暂时无法加载，请重试' } }
  finally { if (current === revision) loading.value = false }
}
async function loadEntries(): Promise<void> {
  const current = ++entriesRevision; entriesLoading.value = true; entriesError.value = ''
  try {
    const settled = settledFilter.value === 'all' ? undefined : settledFilter.value === 'settled'
    const result = await agencyApi.commissionEntries(agencyId(), { page: page.value, page_size: pageSize.value, settled })
    if (current === entriesRevision) { entries.value = result.data; total.value = result.total }
  } catch (cause) { if (current === entriesRevision) { entries.value = []; total.value = 0; entriesError.value = cause instanceof Error ? cause.message : '返佣明细暂时无法加载，请重试' } }
  finally { if (current === entriesRevision) entriesLoading.value = false }
}
let settlementsRevision = 0
async function loadSettlements(): Promise<void> {
  const current = ++settlementsRevision; settlementsLoading.value = true; settlementsError.value = ''
  try {
    const result = await agencyApi.commissionSettlements(agencyId(), { page: settlementPage.value, page_size: settlementPageSize })
    if (current === settlementsRevision) { settlements.value = result.data; settlementsTotal.value = result.total }
  } catch (cause) {
    if (current === settlementsRevision) { settlements.value = []; settlementsTotal.value = 0; settlementsError.value = cause instanceof Error ? cause.message : '结算记录暂时无法加载，请重试' }
  } finally { if (current === settlementsRevision) settlementsLoading.value = false }
}
function onFilterChange(): void { page.value = 1; void loadEntries() }
function refreshAll(): void { void Promise.all([load(), loadEntries(), loadSettlements()]) }
onMounted(refreshAll)
onUnmounted(() => { revision++; entriesRevision++; settlementsRevision++ })
</script>

<style scoped>
.commission-page{width:100%;min-width:0}.page-heading,.section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.page-heading{margin-bottom:28px}.eyebrow{font-size:10px;letter-spacing:.14em;color:var(--color-primary);font-weight:700}.page-heading h1{margin:12px 0 8px;font-size:clamp(24px,2.7vw,32px);letter-spacing:-.04em}.page-heading p,.section-heading p{margin:0;color:var(--color-text-secondary);font-size:13px;line-height:1.8}.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:24px}.summary-card{display:grid;gap:8px;padding:20px;border:1px solid var(--color-border);border-radius:14px;background:var(--color-surface)}.summary-card span{font-size:13px;color:var(--color-text-secondary)}.summary-card strong{font-size:25px;font-variant-numeric:tabular-nums}.summary-card small{font-size:11px;color:var(--color-text-tertiary)}.ledger-card,.settlement-card{padding:24px;border:1px solid var(--color-border);border-radius:16px;background:var(--color-surface)}.settlement-card{margin-top:20px}.section-heading{align-items:center;margin-bottom:20px}.section-heading h2{margin:0 0 7px;font-size:18px}.ledger-table{width:100%}.negative{color:var(--color-danger,#d14343)}.empty-state{padding:26px;color:var(--color-text-tertiary);font-size:13px}.pager-row{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:18px;color:var(--color-text-tertiary);font-size:12px}.boundary{margin:16px 0 0;color:var(--color-text-tertiary);font-size:12px;line-height:1.8}.state-alert{margin-bottom:18px}@media(max-width:900px){.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.section-heading{align-items:flex-start;flex-direction:column}}@media(max-width:600px){.page-heading{align-items:flex-start;flex-direction:column}.summary-grid{grid-template-columns:1fr 1fr;gap:9px}.summary-card{padding:14px}.summary-card strong{font-size:20px}.ledger-card,.settlement-card{padding:16px;overflow:hidden}.pager-row{align-items:flex-start;flex-direction:column}.pager-row :deep(.el-pagination){padding:0}.section-heading :deep(.el-radio-group){width:100%;display:flex}.section-heading :deep(.el-radio-button){flex:1}.section-heading :deep(.el-radio-button__inner){width:100%;padding-inline:8px}}
</style>
