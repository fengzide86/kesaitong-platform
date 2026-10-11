<template>
  <div class="records-page">
    <PageHeader eyebrow="活动记录" title="工具记录" description="查看真实执行结果与本机恢复状态。">
      <template #actions>
        <router-link class="support-link" to="/user/ai-chat"><MessageCircle :size="16" />联系帮助</router-link>
      </template>
    </PageHeader>

    <RecoveryPanel />
    <AsyncStateNotice v-if="staleError" state="stale" :message="staleError" @retry="loadRecords(failedAppend)" />

    <section class="records-card" :aria-busy="loading">
      <div v-if="loading" class="records-loading"><LoaderCircle :size="22" class="spin" />正在加载…</div>
      <div v-else-if="loadError" class="empty-records error-records" role="alert">
        <CircleAlert :size="42" :stroke-width="1.5" />
        <h3>记录暂时无法加载</h3>
        <p>{{ loadError }}</p>
        <button type="button" @click="loadRecords(false)">重新加载</button>
      </div>
      <div v-else-if="rows.length" class="record-list">
        <article v-for="record in rows" :key="`${record.kind}-${record.id}`" class="record-row">
          <div class="record-icon"><component :is="statusIcon(record.status)" :size="18" /></div>
          <div class="record-main">
            <strong>{{ record.toolName }}</strong>
            <span>{{ formatTime(record.time) }}</span>
          </div>
          <div class="record-badges">
            <span class="kind-badge live">真实</span>
            <span :class="['result-badge', statusClass(record.status)]">{{ statusText(record.status, record.kind) }}</span>
          </div>
          <div class="record-actions">
            <button type="button" @click="openDetail(record)">查看结果</button>
            <button v-if="record.status === 'succeeded'" type="button" @click="useAgain(record)">作为新任务使用</button>
            <button v-if="record.kind === 'live' && record.status === 'failed'" type="button" class="support" @click="contactSupport(record)">联系帮助</button>
          </div>
        </article>
      </div>
      <div v-else class="empty-records">
        <History :size="42" :stroke-width="1.5" />
        <h3>还没有真实执行记录</h3>
        <p>真实工具完成处理后，结果会显示在这里。</p>
        <router-link to="/user/tools">查看工具与准备项</router-link>
      </div>
    </section>
    <footer v-if="rows.length" class="record-pagination"><span>已显示 {{ rows.length }} / 共 {{ totals[activeTab] }} 条</span><button v-if="rows.length < totals[activeTab]" type="button" :disabled="loadingMore" @click="loadRecords(true)">{{ loadingMore ? '正在加载…' : '加载更多' }}</button><span v-else>已显示全部记录</span></footer>
    <el-drawer v-model="detailVisible" title="执行结果" size="min(480px, 100vw)" destroy-on-close>
      <div v-if="selectedRecord" class="record-detail">
        <h3>{{ selectedRecord.toolName }}</h3><p>{{ statusText(selectedRecord.status, 'live') }} · {{ formatTime(selectedRecord.time) }}</p>
        <p v-if="detailLoading" role="status">正在加载结果…</p>
        <div v-else-if="detailError" role="alert"><p>{{ detailError }}</p><button type="button" class="btn btn-secondary" @click="openDetail(selectedRecord)">重新加载</button></div>
        <template v-else-if="detailRecord">
          <p>{{ detailRecord.verification === 'verified' ? '本条记录由真实 Runner 上报，已通过结果核验链路。' : '本条结果尚未确认，请联系支持核对，不要据此重复操作。' }}</p>
          <p v-if="detailRecord.status === 'failed'">本次处理未完成。请先核对平台现场，再决定是否重新执行。</p>
          <p>记录仅保留脱敏结果，不保存客户原始文件、账号凭据或页面原文。</p>
          <button type="button" class="btn btn-secondary" @click="contactSupport(selectedRecord)">就此结果联系帮助</button>
        </template>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { z } from 'zod'
import { useRouter } from 'vue-router'
import { Ban, Check, CircleAlert, History, LoaderCircle, MessageCircle } from '@lucide/vue'
import { getExecutionsPage, getExecution } from '@/utils/api'
import { authService } from '@/utils/auth'
import { usePlatformStore } from '@/stores/platform'
import { executionRecordListSchema, executionRecordSchema, type ExecutionRecord } from '@/features/user/model'
import AsyncStateNotice from '@/components/AsyncStateNotice.vue'
import PageHeader from '@/components/PageHeader.vue'
import RecoveryPanel from '@/features/recovery/RecoveryPanel.vue'
import { prepareSupportContext } from '@/features/ai/supportHandoff'

type RecordKind = 'demo' | 'live'
interface RecordRow {
  id: string | number
  kind: RecordKind
  toolId?: string
  toolName: string
  status: string
  time?: string | null
  errorCode?: string | null
}

const router = useRouter()
const platformStore = usePlatformStore()
const activeTab = ref<RecordKind>('live')
const liveRows = ref<RecordRow[]>([])
const loading = ref(true)
const loadError = ref('')
const staleError = ref('')
const loadingMore = ref(false)
const failedAppend = ref(false)
const totals = ref({ demo: 0, live: 0 })
const pages = ref({ demo: 0, live: 0 })
const pageSize = 20
let requestSequence = 0
const rows = computed(() => liveRows.value)
const detailVisible = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const selectedRecord = ref<RecordRow | null>(null)
const detailRecord = ref<ExecutionRecord | null>(null)
let detailSequence = 0

async function openDetail(record: RecordRow) {
  const sequence = ++detailSequence
  const platform = platformStore.currentPlatform
  const token = authService.getAuth()?.token
  const current = () => sequence === detailSequence && detailVisible.value && platform === platformStore.currentPlatform && token === authService.getAuth()?.token
  selectedRecord.value = record
  detailVisible.value = true
  detailLoading.value = true
  detailError.value = ''
  detailRecord.value = null
  try {
    const result = executionRecordSchema.parse(await getExecution(record.id))
    if (current()) detailRecord.value = result
  } catch (error) {
    if (current()) detailError.value = error instanceof Error ? error.message : '结果暂时无法加载，请重试'
  } finally { if (current()) detailLoading.value = false }
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function statusText(status: string, kind: RecordKind): string {
  if (kind === 'demo') return ({ created: '待演示', running: '演示中', paused: '已暂停', completed: '演示完成', cancelled: '已退出', error: '演示异常' } as Record<string, string>)[status] || '演示已结束'
  return ({ queued: '等待执行', running: '执行中', waiting_user: '需要你操作', verifying: '核验中', succeeded: '真实成功', failed: '执行失败', cancelled: '已取消', interrupted: '已中断', inconclusive: '结果未确认' } as Record<string, string>)[status] || '已结束'
}

function statusClass(status: string): string {
  if (status === 'completed' || status === 'succeeded') return 'success'
  if (status === 'error' || status === 'failed') return 'failed'
  return 'cancelled'
}

function statusIcon(status: string) {
  return status === 'completed' || status === 'succeeded' ? Check : status === 'error' || status === 'failed' ? CircleAlert : Ban
}

function useAgain(record: RecordRow) {
  void router.push({ path: '/user/tools', query: record.toolId ? { tool: record.toolId } : {} })
}

function contactSupport(record: RecordRow) {
  prepareSupportContext({
    tool_name: record.toolName,
    problem_code: record.errorCode,
    execution_mode: 'live',
    run_status: record.status,
  }, platformStore.currentPlatform)
  void router.push('/user/ai-chat')
}

async function loadRecords(append = false) {
  if (append && loadingMore.value) return
  const sequence = ++requestSequence
  const kind = activeTab.value
  const platform = platformStore.currentPlatform
  const token = authService.getAuth()?.token
  const current = (): boolean => sequence === requestSequence && kind === activeTab.value && platform === platformStore.currentPlatform && token === authService.getAuth()?.token
  const hadData = rows.value.length > 0
  loadingMore.value = append
  failedAppend.value = append
  loading.value = !hadData
  loadError.value = ''
  staleError.value = ''
  try {
    const params = { platform_key: platform, page: append ? pages.value[kind] + 1 : 1, page_size: pageSize }
    let nextRows: RecordRow[]
    let total: number
    {
      const response = z.object({ data: executionRecordListSchema, total: z.number().int().nonnegative() }).parse(await getExecutionsPage(params))
      total = response.total
      nextRows = response.data.map(record => ({
        id: record.id,
        kind: 'live',
        toolId: record.tool_id === null || record.tool_id === undefined ? undefined : String(record.tool_id),
        toolName: record.tool_name || '真实执行',
        status: record.status,
        time: record.created_at,
        errorCode: record.error_code,
      }))
    }
    if (!current()) return
    const target = liveRows
    target.value = append ? [...new Map([...target.value, ...nextRows].map(record => [String(record.id), record])).values()] : nextRows
    totals.value[kind] = total
    pages.value[kind] = params.page
  } catch (error) {
    if (!current()) return
    const message = error instanceof Error && error.message ? error.message : '请检查网络连接后重试。'
    if (hadData) staleError.value = message
    else loadError.value = message
  } finally {
    if (current()) { loading.value = false; loadingMore.value = false }
  }
}

watch(activeTab, () => { void loadRecords() })
watch(() => platformStore.currentPlatform, () => {
  detailSequence += 1
  detailVisible.value = false
  liveRows.value = []
  totals.value = { demo: 0, live: 0 }
  pages.value = { demo: 0, live: 0 }
  void loadRecords()
})
onMounted(() => { void loadRecords() })
onUnmounted(() => { requestSequence += 1; detailSequence += 1 })
</script>

<style scoped>
.record-pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:16px;color:var(--color-text-secondary);font-size:var(--type-meta)}.record-pagination button{padding:9px 14px;border:1px solid var(--color-border);border-radius:9px;background:var(--color-surface);color:var(--color-primary);cursor:pointer}.record-pagination button:disabled{opacity:.5;cursor:wait}
.records-page { width: min(1050px, 100%); margin: 0 auto; }
.record-detail { display: grid; gap: 14px; }.record-detail h3, .record-detail p { margin: 0; line-height: 1.7; }.record-detail p { color: var(--color-text-secondary); }
.records-eyebrow { display: block; margin-bottom: 8px; color: var(--color-primary); font-size:var(--type-meta); font-weight: 800; letter-spacing: .12em; }
.records-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
.records-header h2 { margin: 0; color: var(--color-text); font-size: var(--type-page); letter-spacing: -.03em; }
.records-header p { margin: 7px 0 0; color: var(--color-text-secondary); font-size: 13px; }
.support-link { min-height: 38px; display: inline-flex; align-items: center; gap: 7px; padding: 0 13px; border: 1px solid var(--color-border); border-radius: var(--radius-md); color: var(--color-text); background: var(--color-surface); font-size:var(--type-control); font-weight: 700; text-decoration: none; }
.support-link:hover { color: var(--color-primary); border-color: var(--color-primary-muted); }
.record-tabs { display: flex; gap: 6px; margin-bottom: 10px; padding: 4px; width: max-content; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-surface-soft); }
.record-tabs button { min-height: 34px; padding: 0 13px; border: 0; border-radius: 7px; color: var(--color-text-secondary); background: transparent; font-size: var(--type-control); font-weight: 700; cursor: pointer; }
.record-tabs button.active { color: var(--color-primary); background: var(--color-surface); box-shadow: var(--shadow-low); }
.record-disclosure { margin: 0 0 12px; padding: 9px 11px; border-radius: 8px; color: var(--color-primary); background: var(--color-primary-soft); font-size: var(--type-meta); }
.records-card { overflow: hidden; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-low); }
.record-row { min-height: 76px; display: grid; grid-template-columns: 40px minmax(160px, 1fr) 86px auto; align-items: center; gap: 14px; padding: 13px 18px; border-bottom: 1px solid var(--color-border); transition: background var(--motion-fast); }
.record-row:hover { background: var(--color-surface-soft); }
.record-row:last-child { border-bottom: 0; }
.record-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 9px; color: var(--color-primary); background: var(--color-primary-soft); }
.record-main strong, .record-main span { display: block; }
.record-main strong { color: var(--color-text); font-size: 13px; }
.record-main span { margin-top: 4px; color: var(--color-text-secondary); font-size:var(--type-meta); }
.result-badge { justify-self: start; padding: 4px 8px; border-radius: 999px; font-size:var(--type-meta); font-weight: 700; }
.result-badge.success { color: var(--color-success); background: var(--color-success-soft); }
.result-badge.failed { color: var(--color-danger); background: var(--color-danger-soft); }
.result-badge.cancelled { color: var(--color-text-secondary); background: var(--color-surface-soft); }
.record-badges { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
.kind-badge { padding: 4px 7px; border-radius: 999px; font-size: var(--type-micro); font-weight: 800; }
.kind-badge.demo { color: var(--color-primary); background: var(--color-primary-soft); }
.kind-badge.live { color: var(--color-success); background: var(--color-success-soft); }
.record-actions { display: flex; gap: 7px; }
.record-actions button { min-height: 32px; padding: 0 10px; border: 1px solid var(--color-border); border-radius: 7px; color: var(--color-text); background: white; font-size:var(--type-meta); font-weight: 700; cursor: pointer; }
.record-actions button:hover { border-color: var(--color-primary-muted); color: var(--color-primary); }
.record-actions .support { color: var(--color-danger); }
.records-loading, .empty-records { min-height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--color-text-secondary); }
.records-loading { flex-direction: row; font-size: 13px; }
.empty-records h3 { margin: 0; color: var(--color-text); font-size: 15px; }
.empty-records a { color: var(--color-primary); font-size:var(--type-control); font-weight: 700; text-decoration: none; }
.empty-records p { margin: 0; font-size: var(--type-control); }
.empty-records button { min-height: 36px; padding: 0 12px; border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-primary); background: var(--color-surface); font-weight: 700; cursor: pointer; }
.error-records > svg { color: var(--color-danger); }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 700px) {
  .record-row { grid-template-columns: 38px 1fr auto; }
  .record-actions { grid-column: 2 / -1; }
  .result-badge { justify-self: end; }
}
</style>
