<template>
  <section v-if="legacyDemoBlocked" class="legacy-demo-retired" data-testid="legacy-demo-retired" role="alert">
    <strong>旧演示入口已停用</strong><p>历史演示数据仍被保留，但不会作为真实工具记录或执行结果展示。</p>
    <button type="button" @click="emit('new')">返回工具准备</button>
  </section>
  <section v-else class="run-console" data-testid="business-run-console">
    <header class="run-header">
      <div class="batch-identity">
        <span class="professional-badge">{{ store.isDemoBatch ? '交互演示' : '自动执行' }}</span>
        <div>
          <strong>{{ store.snapshot.tool?.name }}</strong>
          <small>{{ totalCount }} 个账号 · {{ store.isDemoBatch ? '并发演示' : '依次执行' }}</small>
        </div>
      </div>
      <div class="batch-progress" aria-label="已结束账号数">
        <div><span>已结束账号</span><strong>{{ processedCount }} / {{ totalCount }}</strong></div>
        <div class="progress-track" aria-hidden="true"><i :style="{ width: `${batchProgress}%` }"></i></div>
      </div>
      <div class="header-actions">
        <span :class="['sync-state', `is-${store.syncState}`]">{{ syncText }}</span>
        <button v-if="store.isActive" class="exit-button" type="button" @click="emit('exit')">
          <LogOut :size="15" />{{ store.isDemoBatch ? '退出演示' : '结束批次' }}
        </button>
        <button v-else class="new-button" type="button" @click="emit('new')"><Plus :size="15" />新建批次</button>
      </div>
      <small v-if="store.liveStorageUnavailable" class="storage-warning" role="alert">本机回执保存暂不可用，请保持窗口打开并等待同步完成。</small>
    </header>

    <div class="metric-strip" aria-label="批次状态汇总">
      <article><span>账号总数</span><strong>{{ totalCount }}</strong><small>本批次</small></article>
      <article class="is-running"><span>运行中</span><strong>{{ runningCount }}</strong><small>{{ store.isDemoBatch ? '并发演示' : '依次处理' }}</small></article>
      <article class="is-success"><span>已完成</span><strong>{{ completedCount }}</strong><small>{{ store.isDemoBatch ? '完成案例' : '执行已完成' }}</small></article>
      <article class="is-attention"><span>需关注</span><strong>{{ waitingCount }}</strong><small>{{ store.isDemoBatch ? '人工操作案例' : '等待你操作' }}</small></article>
      <article class="is-danger"><span>异常</span><strong>{{ failedCount }}</strong><small>{{ store.isDemoBatch ? '异常结果案例' : '核对后再恢复' }}</small></article>
    </div>

    <section class="execution-surface">
      <header class="execution-toolbar">
        <div>
          <strong>账号执行总览</strong>
          <span>{{ store.isDemoBatch ? '账号并发演示，点击查看案例过程' : '账号依次处理；需人工操作时保留现场，点击账号继续' }}</span>
        </div>
        <div class="toolbar-controls">
          <button class="utility-button" type="button" @click="helpOpen = true">帮助与求助</button>
          <button class="utility-button" type="button" @click="exportResults">导出结果</button>
          <label class="search-control">
            <Search :size="15" />
            <input v-model.trim="query" type="search" placeholder="搜索账号" aria-label="搜索账号" />
          </label>
          <div class="status-filters" role="group" aria-label="执行状态筛选">
            <button
              v-for="option in filterOptions"
              :key="option.value"
              type="button"
              :class="{ active: activeFilter === option.value }"
              :aria-pressed="activeFilter === option.value"
              @click="activeFilter = option.value"
            >{{ option.label }}<span>{{ option.count }}</span></button>
          </div>
        </div>
      </header>

      <div class="table-scroll">
        <table v-if="filteredItems.length" class="execution-table">
          <thead>
            <tr><th>账号</th><th>状态</th><th>当前阶段</th><th>{{ store.isDemoBatch ? '演示进度' : '处理情况' }}</th><th>耗时</th><th>结果</th><th aria-label="查看详情"></th></tr>
          </thead>
          <tbody>
            <tr
              v-for="item in filteredItems"
              :key="item.itemId"
              :class="[`is-${item.status}`, { selected: store.selectedItemId === item.itemId }]"
              tabindex="0"
              @click="openDetails(item.itemId)"
              @keydown.enter.prevent="openDetails(item.itemId)"
              @keydown.space.prevent="openDetails(item.itemId)"
            >
              <td><div class="account-cell"><span class="account-icon"><UserRound :size="16" /></span><div><strong>{{ item.accountLabelMasked || (store.isDemoBatch ? '演示账号' : '未命名账号') }}</strong></div></div></td>
              <td><span :class="['status-pill', `is-${item.status}`]"><component :is="statusIcon(item.status)" :size="14" :class="{ spin: item.status === 'running' }" />{{ displayStatus(item) }}</span></td>
              <td>
                <div class="stage-cell">
                  <strong>{{ stageLabel(item) }}</strong>
                  <div v-if="store.isDemoBatch" class="stage-track" aria-hidden="true"><i v-for="index in 4" :key="index" :class="stagePresentation(item, index - 1)"></i></div>
                </div>
              </td>
              <td>
                <div v-if="store.isDemoBatch && demoProgress(item) !== null" class="row-progress"><span aria-hidden="true"><i :style="{ width: `${demoProgress(item)}%` }"></i></span><strong>{{ demoProgress(item) }}%</strong></div>
                <span v-else class="progress-description">{{ progressDescription(item) }}</span>
              </td>
              <td class="duration-cell">{{ durationFor(item) }}</td>
              <td><span class="result-text">{{ resultText(item) }}</span></td>
              <td><ChevronRight :size="15" /></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="filtered-empty"><SearchX :size="25" /><strong>没有符合条件的账号</strong><span>更换状态筛选或搜索词后再试。</span></div>
      </div>
    </section>

    <Teleport to="body">
      <div :class="['detail-layer', { open: drawerOpen }]" @keydown.esc="closeDetails">
        <button class="detail-overlay" type="button" aria-label="关闭账号详情" @click="closeDetails"></button>
        <aside class="detail-drawer" role="dialog" aria-modal="true" aria-label="账号执行详情">
          <header>
            <div><span>账号执行详情</span><strong>{{ store.selectedItem?.accountLabelMasked || '未选择账号' }}</strong></div>
            <button type="button" aria-label="关闭详情" @click="closeDetails"><X :size="18" /></button>
          </header>
          <template v-if="store.selectedItem">
            <div :class="['detail-status', `is-${store.selectedItem.status}`]">
              <span class="detail-status-icon"><component :is="statusIcon(store.selectedItem.status)" :size="20" :class="{ spin: store.selectedItem.status === 'running' }" /></span>
              <div><strong>{{ displayStatus(store.selectedItem) }}</strong><p>{{ actionDescription }}</p></div>
            </div>
            <div class="detail-stage">
              <div><span>业务阶段</span><strong>{{ stageLabel(store.selectedItem) }}</strong></div>
              <div v-if="store.isDemoBatch" class="stage-track" aria-hidden="true"><i v-for="index in 4" :key="index" :class="stagePresentation(store.selectedItem, index - 1)"></i></div>
              <small>{{ store.isDemoBatch ? '仅展示案例过程，不代表真实执行结果' : '按实际执行状态更新；人工操作后仍需继续执行' }}</small>
            </div>
            <div class="browser-shell">
              <div class="browser-toolbar"><span class="traffic"><i></i><i></i><i></i></span><LockKeyhole :size="13" /><span>{{ displayUrl }}</span></div>
              <div class="browser-viewport">
                <div v-if="store.isDemoBatch" class="demo-browser-preview">
                  <Layers3 :size="34" />
                  <strong>{{ store.selectedItem.accountLabelMasked }}</strong>
                  <span>{{ resultText(store.selectedItem) }}</span>
                  <div v-if="demoProgress(store.selectedItem) !== null" class="preview-progress" aria-hidden="true"><i :style="{ width: `${demoProgress(store.selectedItem)}%` }"></i></div>
                </div>
                <template v-else>
                  <webview
                    v-for="item in store.openItems"
                    :key="item.itemId"
                    src="about:blank"
                    :partition="batchPartition(item.itemId)"
                    :class="['batch-webview', { active: store.selectedItemId === item.itemId }]"
                    @dom-ready="registerBatchBrowser(item.itemId, $event)"
                  />
                </template>
                <div v-if="!store.isDemoBatch && store.selectedItem && !store.selectedItem.browserReady && store.selectedItem.itemId !== store.snapshot.provisioningItemId" class="browser-placeholder">
                  <Layers3 :size="30" /><strong>{{ store.statusText(store.selectedItem.status) }}</strong><span>系统会在轮到该账号时启动独立登录现场。</span>
                </div>
              </div>
            </div>
            <button v-if="!store.isDemoBatch && store.selectedItem.status === 'waiting_user'" class="primary-action warning" type="button" @click="completeAction">我已完成，继续处理</button>
            <button v-else-if="!store.isDemoBatch && store.selectedItem.status === 'failed' && store.isActive" class="primary-action" type="button" :disabled="!retryAllowed(store.selectedItem)" @click="restartItem">{{ retryAllowed(store.selectedItem) ? '重试已核对的账号' : '结果待核对，不能直接重试' }}</button>
            <div v-else-if="!store.isDemoBatch && store.selectedItem.status === 'failed'" class="scope-note"><span>批次已结束，原始输入已清理。请在下方核对结果，再选择原文件恢复可重试行。</span></div>
            <RecoveryPanel v-if="!store.isDemoBatch && ['failed', 'cancelled'].includes(store.selectedItem.status)" :batch-id="store.snapshot.batchId" />
            <div class="scope-note"><ShieldCheck :size="15" /><span>{{ store.isDemoBatch ? '这是本地逻辑演示，不会启动外部平台浏览器。' : '账号登录现场仅保存在本机，服务器只接收脱敏状态。' }}</span></div>
          </template>
        </aside>
      </div>
    </Teleport>
    <BusinessHelpDrawer v-model="helpOpen" />
  </section>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'
import {
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Plus,
  Search,
  SearchX,
  ShieldCheck,
  UserRound,
  X,
} from '@lucide/vue'

import type { BatchItem } from '@/features/business/model'
import { demoProgress, endedAccountCount, executionStage, stagePresentation } from '@/features/business/run-presentation'
import { useBusinessWorkspaceStore } from '@/stores/businessWorkspace'
import { showToast } from '@/utils'
import { historyCsv, snapshotHistoryDetail } from './history'
import RecoveryPanel from '@/features/recovery/RecoveryPanel.vue'
import { recoveryLabels, recoveryRecordSchema } from '@/shared/ipc/recovery-contract'
import { allowLegacyDemoFixture } from './legacy-demo-policy'
const BusinessHelpDrawer = defineAsyncComponent(() => import('./BusinessHelpDrawer.vue'))

type StatusFilter = 'all' | 'running' | 'attention' | 'failed' | 'completed'

const emit = defineEmits<{ exit: []; new: [] }>()
const props = withDefaults(defineProps<{ allowInternalDemo?: boolean }>(), { allowInternalDemo: false })
const store = useBusinessWorkspaceStore()
const legacyDemoBlocked = computed(() => store.isDemoBatch && !(allowLegacyDemoFixture(props.allowInternalDemo) || store.legacyDemoFixturesEnabled))
function retryAllowed(item: BatchItem): boolean { const parsed = recoveryRecordSchema.safeParse(item.recovery); return parsed.success && parsed.data.retryAllowed }
async function refreshRecovery() {
  const snapshot = await window.electronAPI?.batch?.getSnapshot().catch(() => null)
  if (snapshot?.batchId && snapshot.batchId === store.snapshot.batchId) store.snapshot = snapshot
}
const drawerOpen = ref(false)
const helpOpen = ref(false)
const query = ref('')
const activeFilter = ref<StatusFilter>('all')
const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null

const totalCount = computed(() => store.snapshot.counts.total || store.items.length)
const runningCount = computed(() => store.snapshot.counts.running || 0)
const completedCount = computed(() => store.snapshot.counts.completed || 0)
const waitingCount = computed(() => store.snapshot.counts.waiting || 0)
const failedCount = computed(() => store.snapshot.counts.failed || 0)
const processedCount = computed(() => endedAccountCount(store.items, store.isDemoBatch))
const batchProgress = computed(() => totalCount.value ? Math.round((processedCount.value / totalCount.value) * 100) : 0)
const syncText = computed(() => ({ synced: '状态已同步', syncing: '正在同步', offline: '同步待重试' })[store.syncState])
const displayUrl = computed(() => store.isDemoBatch ? '本地并发演示' : (store.snapshot.tool?.target_url || store.snapshot.tool?.targetUrl || '比赛模拟平台'))
const filterOptions = computed(() => [
  { value: 'all' as const, label: '全部', count: store.items.length },
  { value: 'running' as const, label: '运行中', count: store.items.filter(item => item.status === 'running').length },
  { value: 'attention' as const, label: '需关注', count: store.items.filter(item => item.status === 'waiting_user').length },
  { value: 'failed' as const, label: '异常', count: store.items.filter(item => item.status === 'failed').length },
  { value: 'completed' as const, label: '已完成', count: store.items.filter(item => item.status === 'completed').length },
])
const priority: Record<string, number> = { waiting_user: 0, failed: 1, running: 2, pending: 3, completed: 4, cancelled: 5 }
const filteredItems = computed(() => {
  const keyword = query.value.toLocaleLowerCase('zh-CN')
  return [...store.items]
    .filter(item => !keyword || (item.accountLabelMasked || '').toLocaleLowerCase('zh-CN').includes(keyword))
    .filter(item => {
      if (activeFilter.value === 'all') return true
      if (activeFilter.value === 'running') return item.status === 'running'
      if (activeFilter.value === 'attention') return item.status === 'waiting_user'
      return item.status === activeFilter.value
    })
    .sort((left, right) => (priority[left.status] ?? 9) - (priority[right.status] ?? 9))
})
const actionDescription = computed(() => {
  const item = store.selectedItem
  if (!item) return ''
  if (item.status === 'running') return store.isDemoBatch ? '该账号正在与其他账号同时推进演示步骤。' : '正在自动操作该账号的平台页面。'
  if (item.status === 'waiting_user') return item.message || (store.isDemoBatch ? '该账号展示了需要关注的人工操作案例。' : '请在下方页面完成操作，再点击继续处理。当前任务尚未完成。')
  if (item.status === 'completed') return item.message || (store.isDemoBatch ? '该账号已展示完成案例。' : '该账号的执行已完成。')
  if (item.status === 'failed') {
    if (store.isDemoBatch) return item.message || '该账号展示了异常结果案例。'
    const parsed = recoveryRecordSchema.safeParse(item.recovery)
    const record = parsed.success ? parsed.data : null
    const classification = record?.classification || 'needs_review'
    const description = classification === 'verified' || classification === 'manual_completed'
      ? `${recoveryLabels[classification]}，不会再次处理此行。`
      : record?.retryAllowed
        ? `${recoveryLabels[classification]}；${store.isActive ? '可建立独立新尝试。' : '请重新选择原文件，仅恢复允许重试的行。'}`
        : '执行结果待核对，请先查看证据或到平台核对；不能直接重试。'
    return item.message ? `${description} 执行信息：${item.message}` : description
  }
  if (item.status === 'cancelled') return '该账号已随批次退出。'
  return '账号等待进入执行流程。'
})

function statusIcon(status: string) {
  if (status === 'running') return LoaderCircle
  if (status === 'waiting_user' || status === 'failed') return CircleAlert
  if (status === 'completed') return Check
  return Clock3
}
function displayStatus(item: BatchItem): string {
  if (store.isDemoBatch && item.status === 'waiting_user') return '需关注案例'
  if (store.isDemoBatch && item.status === 'failed') return '异常案例'
  return store.statusText(item.status)
}
function stageLabel(item: BatchItem): string {
  return executionStage(item, store.isDemoBatch)
}
function progressDescription(item: BatchItem): string {
  if (item.status === 'running') return store.isDemoBatch ? '演示中' : '处理中'
  if (item.status === 'waiting_user') return store.isDemoBatch ? '案例已展示' : '等待你操作'
  if (item.status === 'pending') return '排队中'
  return displayStatus(item)
}
function resultText(item: BatchItem): string {
  if (store.isDemoBatch && item.simulatedOutcome === 'attention_example') return '人工操作案例'
  if (store.isDemoBatch && item.simulatedOutcome === 'failure_example') return '异常结果案例'
  if (store.isDemoBatch && item.simulatedOutcome === 'completed_example') return '完成案例'
  if (item.status === 'running') return store.isDemoBatch ? '演示进行中' : '等待执行结果'
  if (item.status === 'cancelled') return '已随批次退出'
  if (item.status === 'waiting_user') return item.message || '需要你完成操作'
  if (item.status === 'completed') return item.message || '已完成'
  if (item.status === 'failed') {
    const parsed = recoveryRecordSchema.safeParse(item.recovery)
    return parsed.success ? recoveryLabels[parsed.data.classification] : '结果待核对'
  }
  return item.message || '等待结果'
}
function durationFor(item: BatchItem): string {
  if (!item.startedAtMs) return '--'
  const end = item.finishedAtMs || now.value
  const seconds = Math.max(0, Math.round((end - item.startedAtMs) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
function openDetails(itemId: string): void { store.selectItem(itemId); drawerOpen.value = true }
function closeDetails(): void { drawerOpen.value = false }
function exportResults(): void {
  const url = URL.createObjectURL(new Blob([historyCsv(snapshotHistoryDetail(store.snapshot))], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `KST-${store.isDemoBatch ? '演示' : '真实'}-批次结果.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function handleKeydown(event: KeyboardEvent): void { if (event.key === 'Escape' && drawerOpen.value) closeDetails() }
function batchPartition(itemId: string): string { return `batch-${itemId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)}` }
function registerBatchBrowser(itemId: string, event: Event): void {
  const webview = event.currentTarget as HTMLElement & { getWebContentsId?: () => number }
  const webContentsId = webview.getWebContentsId?.()
  if (typeof webContentsId === 'number') void store.registerBrowser(itemId, webContentsId).catch(error => showToast(error instanceof Error ? error.message : '浏览器启动失败', 'error'))
}
async function completeAction(): Promise<void> {
  if (!store.selectedItemId) return
  try { await store.completeUserAction(store.selectedItemId) }
  catch (error) { showToast(error instanceof Error ? error.message : '无法继续', 'error') }
}
async function restartItem(): Promise<void> {
  if (!store.selectedItemId) return
  try { await store.restartItem(store.selectedItemId) }
  catch (error) { showToast(error instanceof Error ? error.message : '无法重新发起', 'error') }
}

onMounted(() => {
  window.addEventListener('toolbox:recovery-updated', refreshRecovery)
  clockTimer = setInterval(() => { now.value = Date.now() }, 1_000)
  window.addEventListener('keydown', handleKeydown)
})
onUnmounted(() => {
  window.removeEventListener('toolbox:recovery-updated', refreshRecovery)
  if (clockTimer) clearInterval(clockTimer)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.legacy-demo-retired{display:grid;gap:12px;padding:24px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface);color:var(--color-text)}.legacy-demo-retired p{margin:0;color:var(--color-text-secondary);line-height:1.6}.legacy-demo-retired button{justify-self:start;padding:9px 16px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface);color:var(--color-primary);cursor:pointer}
.utility-button{min-height:34px;padding:6px 10px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface);color:var(--color-primary);font-size:var(--type-meta);white-space:nowrap;cursor:pointer}.storage-warning{grid-column:1/-1;color:var(--color-warning)}
.progress-description{color:var(--color-text-secondary);font-size:var(--type-meta);white-space:nowrap}
.run-console{height:100%;min-height:0;display:grid;grid-template-rows:auto auto minmax(0,1fr);gap:10px}
.run-header{min-height:62px;display:grid;grid-template-columns:minmax(230px,1fr) minmax(260px,420px) minmax(230px,1fr);align-items:center;gap:22px;padding:10px 15px;border:1px solid var(--color-border);border-radius:14px;background:var(--color-surface);box-shadow:var(--shadow-low)}
.batch-identity{display:flex;align-items:center;gap:10px;min-width:0}.professional-badge{padding:5px 7px;border-radius:6px;color:#765d38;background:var(--color-premium-soft);font-size:var(--type-micro);font-weight:800;letter-spacing:.1em;white-space:nowrap}.batch-identity>div{min-width:0;display:grid;gap:3px}.batch-identity strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-text);font-size:var(--type-control)}.batch-identity small{color:var(--color-text-tertiary);font-size:var(--type-micro)}
.batch-progress{display:grid;gap:7px}.batch-progress>div:first-child{display:flex;justify-content:space-between;color:var(--color-text-secondary);font-size:var(--type-meta)}.batch-progress strong{color:var(--color-text);font-variant-numeric:tabular-nums}.progress-track,.preview-progress{height:6px;overflow:hidden;border-radius:99px;background:var(--color-border)}.progress-track i,.preview-progress i{display:block;height:100%;border-radius:inherit;background:var(--color-primary);transition:width var(--motion-normal) var(--ease-standard)}
.header-actions{display:flex;justify-content:flex-end;align-items:center;gap:12px}.sync-state{font-size:var(--type-meta);color:var(--color-success)}.sync-state.is-syncing{color:var(--color-primary)}.sync-state.is-offline{color:var(--color-warning)}.header-actions button{height:36px;display:flex;align-items:center;gap:6px;padding:0 12px;border-radius:9px;font-size:var(--type-control);font-weight:700;cursor:pointer}.exit-button{border:1px solid rgba(195,61,73,.22);color:var(--color-danger);background:var(--color-danger-soft)}.new-button{border:1px solid var(--color-border);color:var(--color-primary);background:var(--color-surface)}
.metric-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.metric-strip article{min-height:76px;display:grid;grid-template-columns:1fr auto;align-content:center;gap:4px 12px;padding:13px 15px;border:1px solid var(--color-border);border-radius:13px;background:var(--color-surface);box-shadow:var(--shadow-low)}.metric-strip span{color:var(--color-text-secondary);font-size:var(--type-meta)}.metric-strip strong{grid-row:1/3;grid-column:2;font-size:23px;line-height:1;color:var(--color-text);font-variant-numeric:tabular-nums}.metric-strip small{color:var(--color-text-tertiary);font-size:var(--type-micro)}.metric-strip .is-running strong{color:var(--color-primary)}.metric-strip .is-success strong{color:var(--color-success)}.metric-strip .is-attention strong{color:var(--color-warning)}.metric-strip .is-danger strong{color:var(--color-danger)}
.execution-surface{min-height:0;display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;border:1px solid var(--color-border);border-radius:14px;background:var(--color-surface);box-shadow:var(--shadow-low)}.execution-toolbar{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:12px 14px;border-bottom:1px solid var(--color-border)}.execution-toolbar>div:first-child{display:grid;gap:3px;min-width:170px}.execution-toolbar strong{color:var(--color-text);font-size:var(--type-control)}.execution-toolbar>div:first-child span{color:var(--color-text-tertiary);font-size:var(--type-micro)}.toolbar-controls{display:flex;align-items:center;justify-content:flex-end;gap:9px;min-width:0}.search-control{height:34px;width:180px;display:flex;align-items:center;gap:7px;padding:0 10px;border:1px solid var(--color-border);border-radius:9px;color:var(--color-text-tertiary);background:var(--color-surface-soft)}.search-control:focus-within{border-color:var(--color-primary);box-shadow:0 0 0 3px var(--color-focus-ring)}.search-control input{width:100%;min-width:0;border:0;outline:0;color:var(--color-text);background:transparent;font:inherit;font-size:var(--type-control)}.status-filters{display:flex;gap:4px;padding:3px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface-soft)}.status-filters button{height:30px;display:flex;align-items:center;gap:4px;padding:0 8px;border:0;border-radius:7px;color:var(--color-text-secondary);background:transparent;font-size:var(--type-control);cursor:pointer}.status-filters button span{color:var(--color-text-tertiary);font-variant-numeric:tabular-nums}.status-filters button.active{color:var(--color-primary);background:var(--color-surface);box-shadow:var(--shadow-low)}
.table-scroll{min-height:0;overflow:auto;scrollbar-gutter:stable}.execution-table{width:100%;min-width:920px;border-collapse:separate;border-spacing:0}.execution-table th{position:sticky;top:0;z-index:1;height:38px;padding:0 12px;border-bottom:1px solid var(--color-border);color:var(--color-text-tertiary);background:var(--color-surface-soft);font-size:var(--type-micro);font-weight:700;text-align:left}.execution-table th:first-child{padding-left:16px}.execution-table td{height:62px;padding:0 12px;border-bottom:1px solid var(--color-border);color:var(--color-text-secondary);font-size:var(--type-meta)}.execution-table td:first-child{padding-left:16px}.execution-table tbody tr{cursor:pointer;outline:none;transition:background var(--motion-fast)}.execution-table tbody tr:hover,.execution-table tbody tr:focus-visible{background:var(--color-surface-soft)}.execution-table tbody tr.selected{background:rgba(45,95,202,.045)}.execution-table tbody tr:last-child td{border-bottom:0}.execution-table td:last-child{width:28px;color:var(--color-text-tertiary)}
.account-cell{display:flex;align-items:center;gap:9px;min-width:150px}.account-icon{width:32px;height:32px;display:grid;place-items:center;border-radius:9px;color:var(--color-primary);background:var(--color-primary-soft)}.account-cell>div{min-width:0;display:grid;gap:3px}.account-cell strong{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-text);font-size:var(--type-control)}.account-cell small{color:var(--color-text-tertiary);font-size:var(--type-micro);font-family:var(--font-mono)}
.status-pill{width:max-content;display:flex;align-items:center;gap:5px;padding:5px 8px;border-radius:99px;color:var(--color-text-secondary);background:var(--color-surface-soft);font-weight:700}.status-pill.is-running{color:var(--color-primary);background:var(--color-primary-soft)}.status-pill.is-completed{color:var(--color-success);background:var(--color-success-soft)}.status-pill.is-waiting_user{color:var(--color-warning);background:var(--color-warning-soft)}.status-pill.is-failed{color:var(--color-danger);background:var(--color-danger-soft)}
.stage-cell{min-width:150px;display:grid;gap:7px}.stage-cell strong{color:var(--color-text-secondary);font-size:var(--type-meta)}.stage-track{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.stage-track i{height:4px;border-radius:99px;background:var(--color-border)}.stage-track i.done{background:var(--color-success)}.stage-track i.active{background:var(--color-primary)}.row-progress{min-width:110px;display:flex;align-items:center;gap:8px}.row-progress>span{width:74px;height:5px;overflow:hidden;border-radius:99px;background:var(--color-border)}.row-progress i{display:block;height:100%;border-radius:inherit;background:var(--color-primary);transition:width var(--motion-fast)}.row-progress strong{width:30px;color:var(--color-text-secondary);font-size:var(--type-micro);font-variant-numeric:tabular-nums}.duration-cell{font-variant-numeric:tabular-nums;white-space:nowrap}.result-text{display:block;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.filtered-empty{height:100%;min-height:220px;display:grid;place-content:center;justify-items:center;gap:8px;color:var(--color-text-tertiary);text-align:center}.filtered-empty strong{color:var(--color-text)}.filtered-empty span{font-size:var(--type-meta)}
.detail-layer{position:fixed;inset:0;z-index:3200;pointer-events:none}.detail-overlay{position:absolute;inset:0;border:0;opacity:0;background:var(--color-overlay);transition:opacity var(--motion-normal)}.detail-drawer{position:absolute;top:10px;right:10px;bottom:10px;width:min(460px,calc(100vw - 20px));display:grid;grid-template-rows:auto auto auto minmax(220px,1fr) auto auto;gap:14px;padding-bottom:14px;overflow:hidden;border:1px solid var(--color-border);border-radius:18px;background:var(--color-surface);box-shadow:var(--shadow-overlay);transform:translateX(calc(100% + 24px));transition:transform var(--motion-normal) var(--ease-emphasized)}.detail-layer.open{pointer-events:auto}.detail-layer.open .detail-overlay{opacity:1}.detail-layer.open .detail-drawer{transform:translateX(0)}.detail-drawer>header{min-height:66px;display:flex;align-items:center;justify-content:space-between;padding:0 17px;border-bottom:1px solid var(--color-border)}.detail-drawer>header>div{display:grid;gap:3px}.detail-drawer>header span{color:var(--color-text-tertiary);font-size:var(--type-meta)}.detail-drawer>header strong{color:var(--color-text);font-size:var(--type-card)}.detail-drawer>header button{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--color-border);border-radius:9px;color:var(--color-text-secondary);background:var(--color-surface);cursor:pointer}
.detail-status{margin:0 16px;display:grid;grid-template-columns:auto 1fr;gap:11px;padding:14px;border-radius:13px;background:var(--color-surface-soft)}.detail-status-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;color:var(--color-text-secondary);background:var(--color-surface)}.detail-status>div{display:grid;gap:4px}.detail-status strong{color:var(--color-text);font-size:var(--type-control)}.detail-status p{margin:0;color:var(--color-text-secondary);font-size:var(--type-meta);line-height:1.5}.detail-status.is-running{background:var(--color-primary-soft)}.detail-status.is-running .detail-status-icon{color:var(--color-primary)}.detail-status.is-completed{background:var(--color-success-soft)}.detail-status.is-completed .detail-status-icon{color:var(--color-success)}.detail-status.is-waiting_user{background:var(--color-warning-soft)}.detail-status.is-waiting_user .detail-status-icon{color:var(--color-warning)}.detail-status.is-failed{background:var(--color-danger-soft)}.detail-status.is-failed .detail-status-icon{color:var(--color-danger)}
.detail-stage{margin:0 16px;display:grid;gap:8px}.detail-stage>div:first-child{display:flex;justify-content:space-between;color:var(--color-text-tertiary);font-size:var(--type-meta)}.detail-stage strong{color:var(--color-text-secondary)}.detail-stage small{color:var(--color-text-tertiary);font-size:var(--type-micro);word-spacing:8px}.browser-shell{min-height:220px;margin:0 16px;display:grid;grid-template-rows:38px minmax(0,1fr);overflow:hidden;border:1px solid var(--color-execution-border);border-radius:13px;background:var(--color-execution-surface)}.browser-toolbar{display:flex;align-items:center;gap:7px;padding:0 10px;color:rgba(248,250,252,.68);font-size:var(--type-micro)}.browser-toolbar>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.traffic{display:flex;gap:4px;margin-right:3px}.traffic i{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.22)}.browser-viewport{position:relative;min-height:0;background:#f2f4f7}.demo-browser-preview,.browser-placeholder{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:9px;padding:24px;text-align:center}.demo-browser-preview{color:var(--color-primary);background:linear-gradient(145deg,#f7f9ff,#eef3ff)}.demo-browser-preview strong,.browser-placeholder strong{color:var(--color-text)}.demo-browser-preview span,.browser-placeholder span{color:var(--color-text-secondary);font-size:var(--type-meta)}.preview-progress{width:min(240px,75%);margin-top:6px}.batch-webview{position:absolute;inset:0;width:100%;height:100%;visibility:hidden;border:0;background:#fff}.batch-webview.active{visibility:visible}.primary-action{height:40px;margin:0 16px;border:0;border-radius:10px;color:#fff;background:var(--color-primary);font-size:var(--type-control);font-weight:700;cursor:pointer}.primary-action.warning{background:var(--color-warning)}.scope-note{margin:0 16px;display:flex;align-items:flex-start;gap:7px;padding:10px;border-radius:9px;color:var(--color-success);background:var(--color-success-soft)}.scope-note span{font-size:var(--type-meta);line-height:1.5}.spin{animation:console-spin .9s linear infinite}@keyframes console-spin{to{transform:rotate(360deg)}}
@media(max-width:1100px){.run-header{grid-template-columns:1fr auto}.batch-progress{grid-column:1/-1;grid-row:2}.metric-strip{grid-template-columns:repeat(5,minmax(118px,1fr));overflow-x:auto}.execution-toolbar{align-items:flex-start}.toolbar-controls{display:grid}.search-control{width:100%}}
@media(max-width:760px){.run-header{grid-template-columns:1fr}.header-actions{justify-content:space-between}.batch-progress{grid-row:auto}.metric-strip{grid-template-columns:repeat(5,130px)}.execution-toolbar{display:grid}.toolbar-controls{justify-content:stretch}.status-filters{max-width:100%;overflow-x:auto}.status-filters button{white-space:nowrap}.detail-drawer{top:6px;right:6px;bottom:6px;width:calc(100vw - 12px)}.sync-state{display:none}}
@media(prefers-reduced-motion:reduce){.spin{animation:none}.detail-overlay,.detail-drawer,.progress-track i,.preview-progress i,.row-progress i{transition:none}}
</style>
