<template>
  <section class="commission-panel" aria-label="代理返佣与月结">
    <div class="panel-heading"><p>选择代理，核对订单返佣，再登记已完成的线下结算。</p><el-button :loading="loading || loadingAgencies || entriesLoading" :disabled="savingRate || confirming" @click="refresh">刷新</el-button></div>
    <div v-if="listError || loadError" class="error-state" role="alert"><el-alert :title="listError || loadError" type="error" show-icon :closable="false" /><el-button :disabled="loading || loadingAgencies" @click="refresh">重新加载</el-button></div>
    <p v-if="loadingAgencies" role="status">正在加载代理列表…</p>
    <el-empty v-else-if="listReady && !agencies.length" description="暂无代理主体，请先在代理主体分区创建代理" />
    <template v-if="agencies.length">
      <div class="agency-selector">
        <label for="commission-agency">核对哪位代理<el-select id="commission-agency" v-model="agencyId" filterable placeholder="选择代理" :disabled="savingRate || confirming"><el-option v-for="agency in agencies" :key="agency.id" :label="agency.name" :value="agency.id" /></el-select></label>
        <p><strong>{{ selectedAgencyName }}</strong><span>以下账目仅属于这位代理 · {{ currentRateLabel }}</span></p>
      </div>
      <div class="summary-grid" :aria-busy="loading" aria-label="所选代理累计返佣"><div><span>待结算</span><strong>{{ amountLabel(summary?.pending_amount) }}</strong></div><div><span>已结算</span><strong>{{ amountLabel(summary?.settled_amount) }}</strong></div><div><span>累计计提</span><strong>{{ amountLabel(summary?.accrued_amount) }}</strong></div><div><span>退款冲正</span><strong>{{ amountLabel(summary?.refunded_amount) }}</strong></div></div>

      <section class="ledger-card" aria-labelledby="commission-ledger-title">
        <div class="ledger-heading"><div><h3 id="commission-ledger-title">订单返佣明细</h3><p>查看全部月份的记录；上方累计金额不随列表筛选改变。</p></div>
          <el-select v-model="settledFilter" aria-label="返佣结算状态" class="ledger-filter" @change="changeEntryFilter"><el-option label="待结算" value="pending" /><el-option label="已结算" value="settled" /><el-option label="全部状态" value="all" /></el-select>
        </div>
        <div v-if="entriesError" class="error-state" role="alert"><el-alert :title="entriesError" type="error" :closable="false" /><el-button :loading="entriesLoading" @click="loadEntries">重试明细</el-button></div>
        <p v-if="entriesLoading" role="status" class="empty-hint">正在读取返佣明细…</p>
        <el-table v-else-if="entriesReady && !entriesError" :data="entries" row-key="id" class="ledger-table">
          <el-table-column label="订单 / 时间" min-width="200"><template #default="{ row }"><div class="ledger-cell"><strong :title="row.order_no">{{ row.order_no }}</strong><small>{{ formatDate(row.occurred_at) }}</small></div></template></el-table-column>
          <el-table-column label="变动原因" width="110"><template #default="{ row }"><el-tag :type="row.kind === 'refund' ? 'danger' : 'success'" size="small">{{ row.kind === 'refund' ? '退款冲正' : '确认收款' }}</el-tag></template></el-table-column>
          <el-table-column label="订单金额 / 比例" min-width="150" align="right"><template #default="{ row }"><div class="ledger-cell ledger-cell--number"><strong>{{ money(row.order_amount_snapshot) }}</strong><small>按 {{ formatRate(row.rate_snapshot) }} 记录</small></div></template></el-table-column>
          <el-table-column label="返佣变动" width="130" align="right"><template #default="{ row }"><span :class="{ negative: row.amount < 0 }">{{ money(row.amount) }}</span></template></el-table-column>
          <el-table-column label="结算状态" width="120"><template #default="{ row }">{{ row.settlement_id ? '已结算' : '待结算' }}</template></el-table-column>
          <template #empty><p class="empty-hint">当前状态没有返佣记录，可切换状态查看。</p></template>
        </el-table>
        <div v-if="entriesReady && !entriesError" class="pager-row"><span>共 {{ entriesTotal }} 条 · 每页 {{ pageSize }} 条</span><el-pagination :current-page="entryPage" :page-size="pageSize" :total="entriesTotal" :pager-count="5" layout="prev, pager, next" @current-change="changeEntryPage" /></div>
      </section>

      <div class="settlement-card"><div class="section-title"><div><h3>登记线下月结</h3><p>预览包含截至所选月末仍未结算的记录。先在线下完成核对与付款，再由负责人登记；每个代理每月只能确认一次。</p></div></div>
        <div class="settlement-controls"><label for="commission-month">{{ selectedAgencyName }} · 结算月份<input id="commission-month" v-model="month" type="month" :disabled="confirming" /></label><el-button :loading="previewing" :disabled="!canPreview" @click="preview">{{ previewData ? '重新预览' : '预览结算' }}</el-button></div>
        <el-alert v-if="previewError" :title="previewError" type="error" show-icon :closable="false" /><p v-if="!validMonth" class="empty-hint">请选择有效的结算月份。</p><p v-else-if="!previewData && !previewing && !previewError" class="empty-hint">选择月份后预览，核对金额和记录数。</p>
        <p v-if="previewData && !previewData.existing_settlement && (!entriesReady || entriesLoading || entriesError)" class="empty-hint">请先成功读取上方返佣明细，核对后再确认结算。</p>
        <div v-if="previewData" class="preview-row"><template v-if="previewData.existing_settlement"><div><span>{{ month }} 已登记线下结算</span><p>{{ previewData.existing_settlement.count }} 条记录 · {{ money(previewData.existing_settlement.amount) }}</p></div><el-tag type="success">已确认，不可重复登记</el-tag></template><template v-else><div><span>{{ previewData.count }} 条待结算记录</span><p v-if="previewData.count === 0">截至所选月末暂无待结算记录。</p><p v-else-if="previewData.amount <= 0">本次没有可确认的正向佣金，请核对退款冲正记录。</p></div><strong>{{ money(previewData.amount) }}</strong><el-button type="primary" :loading="confirming" :disabled="!canConfirm" @click="confirmSettlement">确认已线下结算</el-button></template></div>
      </div>

      <details class="secondary-section" data-testid="commission-history" @toggle="toggleHistory">
        <summary>历史月结记录 <small>查看确认时间、金额与备注</small></summary>
        <div v-if="historyOpen" class="secondary-content">
          <div v-if="settlementsError" class="error-state" role="alert"><el-alert :title="settlementsError" type="error" :closable="false" /><el-button :loading="settlementsLoading" @click="loadSettlements">重试结算记录</el-button></div>
          <p v-if="settlementsLoading" role="status" class="empty-hint">正在读取月结记录…</p>
          <el-table v-else-if="settlementsReady && !settlementsError" :data="settlements" row-key="id" class="ledger-table">
            <el-table-column prop="month" label="结算月份" width="120" /><el-table-column label="金额 / 笔数" min-width="150"><template #default="{ row }"><div class="ledger-cell"><strong>{{ money(row.amount) }}</strong><small>{{ row.count }} 条返佣记录</small></div></template></el-table-column>
            <el-table-column label="确认时间" min-width="180"><template #default="{ row }">{{ formatDate(row.confirmed_at) }}</template></el-table-column><el-table-column prop="note" label="备注" min-width="200" show-overflow-tooltip />
            <template #empty><p class="empty-hint">尚未登记过线下月结。</p></template>
          </el-table>
          <div v-if="settlementsReady && !settlementsError" class="pager-row"><span>共 {{ settlementsTotal }} 次</span><el-pagination :current-page="settlementPage" :page-size="pageSize" :total="settlementsTotal" :pager-count="5" layout="prev, pager, next" @current-change="changeSettlementPage" /></div>
        </div>
      </details>
      <details class="secondary-section" data-testid="commission-rate-settings">
        <summary>返佣比例设置 <small>{{ currentRateLabel }}</small></summary>
        <div class="secondary-content"><div class="rate-settings">
          <div class="rate-control"><el-checkbox v-model="rateEnabled" :disabled="!policy || loading || savingRate">设置返佣比例</el-checkbox><el-input-number id="commission-rate" v-model="ratePercent" aria-label="返佣比例（百分比）" :min="0" :max="100" :precision="4" :step="0.5" placeholder="输入百分比" :disabled="!policy || !rateEnabled || loading || savingRate" /></div>
          <el-button type="primary" :disabled="!canSaveRate" :loading="savingRate" @click="saveRate">保存比例</el-button>
        </div><p class="empty-hint">改比例只影响之后确认收款的订单，不改变已有账目。取消勾选可恢复未设置；未设置时不产生新返佣。</p><el-alert v-if="rateError" :title="rateError" type="error" show-icon :closable="false" /></div>
      </details>
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { z } from 'zod'
import { showToast } from '@/utils'
import { agencyApi } from './api'
import { money, type Agency } from './model'
import { commissionMonthSchema, type CommissionPolicy, type CommissionSummary, type CommissionPreview, type CommissionEntry, type CommissionSettlement } from './commission-model'
const agencies = ref<Agency[]>([]), agencyId = ref<number>(), loadingAgencies = ref(false), listReady = ref(false), listError = ref('')
const loading = ref(false), loadError = ref(''), savingRate = ref(false), rateError = ref(''), previewing = ref(false), previewError = ref(''), confirming = ref(false)
const policy = ref<CommissionPolicy>(), summary = ref<CommissionSummary>(), previewData = ref<CommissionPreview>(), rateEnabled = ref(false), ratePercent = ref<number>()
const entries = ref<CommissionEntry[]>([]), entryPage = ref(1), entriesTotal = ref(0), entriesLoading = ref(false), entriesReady = ref(false), entriesError = ref('')
const settledFilter = ref<'pending' | 'settled' | 'all'>('pending')
const settlements = ref<CommissionSettlement[]>([]), settlementPage = ref(1), settlementsTotal = ref(0), settlementsLoading = ref(false), settlementsReady = ref(false), settlementsError = ref(''), historyOpen = ref(false)
const pageSize = 20
const selectedAgencyName = computed(() => agencies.value.find(agency => agency.id === agencyId.value)?.name ?? '所选代理')
const now = new Date(), month = ref(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
const validMonth = computed(() => commissionMonthSchema.safeParse(month.value).success), validPercent = computed(() => z.number().finite().min(0).max(100).safeParse(ratePercent.value).success)
const canSaveRate = computed(() => !!policy.value && !loading.value && !savingRate.value && (!rateEnabled.value || validPercent.value)), canPreview = computed(() => !!agencyId.value && validMonth.value && !previewing.value && !confirming.value), canConfirm = computed(() => !!previewData.value && !previewData.value.existing_settlement && previewData.value.count > 0 && previewData.value.amount > 0 && !previewing.value && !confirming.value && entriesReady.value && !entriesLoading.value && !entriesError.value)
const currentRateLabel = computed(() => !policy.value ? '当前比例尚未加载' : policy.value.rate === null ? '当前：未设置比例' : `当前：${Math.round(policy.value.rate * 1_000_000) / 10_000}%`)
let alive = true, scope = 0, loadRequest = 0, previewRequest = 0, entriesRequest = 0, settlementsRequest = 0
const amountLabel = (value: number | undefined): string => value === undefined ? '—' : money(value)
const formatRate = (value: number): string => `${Math.round(value * 1_000_000) / 10_000}%`
const formatDate = (value?: string | null): string => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间待核对' : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
}
const errorMessage = (cause: unknown, fallback: string): string => cause instanceof z.ZodError ? '返回数据格式异常，请刷新重试' : cause instanceof Error ? cause.message : fallback
const ownsScope = (agency: number, owner: number): boolean => alive && agencyId.value === agency && scope === owner
function applyPolicy(value: CommissionPolicy): void { policy.value = value; rateEnabled.value = value.rate !== null; ratePercent.value = value.rate === null ? undefined : Math.round(value.rate * 1_000_000) / 10_000 }
function clearPreview(): void { previewRequest++; previewData.value = undefined; previewError.value = ''; previewing.value = false }
async function load(): Promise<void> {
  const agency = agencyId.value; if (!agency) return; const owner = scope, request = ++loadRequest; const owns = () => ownsScope(agency, owner) && request === loadRequest
  loading.value = true; loadError.value = ''; rateError.value = ''; policy.value = undefined; summary.value = undefined; clearPreview()
  try { const [nextPolicy, nextSummary] = await Promise.all([agencyApi.commissionPolicy(agency), agencyApi.commissionSummary(agency)]); if (!owns()) return; if (nextPolicy.agency_id !== agency) throw new Error('返回的代理比例归属不一致，请重新加载'); applyPolicy(nextPolicy); summary.value = nextSummary } catch (cause) { if (owns()) loadError.value = errorMessage(cause, '返佣数据加载失败，请重新加载') } finally { if (owns()) loading.value = false }
}
async function loadAgencies(): Promise<void> {
  if (loadingAgencies.value) return; loadingAgencies.value = true; listError.value = ''
  try { const rows: Agency[] = []; let page = 1; while (alive) { const result = await agencyApi.agencies({ page, page_size: 100 }); if (!alive) return; rows.push(...result.data); if (rows.length >= result.total) break; if (!result.data.length) throw new Error('代理列表不完整，请重新加载'); page++ }; if (!alive) return; agencies.value = rows; listReady.value = true; agencyId.value = rows[0]?.id } catch (cause) { if (alive) listError.value = errorMessage(cause, '代理列表加载失败，请重新加载') } finally { if (alive) loadingAgencies.value = false }
}
async function loadEntries(): Promise<void> {
  const agency = agencyId.value
  if (!agency) return
  const owner = scope, request = ++entriesRequest, owns = () => ownsScope(agency, owner) && request === entriesRequest
  entriesLoading.value = true; entriesReady.value = false; entriesError.value = ''; entries.value = []
  try {
    const settled = settledFilter.value === 'all' ? undefined : settledFilter.value === 'settled'
    const result = await agencyApi.commissionEntries(agency, { page: entryPage.value, page_size: pageSize, settled })
    if (!owns()) return
    if (result.data.some(row => row.agency_id !== agency)) throw new Error('返回的返佣明细归属不一致，请重新加载')
    entries.value = result.data; entriesTotal.value = result.total; entriesReady.value = true
  } catch (cause) { if (owns()) { entriesTotal.value = 0; entriesError.value = errorMessage(cause, '返佣明细读取失败，请重试后再核对结算') } }
  finally { if (owns()) entriesLoading.value = false }
}
async function loadSettlements(): Promise<void> {
  const agency = agencyId.value
  if (!agency) return
  const owner = scope, request = ++settlementsRequest, owns = () => ownsScope(agency, owner) && request === settlementsRequest
  settlementsLoading.value = true; settlementsReady.value = false; settlementsError.value = ''; settlements.value = []
  try {
    const result = await agencyApi.commissionSettlements(agency, { page: settlementPage.value, page_size: pageSize })
    if (!owns()) return
    if (result.data.some(row => row.agency_id !== agency)) throw new Error('返回的月结记录归属不一致，请重新加载')
    settlements.value = result.data; settlementsTotal.value = result.total; settlementsReady.value = true
  } catch (cause) { if (owns()) { settlementsTotal.value = 0; settlementsError.value = errorMessage(cause, '月结记录读取失败，请重新加载') } }
  finally { if (owns()) settlementsLoading.value = false }
}
function changeEntryFilter(): void { entryPage.value = 1; void loadEntries() }
function changeEntryPage(page: number): void { entryPage.value = page; void loadEntries() }
function changeSettlementPage(page: number): void { settlementPage.value = page; void loadSettlements() }
function toggleHistory(event: Event): void {
  historyOpen.value = (event.target as HTMLDetailsElement).open
  if (historyOpen.value && !settlementsReady.value && !settlementsLoading.value) void loadSettlements()
}
async function refresh(): Promise<void> {
  if (savingRate.value || confirming.value) return
  if (!listReady.value || listError.value || !agencies.value.length) await loadAgencies()
  else await Promise.all([load(), loadEntries(), ...(historyOpen.value ? [loadSettlements()] : [])])
}
async function saveRate(): Promise<void> {
  const agency = agencyId.value, loadedPolicy = policy.value; if (!agency || !loadedPolicy || !canSaveRate.value) return; const owner = scope, expectedRate = loadedPolicy.rate, nextRate = rateEnabled.value ? Math.round(z.number().parse(ratePercent.value) * 10_000) / 1_000_000 : null
  savingRate.value = true; rateError.value = ''
  try { const saved = await agencyApi.updateCommissionPolicy(agency, nextRate, expectedRate); if (!ownsScope(agency, owner)) return; if (saved.agency_id !== agency) throw new Error('返回的代理比例归属不一致，请刷新核对'); applyPolicy(saved); showToast('返佣比例已保存；只影响之后确认收款的订单', 'success') } catch (cause) { if (ownsScope(agency, owner)) rateError.value = errorMessage(cause, '返佣比例保存失败，请刷新核对后重试') } finally { if (alive) savingRate.value = false }
}
async function preview(): Promise<void> {
  const agency = agencyId.value; if (!agency || !canPreview.value) return; const owner = scope, selectedMonth = month.value, request = ++previewRequest, owns = () => ownsScope(agency, owner) && month.value === selectedMonth && request === previewRequest
  previewing.value = true; previewData.value = undefined; previewError.value = ''
  try { const result = await agencyApi.commissionPreview(agency, selectedMonth); if (!owns()) return; if (result.agency_id !== agency || result.month !== selectedMonth) throw new Error('返回的月结归属不一致，请重新预览'); previewData.value = result } catch (cause) { if (owns()) previewError.value = errorMessage(cause, '月结预览失败，请重新预览') } finally { if (owns()) previewing.value = false }
}
async function confirmSettlement(): Promise<void> {
  const agency = agencyId.value, reviewed = previewData.value; if (!agency || !reviewed || !canConfirm.value) return; const owner = scope, owns = () => ownsScope(agency, owner) && previewData.value === reviewed && month.value === reviewed.month; confirming.value = true
  try {
    try { await ElMessageBox.confirm(`请确认已向「${agencies.value.find(item => item.id === agency)?.name ?? agency}」完成 ${reviewed.month} 的线下结算：${reviewed.count} 条记录，${money(reviewed.amount)}。这里只登记，不会自动转账，确认后该月份不能重复登记。`, '确认已完成线下结算', { type: 'warning', confirmButtonText: '已完成线下结算，登记', cancelButtonText: '返回核对', closeOnClickModal: false, closeOnPressEscape: false }) } catch { return }
    if (!owns()) return
    try {
      const saved = await agencyApi.confirmCommissionSettlement(agency, { month: reviewed.month, expected_revision: reviewed.revision, note: `负责人确认 ${reviewed.month} 线下结算` })
      if (!owns()) return
      if (saved.agency_id !== agency || saved.month !== reviewed.month) throw new Error('返回的结算归属不一致，请重新预览核对')
      previewData.value = { ...reviewed, existing_settlement: saved }; showToast('已登记线下结算，不会自动转账', 'success')
      entryPage.value = 1; settlementPage.value = 1; settlementsReady.value = false
      await Promise.all([loadEntries(), ...(historyOpen.value ? [loadSettlements()] : [])])
      try { const updated = await agencyApi.commissionSummary(agency); if (ownsScope(agency, owner)) summary.value = updated }
      catch { if (ownsScope(agency, owner)) { summary.value = undefined; loadError.value = '结算已登记，汇总刷新失败，请刷新核对' } }
    } catch (cause) { if (owns()) { clearPreview(); previewError.value = `${errorMessage(cause, '月结确认失败')}；请重新预览核对后再操作。` } }
  } finally { if (alive) confirming.value = false }
}
watch(agencyId, () => {
  scope++; entriesRequest++; settlementsRequest++
  policy.value = undefined; summary.value = undefined; rateEnabled.value = false; ratePercent.value = undefined
  entryPage.value = 1; entries.value = []; entriesTotal.value = 0; entriesError.value = ''; entriesReady.value = false
  settlementPage.value = 1; settlements.value = []; settlementsTotal.value = 0; settlementsError.value = ''; settlementsReady.value = false; settlementsLoading.value = false
  clearPreview(); void load(); void loadEntries(); if (historyOpen.value) void loadSettlements()
}, { flush: 'sync' })
watch(month, clearPreview, { flush: 'sync' })
onMounted(() => { void loadAgencies() }); onBeforeUnmount(() => { alive = false; scope++; loadRequest++; previewRequest++; entriesRequest++; settlementsRequest++ })
</script>
<style scoped>
.commission-panel { padding-bottom: 24px; min-width: 0; }
.panel-heading, .ledger-heading { display: flex; justify-content: space-between; align-items: center; gap: 20px; }
.panel-heading { margin-bottom: 18px; }
.panel-heading p, .ledger-heading p, .section-title p, .empty-hint { margin: 6px 0 0; color: var(--color-text-secondary); font-size: 13px; line-height: 1.7; }
.panel-heading p { margin: 0; }
h3 { margin: 0; color: var(--color-text); font-size: 15px; font-weight: 600; }
.agency-selector { display: flex; align-items: end; gap: 24px; margin-bottom: 20px; }
.agency-selector label { width: 280px; max-width: 100%; }
.agency-selector > p { display: grid; gap: 4px; min-width: 0; margin: 0 0 4px; font-size: 13px; }
.agency-selector strong { color: var(--color-text); font-size: 14px; overflow-wrap: anywhere; }
.agency-selector span { color: var(--color-text-secondary); }
label, .rate-control { display: flex; flex-direction: column; gap: 8px; color: var(--color-text); font-size: 13px; }
.agency-selector :deep(.el-select), .rate-control :deep(.el-input-number) { width: 100%; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 20px; }
.summary-grid > div { display: grid; gap: 10px; padding: 18px 20px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
.summary-grid span { color: var(--color-text-secondary); font-size: 13px; }
.summary-grid strong { color: var(--color-text); font-size: 24px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ledger-card, .settlement-card { padding: 20px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); margin-bottom: 20px; }
.ledger-heading { margin-bottom: 18px; }
.ledger-filter { width: 140px; flex-shrink: 0; }
.ledger-table { width: 100%; }
.ledger-table :deep(.el-table__cell) { padding-block: 12px; }
.ledger-cell { display: grid; gap: 5px; min-width: 0; }
.ledger-cell strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 500; }
.ledger-cell small { color: var(--color-text-secondary); font-size: 12px; }
.ledger-cell--number { text-align: right; font-variant-numeric: tabular-nums; }
.negative { color: var(--color-danger); }
.pager-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
.pager-row > span { color: var(--color-text-secondary); font-size: 13px; }
.settlement-controls { display: flex; align-items: end; gap: 16px; margin: 18px 0; }
.settlement-controls input { box-sizing: border-box; min-height: 38px; padding: 7px 12px; border: 1px solid var(--color-border); border-radius: 6px; color: var(--color-text); background: var(--color-surface); font: inherit; }
.preview-row { display: flex; flex-wrap: wrap; align-items: center; gap: 20px; margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--color-border); }
.preview-row p { margin: 7px 0 0; color: var(--color-text-secondary); font-size: 13px; }
.preview-row strong { margin-right: auto; font-size: 22px; }
.secondary-section { margin-top: 14px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); }
.secondary-section > summary { padding: 17px 20px; color: var(--color-text); font-size: 14px; font-weight: 600; cursor: pointer; }
.secondary-section > summary > small { margin-left: 12px; color: var(--color-text-secondary); font-size: 13px; font-weight: 400; }
.secondary-section > summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; border-radius: inherit; }
.secondary-content { padding: 0 20px 20px; }
.rate-settings { display: flex; align-items: end; gap: 16px; }
.rate-control { width: 260px; max-width: 100%; }
.error-state { display: flex; gap: 12px; align-items: center; margin: 16px 0; }
.error-state :deep(.el-alert) { flex: 1; }
@media (max-width: 900px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 760px) {
  .agency-selector, .panel-heading { align-items: stretch; flex-direction: column; gap: 14px; }
  .agency-selector label { width: 100%; }
  .ledger-heading { align-items: flex-start; flex-wrap: wrap; }
  .error-state { align-items: stretch; flex-direction: column; }
  .secondary-section > summary > small { display: block; margin: 6px 0 0; }
}
</style>
