<template>
  <div class="action-center">
    <PageHeader eyebrow="运营中心" title="行动中心" description="先处理会影响客户使用的事项，再查看日常经营数据。">
      <template #actions>
        <button class="refresh-button" :disabled="loading" @click="loadData"><RefreshCw :size="15" :class="{ spin: loading }" />刷新</button>
      </template>
    </PageHeader>

    <AsyncStateNotice :state="loadState" :message="loadError" loading-text="正在加载行动中心…" @retry="loadData" />

    <section v-if="loadState !== 'loading' && loadState !== 'error'" class="summary-grid" aria-label="待处理事项摘要">
      <button v-for="card in summaryCards" :key="card.key" :class="['summary-card', 'kst-interactive', `tone-${card.tone}`]" @click="scrollToSection(card.key)">
        <span class="summary-icon"><component :is="card.icon" :size="20" /></span>
        <span><small>{{ card.label }}</small><strong>{{ card.value }}</strong><em>{{ card.hint }}</em></span>
        <ChevronRight :size="17" />
      </button>
    </section>

    <section v-if="loadState !== 'loading' && loadState !== 'error' && data.agency_delivery_tasks.length" class="action-panel delivery-panel" aria-label="销售交付待办">
      <header><div><span>负责人待办</span><h3>销售与授权交付</h3></div><router-link to="/admin/agency">代理与交付</router-link></header>
      <div class="delivery-tasks">
        <router-link v-for="task in data.agency_delivery_tasks" :key="task.key" :to="{ path: '/admin/agency', query: { section: task.section, status: task.status } }">
          <span>{{ task.label }}</span><strong>{{ task.count }}</strong><ChevronRight :size="17" />
        </router-link>
      </div>
    </section>

    <section v-if="loadState !== 'loading' && loadState !== 'error'" class="quick-actions-panel action-panel" aria-label="常用操作">
      <header><div><span>常用操作</span><h3>需要办理什么，直接从这里开始</h3></div><small>操作仍按当前账号权限执行</small></header>
      <div class="quick-actions-grid">
        <router-link class="quick-action" to="/admin/local-runtime"><span class="quick-action-icon"><Wrench :size="17" /></span><span><strong>打开工具现场</strong><small>先选账号，再选择已开放的工具</small></span><ChevronRight :size="16" /></router-link>
        <router-link v-if="canCreateAuthorization" class="quick-action" to="/admin/authcodes?action=create"><span class="quick-action-icon"><KeyRound :size="17" /></span><span><strong>新建授权码</strong><small>给客户开通工具使用权限</small></span><ChevronRight :size="16" /></router-link>
        <router-link v-if="canCreateOrder" class="quick-action" to="/admin/orders?action=create"><span class="quick-action-icon"><WalletCards :size="17" /></span><span><strong>登记订单与负责人</strong><small>记录订单金额和交付负责人</small></span><ChevronRight :size="16" /></router-link>
        <router-link class="quick-action" to="/admin/feedback"><span class="quick-action-icon"><MessageSquareText :size="17" /></span><span><strong>处理客户工单</strong><small>查看问题并回复客户</small></span><ChevronRight :size="16" /></router-link>
      </div>
    </section>

    <section v-if="loadState !== 'loading' && loadState !== 'error' && hasExecutionAlerts" class="priority-grid">
      <article id="waiting_interventions" class="action-panel primary-panel">
        <header><div><span>优先处理</span><h3>需要人工介入的执行</h3></div><span class="count-badge warning">{{ data.waiting_interventions?.length || 0 }}</span></header>
        <div v-if="data.waiting_interventions?.length" class="action-list">
          <button v-for="item in data.waiting_interventions" :key="`${item.batch_id}-${item.account_label_masked}`" @click="openBatch(item.batch_id)">
            <span class="row-icon warning"><UserRoundCheck :size="17" /></span>
            <span class="row-copy"><strong>{{ item.tool_name }}</strong><small>{{ item.account_label_masked }} · {{ interventionText(item.intervention_type) }}</small></span>
            <span class="row-time">{{ formatRelative(item.updated_at) }}</span><ChevronRight :size="15" />
          </button>
        </div>
        <EmptyState v-else :icon="CheckCircle2" title="暂无可处理的执行提醒" description="当前控制面不接入旧 Runner 告警。登录或验证请在客户端现场处理。" />
      </article>

      <article id="stale_batches" class="action-panel">
        <header><div><span>运行关注</span><h3>连接异常候选</h3></div><span class="count-badge">{{ data.stale_batches?.length || 0 }}</span></header>
        <div v-if="data.stale_batches?.length" class="action-list compact">
          <button v-for="item in data.stale_batches" :key="item.batch_id" @click="openBatch(item.batch_id)">
            <span class="row-icon danger"><WifiOff :size="16" /></span>
            <span class="row-copy"><strong>{{ item.tool_name }}</strong><small>超过 90 秒未收到本地状态</small></span>
            <span class="row-time">{{ formatRelative(item.last_heartbeat_at) }}</span><ChevronRight :size="15" />
          </button>
        </div>
        <EmptyState v-else :icon="CheckCircle2" title="暂无连接异常提醒" description="这里不包含旧 Runner 与 Demo，实际运行状态以客户端为准。" />
      </article>
    </section>

    <details v-if="loadState !== 'loading' && loadState !== 'error' && !hasExecutionAlerts" class="runtime-explanation">
      <summary>客户端运行说明</summary>
      <p>登录、验证码和现场核对请在客户软件内处理。当前控制面不接入旧 Runner 与演示告警，这里没有提醒不代表客户端没有异常。</p>
    </details>

    <section v-if="loadState !== 'loading' && loadState !== 'error'" class="operations-grid">
      <article id="expiring_authorizations" class="action-panel">
        <header><div><span>7 天内</span><h3>即将到期授权</h3></div><router-link to="/admin/authcodes">全部授权</router-link></header>
        <div v-if="data.expiring_authorizations?.length" class="simple-list">
          <router-link v-for="item in data.expiring_authorizations.slice(0, 6)" :key="item.id" class="record-task" :to="{ path: '/admin/authcodes', query: { auth_code_id: item.id, return_to: '/admin/dashboard' } }"><span><KeyRound :size="15" /><span class="record-task-text" :title="item.code_masked">{{ item.code_masked }}</span></span><strong>{{ formatDate(item.expires_at) }}</strong><ChevronRight :size="16" aria-hidden="true" /></router-link>
        </div>
        <EmptyState v-else :icon="CheckCircle2" title="近期没有授权到期" description="未来 7 天无需续期跟进。" />
      </article>

      <article id="device_anomalies" class="action-panel">
        <header><div><span>授权边界</span><h3>设备与席位异常</h3></div><router-link to="/admin/authcodes">去处理</router-link></header>
        <div v-if="data.device_anomalies?.length" class="simple-list">
          <router-link v-for="item in data.device_anomalies.slice(0, 6)" :key="item.auth_code_id" class="record-task" :to="{ path: '/admin/authcodes', query: { auth_code_id: item.auth_code_id, return_to: '/admin/dashboard' } }"><span><MonitorSmartphone :size="15" /><span class="record-task-text" :title="item.code_masked">{{ item.code_masked }}</span></span><strong>{{ item.device_used }}/{{ item.device_limit }} 设备 · {{ item.seat_used }}/{{ item.seat_limit }} 席位</strong><ChevronRight :size="16" aria-hidden="true" /></router-link>
        </div>
        <EmptyState v-else :icon="CheckCircle2" title="授权使用正常" description="没有超出设备或席位上限的授权。" />
      </article>

      <article id="pending_tickets" class="action-panel">
        <header><div><span>客户支持</span><h3>待处理工单</h3></div><router-link to="/admin/feedback">全部工单</router-link></header>
        <div v-if="data.pending_tickets?.length" class="simple-list">
          <router-link v-for="item in data.pending_tickets.slice(0, 6)" :key="item.id" class="record-task" :to="{ path: '/admin/feedback', query: { ticket_id: item.id, return_to: '/admin/dashboard' } }"><span><MessageSquareText :size="15" /><span class="record-task-text" :title="item.title">{{ item.title }}</span></span><strong>{{ priorityText(item.priority) }} · {{ formatRelative(item.created_at) }}</strong><ChevronRight :size="16" aria-hidden="true" /></router-link>
        </div>
        <EmptyState v-else :icon="CheckCircle2" title="工单已经处理完" description="当前没有等待回复的客户问题。" />
      </article>

      <article v-if="canSeeExpenses" id="expense_renewals" class="action-panel">
        <header><div><span>公账支出</span><h3>待续费项目</h3></div><router-link to="/admin/expenses?tab=renewals&due=1">进入续费账本</router-link></header>
        <div v-if="data.expense_renewals?.length" class="simple-list">
          <div v-for="item in data.expense_renewals.slice(0, 6)" :key="item.id"><span><WalletCards :size="15" />{{ item.name }}</span><strong>{{ formatDate(item.next_due_on) }} · ¥{{ Number(item.default_amount).toFixed(2) }}</strong></div>
        </div>
        <EmptyState v-else :icon="CheckCircle2" title="近期没有待续费项目" description="按各项目设置的提前提醒天数展示，逾期项目也会保留。" />
      </article>

      <article v-if="canReviewTargets" id="target_review" class="action-panel target-review-entry" aria-label="平台入口审核">
        <header>
          <div><span>平台入口</span><h3>待审核入口</h3></div>
          <router-link class="target-review-link" to="/admin/target-reviews">审核列表 <ChevronRight :size="15" /></router-link>
        </header>
        <p v-if="targetReviewState === 'loading'" class="target-review-copy" role="status">正在读取…</p>
        <div v-else-if="targetReviewState === 'error'" class="target-review-copy" role="alert"><p>{{ targetReviewError }}</p><button class="refresh-button" @click="loadTargetReviews">重试</button></div>
        <div v-else-if="pendingReviews.length" class="review-task-list">
          <router-link v-for="item in pendingReviews.slice(0, 1)" :key="item.profile.id" :to="{ path: '/admin/target-reviews', query: { profile_id: item.profile.id } }" class="review-task">
            <span class="review-task-top"><span class="review-task-icon"><ShieldCheck :size="16" /></span><span class="review-task-copy"><strong :title="item.profile.name">{{ item.profile.name }}</strong><small :title="displayEntry(item.profile.entryUrl)">{{ displayEntry(item.profile.entryUrl) }}</small></span></span>
            <span class="review-task-bottom"><em class="review-task-status">待你确认</em><span class="review-task-action">打开并核对<ChevronRight :size="14" /></span></span>
          </router-link>
          <p v-if="pendingReviews.length > 1" class="review-more-hint">另有 {{ pendingReviews.length - 1 }} 条待审核</p>
        </div>
        <EmptyState v-else :icon="CheckCircle2" title="暂时没有待审核入口" description="有新的平台申请时会在这里提醒。" />
      </article>
    </section>

    <el-drawer v-model="batchDrawerVisible" size="min(560px, 94vw)" title="批次详情" class="batch-detail-drawer">
      <div v-if="batchLoading" class="drawer-loading"><LoaderCircle :size="22" class="spin" />正在读取脱敏状态</div>
      <div v-else-if="batchDetail" class="batch-detail">
        <div class="detail-hero"><span>业务工具</span><strong>{{ batchDetail.tool_name }}</strong><small>{{ batchDetail.total_count }} 个账号 · {{ batchStatusText(batchDetail.status) }}</small></div>
        <div class="privacy-note"><ShieldCheck :size="16" />这里只展示脱敏标签和执行状态，不保存客户文件、密码或页面内容。</div>
        <div class="batch-items">
          <div v-for="(item,index) in batchDetail.items" :key="`${item.account_label_masked}-${index}`">
            <span :class="['item-state', `is-${item.status}`]"></span>
            <span><strong>{{ item.account_label_masked }}</strong><small>{{ item.customer_message || batchStatusText(item.status) }}</small></span>
            <em>{{ interventionText(item.intervention_type) }}</em>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { CheckCircle2, ChevronRight, KeyRound, LoaderCircle, MessageSquareText, MonitorSmartphone, RefreshCw, ShieldAlert, ShieldCheck, TicketCheck, TimerReset, UserRoundCheck, WalletCards, WifiOff, Wrench } from '@lucide/vue'
import EmptyState from '@/components/EmptyState.vue'
import AsyncStateNotice from '@/components/AsyncStateNotice.vue'
import PageHeader from '@/components/PageHeader.vue'
import { getAdminActionCenter, getAdminBusinessBatch } from '@/utils/api'
import { showToast } from '@/utils'
import {
  adminActionCenterSchema,
  adminBatchDetailSchema,
  type AdminActionCenter,
  type AdminBatchDetail,
} from '@/features/admin/model'
import { failedDataState, settledDataState, type AsyncDataState } from '@/features/async/state'
import { authService } from '@/utils/auth'
import { hasStaffPermission } from '@/features/auth/permissions'
import { listTargetProfileReviews } from '@/utils/api/target-profiles'
import type { SignedTargetProfile } from '@/shared/ipc/target-contract'
import { displayEntry, targetError } from '@/features/targets/presentation'
import { scrollToWorkflowTarget } from '@/shared/ui/workflowMotion'

const data = ref<AdminActionCenter>(adminActionCenterSchema.parse({
  summary: {},
  expiring_authorizations: [],
  device_anomalies: [],
  pending_tickets: [],
  waiting_interventions: [],
  stale_batches: [],
  expense_renewals: [],
}))
const loading = ref(false)
const loadState = ref<AsyncDataState>('loading')
const loadError = ref('')
const hasLoaded = ref(false)
const batchLoading = ref(false)
const batchDrawerVisible = ref(false)
const batchDetail = ref<AdminBatchDetail | null>(null)
const canSeeExpenses = authService.getRole() !== 'support'
const canReviewTargets = computed(() => hasStaffPermission(authService.getRole(), 'updates.manage'))
const canCreateAuthorization = computed(() => hasStaffPermission(authService.getRole(), 'auth_codes.write'))
const canCreateOrder = computed(() => hasStaffPermission(authService.getRole(), 'orders.write'))
const targetReviews = ref<SignedTargetProfile[]>([])
const targetReviewState = ref<'loading' | 'ready' | 'error'>('loading')
const targetReviewError = ref('')
const pendingReviews = computed(() => targetReviews.value.filter(item => item.profile.reviewStatus === 'pending'))
let targetReviewSequence = 0
const hasExecutionAlerts = computed(() => data.value.waiting_interventions.length > 0 || data.value.stale_batches.length > 0)
let loadSequence = 0

const summaryCards = computed(() => [
  { key: 'expiring_authorizations', label: '即将到期授权', value: data.value.summary?.expiring_authorizations || 0, hint: '7 天内需要跟进', icon: TimerReset, tone: 'premium' },
  { key: 'device_anomalies', label: '设备与席位异常', value: data.value.summary?.device_anomalies || 0, hint: '检查授权使用边界', icon: ShieldAlert, tone: 'danger' },
  { key: 'pending_tickets', label: '待处理工单', value: data.value.summary?.pending_tickets || 0, hint: '等待运营回复', icon: TicketCheck, tone: 'neutral' },
  ...(data.value.waiting_interventions.length ? [{ key: 'waiting_interventions', label: '需要人工介入', value: data.value.summary?.waiting_interventions || data.value.waiting_interventions.length, hint: '客户执行正在等待', icon: UserRoundCheck, tone: 'warning' }] : []),
  ...(canSeeExpenses ? [{ key: 'expense_renewals', label: '待续费项目', value: data.value.summary?.expense_renewals_due || 0, hint: '进入提醒期及已逾期', icon: WalletCards, tone: 'premium' }] : []),
])

async function loadTargetReviews() {
  if (!canReviewTargets.value) return
  const sequence = ++targetReviewSequence
  targetReviewState.value = 'loading'
  targetReviewError.value = ''
  try {
    const items = await listTargetProfileReviews()
    if (sequence !== targetReviewSequence) return
    targetReviews.value = items
    targetReviewState.value = 'ready'
  } catch (error) {
    if (sequence !== targetReviewSequence) return
    targetReviewState.value = 'error'
    targetReviewError.value = targetError(error)
  }
}

async function loadData() {
  void loadTargetReviews()
  const requestSequence = ++loadSequence
  loading.value = true
  loadState.value = hasLoaded.value ? 'data' : 'loading'
  loadError.value = ''
  try {
    const nextData = adminActionCenterSchema.parse(await getAdminActionCenter())
    if (requestSequence !== loadSequence) return
    data.value = nextData
    hasLoaded.value = true
    const itemCount = (data.value.expiring_authorizations?.length || 0)
      + (data.value.device_anomalies?.length || 0)
      + (data.value.pending_tickets?.length || 0)
      + (data.value.waiting_interventions?.length || 0)
      + (data.value.stale_batches?.length || 0)
      + (data.value.expense_renewals?.length || 0)
      + data.value.agency_delivery_tasks.reduce((sum, task) => sum + task.count, 0)
    loadState.value = settledDataState(itemCount)
  } catch (error) {
    if (requestSequence !== loadSequence) return
    loadError.value = error instanceof Error && error.message ? error.message : '行动中心加载失败，请稍后重试'
    loadState.value = failedDataState(hasLoaded.value)
    showToast('行动中心加载失败，请稍后重试', 'error')
  }
  finally {
    if (requestSequence === loadSequence) loading.value = false
  }
}

async function openBatch(batchId: string | number) {
  batchDrawerVisible.value = true
  batchLoading.value = true
  batchDetail.value = null
  try { batchDetail.value = adminBatchDetailSchema.parse(await getAdminBusinessBatch(batchId)) }
  catch { showToast('批次详情读取失败', 'error') }
  finally { batchLoading.value = false }
}

function scrollToSection(id: string) { scrollToWorkflowTarget(document.getElementById(id), { block: 'center' }) }
function formatDate(value?: string | null) { return value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(value)) : '-' }
function formatRelative(value?: string | null) {
  if (!value) return '-'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`
  return formatDate(value)
}
function interventionText(type?: string | null) {
  const labels: Record<string, string> = { login: '需要登录', captcha: '需要验证码', two_factor: '需要二次验证', page_confirmation: '需要页面确认', other: '需要操作' }
  return type ? labels[type] || '查看状态' : '查看状态'
}
function priorityText(value?: string | null) {
  const labels: Record<string, string> = { high: '高优先级', medium: '普通', low: '低优先级' }
  return value ? labels[value] || '普通' : '普通'
}
function batchStatusText(status: string) {
  const labels: Record<string, string> = { running: '正在处理', completed: '已完成', cancelled: '已结束', interrupted: '连接中断', waiting_user: '需要操作', failed: '未完成', pending: '等待处理' }
  return labels[status] || status
}
onMounted(loadData)
onBeforeUnmount(() => { loadSequence++; targetReviewSequence++ })
</script>

<style scoped>
.simple-list .record-task { display: flex; align-items: center; gap: 12px; padding: 12px 16px; min-height: 48px; color: var(--color-text); text-decoration: none; border-bottom: 1px solid var(--color-border); }
.simple-list .record-task:last-child { border-bottom: 0; }
.simple-list .record-task:hover { background: var(--color-primary-soft); }
.simple-list .record-task:focus-visible, .runtime-explanation summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; border-radius: 6px; }
.simple-list .record-task > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.simple-list .record-task-text { display: block; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.simple-list .record-task > strong { flex-shrink: 0; }
.simple-list .record-task > svg { flex-shrink: 0; color: var(--color-primary); }
.runtime-explanation { padding: 12px 16px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 10px; color: var(--color-text-secondary); font-size: var(--type-meta); line-height: 1.7; }
.runtime-explanation summary { cursor: pointer; font-weight: 600; }
.runtime-explanation p { margin: 8px 0 0; }
.delivery-tasks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:16px}.delivery-tasks a{display:grid;grid-template-columns:1fr auto;gap:8px;padding:14px;border:1px solid var(--color-border);border-radius:10px;color:var(--color-text);text-decoration:none}.delivery-tasks a:hover{background:var(--color-primary-soft)}.delivery-tasks span{grid-column:1/-1;font-size:var(--type-meta);color:var(--color-text-secondary)}.delivery-tasks strong{font-size:24px}.delivery-tasks svg{align-self:center;color:var(--color-primary)}@media(max-width:900px){.delivery-tasks{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){.delivery-tasks{grid-template-columns:1fr}}
.action-center{display:grid;gap:14px}.page-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.page-heading>div>span{color:var(--color-primary);font-size:var(--type-micro);font-weight:800;letter-spacing:.14em}.page-heading h2{margin:6px 0 0;color:var(--color-text);font-size:var(--type-page);letter-spacing:-.035em}.page-heading p{margin:7px 0 0;color:var(--color-text-secondary);font-size:var(--type-meta)}.refresh-button{height:34px;display:flex;align-items:center;gap:7px;padding:0 11px;border:1px solid var(--color-border);border-radius:9px;color:var(--color-text-secondary);background:var(--color-surface);cursor:pointer}.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.summary-card{min-height:96px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;padding:13px 14px;border:1px solid var(--color-border);border-radius:13px;background:var(--color-surface);text-align:left;cursor:pointer;box-shadow:var(--shadow-low);transition:border-color var(--motion-fast),box-shadow var(--motion-fast),background-color var(--motion-fast)}.summary-card:hover{border-color:var(--color-border-strong);box-shadow:var(--shadow-medium)}.summary-icon{width:35px;height:35px;display:grid;place-items:center;border-radius:10px;color:var(--color-primary);background:var(--color-primary-soft)}.summary-card>span:nth-child(2){display:grid;gap:2px;min-width:0}.summary-card small{color:var(--color-text-secondary);font-size:var(--type-micro)}.summary-card strong{color:var(--color-text);font-size:22px;font-variant-numeric:tabular-nums}.summary-card em{color:var(--color-text-secondary);font-size:var(--type-micro);font-style:normal;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.summary-card>svg{color:var(--color-border-strong)}.tone-premium .summary-icon{color:var(--color-premium);background:var(--color-premium-soft)}.tone-warning .summary-icon{color:var(--color-warning);background:var(--color-warning-soft)}.tone-danger .summary-icon{color:var(--color-danger);background:var(--color-danger-soft)}.priority-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(300px,.75fr);gap:14px}.operations-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.operations-grid :deep(.empty-state-container){min-height:156px;padding:20px 12px}.operations-grid :deep(.empty-state-icon){width:44px;height:44px;margin-bottom:.65rem}.operations-grid :deep(.empty-state-icon svg){width:34px;height:34px}.action-panel{min-width:0;border:1px solid var(--color-border);border-radius:15px;background:var(--color-surface);box-shadow:var(--shadow-low);overflow:hidden}.primary-panel{border-color:rgba(183,121,31,.18)}.action-panel>header{min-height:62px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 17px;border-bottom:1px solid var(--color-border)}.action-panel header div{display:grid;gap:4px}.action-panel header span{color:var(--color-text-secondary);font-size:var(--type-micro);letter-spacing:.05em}.action-panel h3{margin:0;color:var(--color-text);font-size:13px}.action-panel header a{color:var(--color-primary);font-size:var(--type-micro);text-decoration:none}.count-badge{min-width:26px;height:26px;display:grid;place-items:center;border-radius:8px;color:var(--color-text-secondary);background:var(--color-canvas);font-size:var(--type-meta);font-weight:800}.count-badge.warning{color:var(--color-warning);background:var(--color-warning-soft)}.action-list{padding:7px}.action-list button{width:100%;min-height:56px;display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:9px;padding:7px 9px;border:0;border-radius:10px;background:transparent;text-align:left;cursor:pointer}.action-list button:hover{background:var(--color-canvas)}.row-icon{width:31px;height:31px;display:grid;place-items:center;border-radius:9px}.row-icon.warning{color:var(--color-warning);background:var(--color-warning-soft)}.row-icon.danger{color:var(--color-danger);background:var(--color-danger-soft)}.row-copy{min-width:0;display:grid;gap:3px}.row-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-text);font-size:var(--type-meta)}.row-copy small,.row-time{color:var(--color-text-secondary);font-size:var(--type-micro)}.action-list button>svg{color:var(--color-border-strong)}.simple-list{padding:8px 13px}.simple-list>div{min-height:43px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--color-border)}.simple-list>div:last-child{border:0}.simple-list span{min-width:0;display:flex;align-items:center;gap:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-text);font-size:var(--type-micro)}.simple-list span svg{flex:0 0 auto;color:var(--color-primary)}.simple-list strong{flex:0 0 auto;color:var(--color-text-secondary);font-size:var(--type-micro);font-weight:600}.drawer-loading{min-height:260px;display:grid;place-content:center;justify-items:center;gap:10px;color:var(--color-text-secondary);font-size:var(--type-meta)}.batch-detail{display:grid;gap:16px}.detail-hero{display:grid;gap:5px;padding:17px;border-radius:13px;background:var(--color-primary-soft)}.detail-hero span,.detail-hero small{color:var(--color-text-secondary);font-size:var(--type-micro)}.detail-hero strong{color:var(--color-text);font-size:16px}.privacy-note{display:flex;align-items:flex-start;gap:8px;padding:11px;border-radius:10px;color:var(--color-success);background:var(--color-success-soft);font-size:var(--type-micro);line-height:1.55}.batch-items{display:grid;gap:5px}.batch-items>div{min-height:49px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;padding:8px 10px;border:1px solid var(--color-border);border-radius:10px}.item-state{width:8px;height:8px;border-radius:50%;background:var(--color-border-strong)}.item-state.is-running{background:var(--color-primary)}.item-state.is-waiting_user{background:var(--color-warning)}.item-state.is-completed{background:var(--color-success)}.item-state.is-failed{background:var(--color-danger)}.batch-items>div>span:nth-child(2){display:grid;gap:3px}.batch-items strong{color:var(--color-text);font-size:var(--type-meta)}.batch-items small,.batch-items em{color:var(--color-text-secondary);font-size:var(--type-micro);font-style:normal}.spin{animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.quick-actions-panel,.todo-panel{margin-top:0}.quick-actions-panel>header small,.todo-panel>header small{color:var(--color-text-secondary);font-size:var(--type-micro)}.quick-actions-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;padding:14px 16px}.quick-action{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;min-width:0;padding:13px;border:1px solid var(--color-border);border-radius:12px;color:var(--color-text);text-decoration:none;background:var(--color-surface);transition:border-color var(--motion-fast),background var(--motion-fast)}.quick-action:hover{border-color:var(--color-primary);background:var(--color-primary-soft)}.quick-action-icon{width:32px;height:32px;display:grid;place-items:center;border-radius:9px;color:var(--color-primary);background:var(--color-primary-soft)}.quick-action>span:nth-child(2){display:grid;gap:3px;min-width:0}.quick-action strong{font-size:var(--type-meta)}.quick-action small{color:var(--color-text-secondary);font-size:var(--type-micro);line-height:1.4}.quick-action>svg{color:var(--color-border-strong)}.todo-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:14px 16px}.todo-card{display:grid;gap:4px;padding:14px;border-radius:12px;color:var(--color-text);text-decoration:none;background:var(--color-canvas);border:1px solid transparent}.todo-card:hover{border-color:var(--color-primary)}.todo-card strong{font-size:22px;font-variant-numeric:tabular-nums}.todo-card span{font-weight:700;font-size:var(--type-meta)}.todo-card small{color:var(--color-text-secondary);font-size:var(--type-micro)}.todo-premium strong{color:var(--color-premium)}.todo-danger strong{color:var(--color-danger)}.todo-primary strong{color:var(--color-primary)}
@media(max-width:1050px){.quick-actions-grid,.todo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:620px){.quick-actions-grid,.todo-grid{grid-template-columns:1fr}.quick-actions-panel>header small,.todo-panel>header small{display:none}}
@media(max-width:1180px){.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:820px){.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.operations-grid{grid-template-columns:1fr}.priority-grid{grid-template-columns:1fr}}
@media(max-width:620px){.summary-grid{grid-template-columns:1fr}.page-heading{display:grid}.refresh-button{width:max-content}.row-time{display:none}}
@media(prefers-reduced-motion:reduce){.summary-card{transition:none}.summary-card:hover{transform:none}.spin{animation:none}}

/* Keep the page in triage order: delivery/runtime action, shortcuts, then detail lists. */
.delivery-panel{order:2}
.priority-grid{order:3}
.quick-actions-panel{order:4}
.runtime-explanation{order:5}
.operations-grid{order:6}

/* Action-center text carries decisions, so it follows the compact-product
   scale instead of the decorative micro scale. */
.refresh-button,
.summary-card,
.action-list button { font-size: var(--type-control); }
.summary-card small,
.summary-card em,
.action-panel header span,
.row-copy small,
.row-time,
.simple-list span,
.simple-list strong,
.detail-hero span,
.detail-hero small,
.privacy-note,
.batch-items small,
.batch-items em { font-size: var(--type-meta); }
.action-panel h3 { font-size: var(--type-card); }
.action-panel header a,
.row-copy strong,
.batch-items strong { font-size: var(--type-control); }

/* 与同排事项卡共用尺寸、卡头和字号；首页只预览一条，完整队列在审核列表。 */
.target-review-entry { order: 99; align-self: stretch; }
.target-review-entry > header > div { min-width: 0; }
.target-review-link { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; white-space: nowrap; }
.target-review-link:hover { color: var(--color-primary-hover); }
.target-review-copy { display: flex; align-items: center; gap: 12px; margin: 0; padding: 16px 17px; color: var(--color-text-secondary); font-size: var(--type-meta); }
.target-review-copy p { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; line-height: 1.6; }
.target-review-copy button { flex: 0 0 auto; }
.review-task-list { display: grid; gap: 10px; padding: 10px 12px 12px; }
.review-task {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  color: var(--color-text);
  text-decoration: none;
  background: var(--color-canvas);
  transition: border-color var(--motion-fast), background var(--motion-fast);
}
.review-task:hover { border-color: var(--color-primary); background: var(--color-primary-soft); }
.review-task:focus-visible, .target-review-link:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; border-radius: 6px; }
.review-task-top { display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; gap: 9px; min-width: 0; }
.review-task-icon { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 7px; color: var(--color-primary); background: var(--color-primary-soft); }
.review-task-copy { display: grid; gap: 3px; min-width: 0; }
.review-task-copy strong, .review-task-copy small { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--type-meta); line-height: 1.45; }
.review-task-copy small { color: var(--color-text-secondary); }
.review-task-bottom { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; min-width: 0; padding-left: 33px; }
.review-task-status { flex: 0 0 auto; padding: 3px 7px; border-radius: 999px; color: var(--color-warning); background: var(--color-warning-soft); font-size: var(--type-meta); font-style: normal; line-height: 1.35; }
.review-task-action { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; margin-left: auto; color: var(--color-primary); font-size: var(--type-control); white-space: nowrap; }
.review-more-hint { margin: 0; color: var(--color-text-secondary); font-size: var(--type-meta); line-height: 1.45; }
@media(prefers-reduced-motion:reduce) { .review-task { transition: none; } }
</style>
