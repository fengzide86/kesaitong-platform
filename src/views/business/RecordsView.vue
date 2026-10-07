<template>
  <div class="records-page">
    <PageHeader eyebrow="BUSINESS RECORDS" title="批量执行记录" description="默认查看真实批次；历史演示单独保留，不计入真实任务结果。">
      <template #actions><button type="button" @click="helpOpen = true">记录核对 / 使用帮助</button><button @click="load(false)"><RefreshCw :size="15" />刷新</button></template>
    </PageHeader>
    <div class="record-tabs" role="tablist" aria-label="批次记录类型">
      <button type="button" role="tab" :aria-selected="activeTab === 'live'" :class="{ active: activeTab === 'live' }" @click="activeTab='live'">真实批次</button>
      <button type="button" role="tab" :aria-selected="activeTab === 'demo'" :class="{ active: activeTab === 'demo' }" @click="activeTab='demo'">历史演示</button>
    </div>
    <p v-if="activeTab === 'demo'" class="demo-note">模拟结果仅用于展示批量流程，不代表真实账号处理成功。</p>
    <AsyncStateNotice v-if="loadState === 'stale'" :state="loadState" :message="loadError" @retry="load(failedAppend)" />
    <section class="records-surface">
      <div v-if="loadState === 'loading'" class="empty"><RefreshCw :size="24" class="spin"/><strong>正在加载记录</strong></div>
      <div v-else-if="loadState === 'error'" class="empty error-state" role="alert"><CircleAlert :size="24"/><strong>记录暂时无法加载</strong><p>{{ loadError }}</p><button type="button" @click="load(false)">重新加载</button></div>
      <div v-else-if="rows.length" class="records-list">
        <article v-for="batch in rows" :key="batch.id">
          <div class="tool"><strong>{{ batch.toolName }}</strong><span>{{ formatDate(batch.startedAt) }}</span></div>
          <div><small>{{ activeTab === 'demo' ? '演示项' : '账号数' }}</small><strong>{{ batch.total }}</strong></div>
          <div><small>已结束</small><strong>{{ batch.processed }}</strong></div>
          <div><small>{{ activeTab === 'demo' ? '演示异常' : '需要操作' }}</small><strong>{{ batch.attention }}</strong></div>
          <span :class="['status', `is-${batch.status}`]">{{ statusText(batch.status) }}</span>
          <button v-if="batch.detailAccessible !== false" class="detail-link" type="button" :aria-label="`查看${batch.toolName}批次详情`" @click="openDetails(batch)">查看详情</button>
          <small v-else class="detail-link">其他设备执行，仅摘要；详情请在原电脑查看</small>
        </article>
      </div>
      <div v-else class="empty">
        <span><Archive :size="24" /></span>
        <strong>{{ activeTab === 'demo' ? '还没有批量演示记录' : '还没有真实批次记录' }}</strong>
        <p>{{ activeTab === 'demo' ? '这里仅保留旧演示记录，不提供新的演示入口。' : '当前没有真实批次记录。可到工作台查看工具开放状态与准备项。' }}</p>
        <router-link v-if="activeTab === 'live'" to="/business/workspace">查看工具与准备项</router-link>
      </div>
    </section>
    <footer v-if="rows.length" class="pagination">
      <span>已显示 {{ rows.length }} 条<template v-if="activeTab === 'demo'"> / 共 {{ store.demoHistoryTotal }} 条</template></span>
      <button v-if="hasMore" type="button" :disabled="loadingMore" @click="load(true)">{{ loadingMore ? '正在加载…' : '加载更多' }}</button>
      <span v-else>已显示全部记录</span>
    </footer>
    <el-drawer v-model="drawerOpen" title="批次详情" size="min(620px, 94vw)" @closed="closeDetails">
      <p v-if="detailLoading" role="status">正在加载批次结果…</p>
      <div v-else-if="detailError" role="alert"><p>{{ detailError }}</p><button type="button" @click="retryDetails">重新加载详情</button></div>
      <template v-else-if="detail">
        <h2 class="detail-title">{{ detail.toolName }}</h2>
        <p>{{ detail.kind === 'demo' ? '模拟演示' : '真实执行' }} · {{ statusText(detail.status) }} · {{ detail.total }} 个账号</p>
        <p class="detail-disclosure">{{ detail.kind === 'demo' ? '完成、人工操作、异常均为演示案例，不代表真实平台结果，也无需继续处理历史案例。' : '这里只展示持久化的批次结果。不会从历史记录重新启动浏览器或自动恢复真实任务。' }}</p>
        <p v-if="detail.kind === 'live'" class="detail-disclosure">“未完成”不是“确定未写入”。结果不明时，应先在原电脑核对平台上的同一对象，再决定是否重新处理；本页不会判断业务是否可重试。导出结果用于核对，不是自动重试清单。</p>
        <div class="detail-table-wrap"><table class="detail-table"><thead><tr><th>账号序号</th><th>原表行号</th><th>状态</th><th>结果</th></tr></thead><tbody><tr v-for="item in detail.items" :key="item.label"><td>{{ item.label }}</td><td>{{ item.sourceRow || '本机未保留' }}</td><td>{{ item.status }}</td><td>{{ item.result }}</td></tr></tbody></table></div>
        <p v-if="!detail.items.length">该批次尚无账号结果记录。</p>
        <p class="detail-disclosure">原表行号仅在导入过的本机保留，用于对照源文件。仅导出行号和脱敏结果，不包含账号、原始单元格、内部任务标识或服务端原文。</p>
      </template>
      <template #footer><div v-if="detail" class="detail-actions"><button type="button" @click="exportResults"><Download :size="15" />导出脱敏结果</button><button type="button" @click="helpOpen = true">结果核对求助</button><button type="button" @click="drawerOpen = false">关闭</button></div></template>
    </el-drawer>
    <BusinessHelpDrawer v-model="helpOpen" entry-point="批次记录核对" :context="detail ? { toolName: detail.toolName, recordKind: detail.kind, status: detail.status, total: detail.total } : undefined" />
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElDrawer } from 'element-plus'
import { Archive, CircleAlert, Download, RefreshCw } from '@lucide/vue'
import { getBusinessBatch, getDemoBatch } from '@/utils/api'
import { authService } from '@/utils/auth'
import { unwrapApiData } from '@/features/demo/model'
import { historyCsv, parseHistoryDetail, type HistoryDetail } from '@/features/business/history'
import { useBusinessWorkspaceStore } from '@/stores/businessWorkspace'
import BusinessHelpDrawer from '@/features/business/BusinessHelpDrawer.vue'
import AsyncStateNotice from '@/components/AsyncStateNotice.vue'
import PageHeader from '@/components/PageHeader.vue'
import { failedDataState, settledDataState, type AsyncDataState } from '@/features/async/state'
const store = useBusinessWorkspaceStore()
const helpOpen = ref(false)
type RecordTab = 'demo' | 'live'
interface BatchRow { id: string | number; toolName: string; startedAt?: string | null; total: number; processed: number; attention: number; status: string; detailAccessible?: boolean }
const activeTab = ref<RecordTab>('live')
const loadError = ref('')
const loadState = ref<AsyncDataState>('loading')
let loadSequence = 0
const loadingMore = ref(false)
const failedAppend = ref(false)
const hasMore = computed(() => activeTab.value === 'demo' ? rows.value.length < store.demoHistoryTotal : store.liveHistoryHasMore)
const drawerOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const detail = ref<HistoryDetail | null>(null)
let selectedBatch: BatchRow | null = null
let detailSequence = 0
const rows = computed<BatchRow[]>(() => activeTab.value === 'demo'
  ? store.demoHistory.map(batch => ({ id: batch.id, toolName: batch.tool_name_snapshot, startedAt: batch.started_at || batch.created_at, total: batch.row_count, processed: batch.played_count + batch.skipped_count + batch.error_count, attention: batch.error_count, status: batch.status }))
  : store.history.map(batch => ({ id: batch.id, toolName: batch.tool_name, startedAt: batch.started_at, total: batch.total_count, processed: batch.completed_count + batch.failed_count, attention: batch.waiting_count, status: batch.status, detailAccessible: batch.detail_accessible })))
const load = async (append = false) => {
  if (append && loadingMore.value) return
  const requestSequence = ++loadSequence
  loadingMore.value = append
  failedAppend.value = append
  loadState.value = rows.value.length ? 'data' : 'loading'
  loadError.value = ''
  try {
    if (activeTab.value === 'demo') await store.loadDemoHistory(append)
    else await store.loadHistory(append)
    if (requestSequence !== loadSequence) return
    loadState.value = settledDataState(rows.value.length)
  } catch (error) {
    if (requestSequence !== loadSequence) return
    loadError.value = error instanceof Error && error.message ? error.message : '请检查网络连接后重试。'
    loadState.value = failedDataState(rows.value.length > 0)
  } finally {
    if (requestSequence === loadSequence) loadingMore.value = false
  }
}
onMounted(() => load())
watch(activeTab, () => { closeDetails(); void load() })
onUnmounted(() => { loadSequence += 1; detailSequence += 1 })

async function openDetails(batch: BatchRow): Promise<void> {
  if (batch.detailAccessible === false) return
  const sequence = ++detailSequence
  const kind = activeTab.value
  const token = authService.getAuth()?.token
  selectedBatch = batch
  drawerOpen.value = true
  detailLoading.value = true
  detailError.value = ''
  detail.value = null
  try {
    const result = await (kind === 'demo' ? getDemoBatch(batch.id) : getBusinessBatch(batch.id))
    if (sequence !== detailSequence || token !== authService.getAuth()?.token) return
    detail.value = parseHistoryDetail(kind, unwrapApiData(result), store.getSourceRows?.(kind, batch.id) || {})
  } catch (error) {
    if (sequence === detailSequence) detailError.value = error instanceof Error ? error.message : '详情暂时无法加载，请重试。'
  } finally {
    if (sequence === detailSequence) detailLoading.value = false
  }
}
function closeDetails(): void { detailSequence += 1; drawerOpen.value = false; detail.value = null; selectedBatch = null }
function retryDetails(): void { if (selectedBatch) void openDetails(selectedBatch) }
function exportResults(): void {
  if (!detail.value) return
  const url = URL.createObjectURL(new Blob([historyCsv(detail.value)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `KST-${detail.value.kind}-批次结果.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const formatDate = (value: string | null | undefined): string => value ? new Date(value).toLocaleString('zh-CN') : '-'
const statusLabels: Record<string, string> = {
  created: '待演示', running: '进行中', completed: '演示完成', cancelled: '已退出', error: '演示异常', interrupted: '已中断',
}
const liveStatusLabels: Record<string, string> = { created: '等待开始', pending: '等待开始', running: '执行中', completed: '已完成', cancelled: '已结束', error: '执行异常', failed: '未完成', interrupted: '已中断', waiting_user: '需要操作' }
const statusText = (value: string): string => (activeTab.value === 'live' ? liveStatusLabels[value] : statusLabels[value]) || value
</script>
<style scoped>
.records-list article{position:relative;padding-block:14px!important;padding-bottom:48px!important}.detail-link{position:absolute;right:20px;bottom:8px;height:30px}.pagination,.detail-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.pagination{color:var(--color-text-secondary);font-size:var(--type-meta)}.detail-title{color:var(--color-text);font-size:22px;line-height:1.4;overflow-wrap:anywhere}.detail-disclosure{padding:12px;border-radius:10px;background:var(--color-surface-soft);font-size:var(--type-meta);line-height:1.7}.detail-table-wrap{overflow:auto;margin-top:16px}.detail-table{width:100%;border-collapse:collapse;font-size:var(--type-control);text-align:left}.detail-table th,.detail-table td{padding:12px;border-bottom:1px solid var(--color-border);vertical-align:top}.detail-table th{white-space:nowrap;color:var(--color-text-secondary)}.detail-actions button:disabled{opacity:.5;cursor:not-allowed}
.records-page{display:grid;gap:20px}.records-page>header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.records-page header span{font-size:var(--type-micro);font-weight:800;letter-spacing:.12em;color:var(--color-primary)}h1{margin:7px 0 0;font-size:var(--type-page);letter-spacing:-.04em;color:var(--color-text)}p{margin:8px 0 0;color:var(--color-text-secondary);font-size:var(--type-control);line-height:1.6}button{height:40px;display:flex;align-items:center;gap:7px;padding:0 14px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface);color:var(--color-text-secondary);font-size:var(--type-control);cursor:pointer}.records-surface{border:1px solid var(--color-border);border-radius:16px;background:var(--color-surface);overflow:hidden}.records-list article{min-height:74px;display:grid;grid-template-columns:minmax(180px,1fr) repeat(3,100px) 90px;align-items:center;gap:14px;padding:0 20px;border-bottom:1px solid var(--color-border)}.records-list article:last-child{border:0}.tool{display:grid;gap:4px}.tool strong{font-size:var(--type-control);color:var(--color-text)}.tool span,small{font-size:var(--type-meta);color:var(--color-text-tertiary)}article>div:not(.tool){display:grid;gap:4px}article>div:not(.tool)>strong{font-variant-numeric:tabular-nums;color:var(--color-text)}.status{justify-self:end;padding:5px 9px;border-radius:99px;font-size:var(--type-micro);font-weight:700;color:var(--color-text-secondary);background:var(--color-surface-soft)}.status.is-running{color:var(--color-primary);background:var(--color-primary-soft)}.status.is-completed{color:var(--color-success);background:#eaf8f2}.empty{min-height:330px;display:grid;place-content:center;justify-items:center;gap:9px;padding:42px;text-align:center}.empty>span{width:50px;height:50px;display:grid;place-items:center;border-radius:16px;color:var(--color-primary);background:var(--color-primary-soft)}.empty strong{color:var(--color-text);font-size:var(--type-card)}.empty p{max-width:430px;margin:0;color:var(--color-text-secondary)}.empty a{margin-top:8px;color:var(--color-primary);font-size:var(--type-control);font-weight:700;text-decoration:none}@media(max-width:760px){.records-page>header{display:grid}.records-page>header button{width:max-content}.records-list article{grid-template-columns:1fr auto}.records-list article>div:not(.tool){display:none}.empty{padding:30px 18px}}
.record-tabs{display:flex;gap:6px;width:max-content;padding:4px;border:1px solid var(--color-border);border-radius:11px;background:var(--color-surface-soft)}
.record-tabs button{height:34px;border:0;background:transparent}.record-tabs button.active{color:var(--color-primary);background:var(--color-surface);box-shadow:var(--shadow-low)}
.demo-note{margin:-10px 0 0;padding:9px 11px;border-radius:8px;color:var(--color-primary);background:var(--color-primary-soft);font-size:var(--type-meta)}
.status.is-error{color:var(--color-danger);background:var(--color-danger-soft)}.error-state>svg{color:var(--color-danger)}
.spin{animation:records-spin .8s linear infinite}@keyframes records-spin{to{transform:rotate(360deg)}}
</style>
