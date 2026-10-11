import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { prepareSupportContext } from '@/features/ai/supportHandoff'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useTaskRunStore } from '@/stores/taskRun'
import { showToast } from '@/utils'
import { confirmAction } from '@/shared/ui/confirm'
import { authService } from '@/utils/auth'
import { refreshLiveLaunch } from '@/features/automation/launch'
import { getRuntimeCapabilities } from '@/runtime/capabilities'
import type { FreightQuoteResult } from '@/shared/freight/types'
import type { RunnerPreflightResult } from '@/shared/ipc/automation-contract'
import { localArtifactReadResultSchema, type LocalArtifactDiagnosticSummary, type LocalArtifactKind, type LocalArtifactUnavailableCode } from '@/shared/ipc/artifact-contract'


export function useSingleAutomationRun() {
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}
const router = useRouter()
const appStore = useAppStore()
const taskRunStore = useTaskRunStore()
const currentRunId = computed(() => taskRunStore.runId || undefined)
const recoveryRetryAllowed = ref(false)
let recoveryRequest = 0
async function refreshRecoveryStatus() {
  const request = ++recoveryRequest
  recoveryRetryAllowed.value = false
  const runId = taskRunStore.runId
  if (!runId || !window.electronAPI?.recovery || !['failed', 'cancelled'].includes(runStatus.value)) return
  try {
    const records = await window.electronAPI.recovery.list({})
    if (request === recoveryRequest && taskRunStore.runId === runId) recoveryRetryAllowed.value = records.find(record => record.runId === runId)?.retryAllowed === true
  } catch { /* Unknown evidence is never permission to retry. */ }
}
 const {
   status: runStatus,
   currentStep,
   userAction,
   result: runResult,
 } = storeToRefs(taskRunStore)

 const browserLoading = ref(true)
const restarting = ref(false)
const endingRun = ref(false)
const taskStarted = ref(false)
const taskStarting = ref(false)
const browserRegistered = ref(false)
const browserPartition = ref('')
let browserPreparation = 0
const problemDetails = ref<HTMLDetailsElement | null>(null)
const preflightResult = ref<RunnerPreflightResult | null>(null)
type EvidenceReadState = 'idle' | 'loading' | 'ready' | 'missing' | 'error'
const evidenceOpen = ref(false)
const evidenceView = ref<LocalArtifactKind>('diagnostic')
const screenshotState = ref<EvidenceReadState>('idle')
const screenshotDataUrl = ref('')
const screenshotMessage = ref('本次运行没有可读取的截图。')
const diagnosticState = ref<EvidenceReadState>('idle')
const diagnosticMessage = ref('仅显示当前执行与同步摘要。')
const localDiagnostic = ref<LocalArtifactDiagnosticSummary | null>(null)
let evidenceRequestVersion = 0
const recordSyncing = ref(false)
const recordPending = computed(() => Boolean(runResult.value?.reportWarning))

 const toolName = computed(() => appStore.currentTool?.name || '自动化工具')
 const isPreflight = computed(() => appStore.currentTool?.executionMode === 'preflight')
 const isDemo = computed(() => appStore.currentTool?.executionMode === 'demo' || (!isPreflight.value && appStore.currentTool?.executionMode !== 'live'))
 const isDesktop = computed(() => getRuntimeCapabilities().singleLive)
const isBrowserPreview = computed(() => isDemo.value && !isDesktop.value)
const stageItems = computed(() => isPreflight.value ? [
  { key: 'prepare', label: '浏览器准备', description: '打开独立浏览器并校验目标页面' },
  { key: 'inspect', label: '页面扫描', description: '只读扫描页面结构并生成指纹' },
  { key: 'review', label: '脚本状态', description: '确认当前工具是否已有可执行脚本' },
  { key: 'complete', label: '预检完成', description: '脚本就绪后再允许开始执行' },
] : isBrowserPreview.value ? [
  { key: 'prepare', label: '预览准备', description: '载入演示步骤与示例数据' },
  { key: 'process', label: '流程展示', description: '展示工具执行流程，不操作外部页面' },
  { key: 'verify', label: '模拟反馈', description: '了解执行结果和人工介入位置' },
  { key: 'complete', label: '预览完成', description: '保存本次流程演示记录' },
] : isDemo.value ? [
  { key: 'prepare', label: '沙盒准备', description: '正在启动本地交互页面和执行器' },
  { key: 'process', label: '真实操作', description: '执行器正在模拟页面中填写和点击' },
  { key: 'verify', label: '结果核验', description: '核对模拟平台返回的成功状态' },
  { key: 'complete', label: '演示完成', description: '保存本次交互演示结果' },
] : [
  { key: 'prepare', label: '执行准备', description: '校验授权、适配器和本地浏览器' },
  { key: 'process', label: '自动处理', description: '在比赛模拟平台中执行已发布的业务步骤' },
  { key: 'verify', label: '结果核验', description: '读取平台状态并确认业务结果' },
  { key: 'complete', label: '处理完成', description: '保存记录、截图和扫描指纹' },
])
const platformName = computed(() => appStore.currentTool?.platformKey === 'aliexpress' ? '速卖通' : '亚马逊')
const platformShortName = computed(() => platformName.value === '速卖通' ? 'AliExpress' : 'amazon seller')
const freightQuote = computed(() => (runResult.value?.freightQuote || null) as FreightQuoteResult | null)
const adapterVersion = computed(() => String(runResult.value?.adapterVersion || appStore.currentTool?.launchGrant?.toolVersion || '1.0.0'))
const evidenceSummary = computed(() => ({
  fingerprint: String(runResult.value?.pageFingerprint || '').slice(0, 12),
  screenshot: (typeof runResult.value?.screenshot === 'string' && Boolean(runResult.value.screenshot.trim()))
    || taskRunStore.artifacts.some(artifact => artifact !== null && typeof artifact === 'object' && 'type' in artifact && artifact.type === 'screenshot'),
  signatureVerified: runResult.value?.signatureVerified === true,
}))
const hasArtifactReader = computed(() => isDesktop.value && typeof window.electronAPI?.artifacts?.read === 'function')
const canReadDiagnostic = computed(() => !isPreflight.value && hasArtifactReader.value && Boolean(taskRunStore.runId))
const canViewScreenshot = computed(() => canReadDiagnostic.value && evidenceSummary.value.screenshot)
const screenshotAvailabilityMessage = computed(() => {
  if (isPreflight.value) return '只读预检没有关联业务运行，不提供本机运行截图。'
  if (!evidenceSummary.value.screenshot) return '本次运行未提供截图；仍可查看诊断信息。'
  if (!taskRunStore.runId) return '截图缺少运行关联信息，当前无法安全读取。'
  if (!hasArtifactReader.value) return '当前客户端不支持安全读取本机截图；请在原设备使用支持此能力的桌面版本。'
  return '截图只在本机查看，不自动上传。'
})
const isActiveRun = computed(() => !isPreflight.value && ['idle', 'preparing', 'running', 'waiting_user', 'paused'].includes(runStatus.value))
const isTerminal = computed(() => ['completed', 'failed', 'cancelled'].includes(runStatus.value))
const needsPlatformReview = computed(() => !isDemo.value && !isPreflight.value && ['failed', 'cancelled'].includes(runStatus.value) && !recoveryRetryAllowed.value)
 const isBrowserRetryableError = computed(() => false)
 const interactionLocked = computed(() => ['preparing', 'running', 'paused'].includes(runStatus.value))
const displayUrl = computed(() => isPreflight.value
   ? (preflightResult.value?.targetUrl || appStore.currentTool?.targetUrl || '浏览器预检 · 只读扫描')
   : isBrowserPreview.value
   ? '浏览器流程预览 · 不执行平台操作'
   : isDemo.value
   ? '本地交互沙盒 · 不访问外部平台'
   : taskRunStore.browserUrl || appStore.currentTool?.targetUrl || '比赛模拟平台')

const currentStageIndex = computed(() => {
  if (runStatus.value === 'completed') return 3
  const stepId = currentStep.value?.id
  if (stepId === 'execute') return 1
  if (stepId && ['verify', 'summary'].includes(stepId)) return 2
  return 0
})

 const runningMessage = computed(() => {
   if (isPreflight.value) return preflightResult.value?.canStart ? '页面扫描完成，可开始执行' : '脚本开发中，仅允许页面预览'
   if (isBrowserPreview.value) return '正在播放流程预览'
   if (runStatus.value === 'preparing' || runStatus.value === 'idle') return isDemo.value ? '正在准备交互沙盒' : '正在准备本地执行器'
   if (runStatus.value === 'paused') return isDemo.value ? '交互演示已暂停' : '自动处理已暂停'
   if (currentStageIndex.value === 2) return '正在核验页面结果'
   return isDemo.value ? '正在操作本地模拟页面' : '自动处理进行中'
 })
 const customerStatusText = computed(() => {
   if (isPreflight.value) return preflightResult.value?.canStart ? '脚本已就绪' : '脚本开发中'
   if (isBrowserPreview.value) {
     const preview: Record<string, string> = { idle: '预览准备中', preparing: '预览准备中', running: '流程预览中', waiting_user: '人工介入示例', paused: '预览已暂停', completed: '预览完成', failed: '预览异常', cancelled: '已退出演示' }
     return preview[runStatus.value] || '预览中'
   }
   const demo: Record<string, string> = { idle: '沙盒准备中', preparing: '沙盒准备中', running: '交互演示中', waiting_user: '需要手动操作', paused: '演示已暂停', completed: '演示完成', failed: '演示异常', cancelled: '已退出演示' }
   const live: Record<string, string> = { idle: '等待执行', preparing: '执行准备中', running: '自动处理中', waiting_user: '需要你操作', paused: '已暂停', completed: '执行成功', failed: '执行失败', cancelled: '已停止' }
   return (isDemo.value ? demo : live)[runStatus.value] || '处理中'
 })
const problemCode = computed(() => {
  const source = taskRunStore.runId || taskRunStore.error?.code || 'UNKNOWN'
  return String(source).replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase() || 'UNKNOWN'
})
const preflightMessage = computed(() => preflightResult.value?.blockedMessage || '当前工具尚未发布可执行脚本，只能查看页面并生成扫描报告。')
 const failureTitle = computed(() => isDemo.value ? '交互演示异常' : '执行已停止，请核对结果')
 const failureDescription = computed(() => {
   const stepId = currentStep.value?.id
   if (!isDemo.value) {
     if (stepId === 'prepare') return '执行准备未完成。请先查看问题详情，核对授权和本机运行环境。'
     if (stepId === 'open') return '平台页面未能正常载入。请先核对平台状态、网络和问题详情。'
     if (stepId === 'inspect') return '平台页面暂不符合执行条件，请核对登录状态或联系支持。'
     if (stepId === 'verify' || stepId === 'summary') return '本次结果未能确认。请先核对平台现场，避免重复处理。'
     return '自动处理已停止。请先核对平台现场和问题详情，无法确认时联系支持，避免重复处理。'
   }
   if (stepId === 'prepare') return '模拟场景在准备阶段停止，可重新加载演示。'
   if (stepId === 'open') return '模拟页面没有正常载入，演示已安全停止。'
   if (stepId === 'inspect') return '模拟页面检查未完成，演示已安全停止。'
   if (stepId === 'verify' || stepId === 'summary') return '结果说明未能完整展示，可重新加载演示。'
   if (isDemo.value) return '本地交互沙盒已停止，不影响任何外部平台数据。'
   return taskRunStore.error?.message || '执行器已安全停止，可查看问题详情后重新发起。'
 })
const technicalError = computed(() => {
  const code = taskRunStore.error?.code || 'AUTOMATION_FAILED'
  const message = taskRunStore.error?.message || '未提供更多信息'
  return `${code} · ${message}`
})

function safeDiagnosticCode(value: unknown): string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value) ? value : '未提供'
}
const diagnosticRows = computed(() => [
  { label: '执行方式', value: isPreflight.value ? '浏览器只读预检，不执行业务动作' : isBrowserPreview.value ? '浏览器流程预览，不操作外部平台' : isDemo.value ? '本地交互沙盒' : '真实平台执行' },
  { label: '执行状态', value: customerStatusText.value },
  { label: '当前阶段', value: stageItems.value[currentStageIndex.value]?.label || '未提供' },
  { label: '问题编号', value: problemCode.value },
  { label: '错误码', value: safeDiagnosticCode(taskRunStore.error?.code || preflightResult.value?.blockedCode) },
  { label: '业务结果', value: needsPlatformReview.value ? '待核对同一平台业务对象；停止不等于未生效' : isPreflight.value ? '未执行任何业务动作' : isDemo.value ? '仅代表本地演示或预览，不代表平台结果' : runStatus.value === 'completed' ? '工具返回已完成；截图读取和同步不会改变结果' : '尚未形成最终结果' },
  { label: '记录同步', value: isPreflight.value ? '只读预检，不生成业务执行记录' : recordSyncing.value ? '正在同步记录，执行结果不变' : recordPending.value ? '记录待同步，无需重新执行任务' : isTerminal.value ? '当前未提示待同步；云端记录请到工具记录核对' : '执行尚未结束' },
])
const localDiagnosticRows = computed(() => {
  const summary = localDiagnostic.value
  if (!summary) return []
  const statuses: Record<string, string> = { running: '执行中', paused: '已暂停', waiting_user: '需要操作', completed: '已完成', failed: '执行未完成', cancelled: '已停止' }
  const rows = [{ label: '本机事件状态', value: statuses[summary.runStatus] || '未提供' }]
  if (summary.errorCode) rows.push({ label: '本机错误码', value: summary.errorCode })
  if (summary.recordPending !== undefined) rows.push({ label: '本机记录回执', value: summary.recordPending ? '待同步，不代表工具失败' : '未提示待同步' })
  if (summary.pageFingerprint) rows.push({ label: '页面指纹', value: `${summary.pageFingerprint.slice(0, 12)}（不是截图）` })
  if (summary.pageChanged !== undefined) rows.push({ label: '页面变化', value: summary.pageChanged ? '检测到结构变化' : '未检测到结构变化；不是业务成功判断' })
  if (summary.pageScan) rows.push({ label: '页面扫描统计', value: `控件 ${summary.pageScan.controlCount} · 表单 ${summary.pageScan.formCount} · 标题 ${summary.pageScan.headingCount}` })
  if (summary.network) rows.push({ label: '网络事件统计', value: `记录 ${summary.network.recordCount} · 响应 ${summary.network.responseCount} · 失败 ${summary.network.failureCount} · 丢弃 ${summary.network.dropped}（不代表业务结果）` })
  return rows
})

function artifactUnavailableMessage(kind: LocalArtifactKind, code: LocalArtifactUnavailableCode): string {
  const name = kind === 'screenshot' ? '截图' : '诊断文件'
  const messages: Record<LocalArtifactUnavailableCode, string> = {
    NOT_AVAILABLE: `当前运行没有可用的本机${name}。`,
    NO_EVIDENCE: `本次运行未登记可读取的${name}，不会生成替代证据。`,
    FORBIDDEN_PATH: `该${name}不符合本机证据读取范围，已阻止读取。`,
    MISSING: `本机${name}不存在或已被清理，当前执行结果不变。`,
    TOO_LARGE: `本机${name}超过安全读取大小，当前无法查看。`,
    INVALID_CONTENT: `本机${name}内容未通过校验，当前无法查看。`,
    READ_FAILED: `本机${name}暂时读取失败，可以重试读取；不会重新执行工具。`,
    SESSION_CHANGED: `授权或当前任务已变化，旧${name}不能继续读取。`,
  }
  return messages[code]
}

function clearEvidence(): void {
  evidenceRequestVersion += 1
  screenshotDataUrl.value = ''
  screenshotState.value = 'idle'
  diagnosticState.value = 'idle'
  localDiagnostic.value = null
}
function closeEvidence(): void {
  evidenceOpen.value = false
  clearEvidence()
}
function evidenceIdentity(): string {
  const user = authService.getUser()
  return JSON.stringify([user?.user_id ?? user?.id ?? '', user?.staff_id ?? '', user?.auth_code_id ?? '', user?.role ?? authService.getRole()].map(value => String(value)))
}
let lastEvidenceIdentity = evidenceIdentity()
function handleEvidenceUserUpdate(): void {
  const identity = evidenceIdentity()
  if (identity !== lastEvidenceIdentity) closeEvidence()
  lastEvidenceIdentity = identity
}
async function readRunEvidence(kind: LocalArtifactKind): Promise<void> {
  const requestVersion = ++evidenceRequestVersion
  const runId = taskRunStore.runId
  const reader = window.electronAPI?.artifacts
  if (kind === 'screenshot') {
    screenshotDataUrl.value = ''
    screenshotState.value = 'loading'
  } else {
    localDiagnostic.value = null
    diagnosticState.value = 'loading'
  }
  if (isPreflight.value || !runId || !hasArtifactReader.value || !reader) {
    if (kind === 'screenshot') {
      screenshotState.value = 'missing'
      screenshotMessage.value = screenshotAvailabilityMessage.value
    } else {
      diagnosticState.value = 'missing'
      diagnosticMessage.value = isPreflight.value ? '只读预检没有运行编号，目前只显示预检状态，不提供可读取的运行诊断文件。' : !runId ? '尚无运行编号，仅显示当前执行与同步摘要。' : '当前客户端没有安全读取本机诊断文件的能力；以下状态摘要仍可查看。'
    }
    return
  }
  try {
    const result = await reader.read({ runId, kind })
    if (requestVersion !== evidenceRequestVersion || !evidenceOpen.value || taskRunStore.runId !== runId) return
    const parsed = localArtifactReadResultSchema.safeParse(result)
    if (!parsed.success || parsed.data.kind !== kind) throw new Error('INVALID_ARTIFACT_RESPONSE')
    const artifact = parsed.data
    if (artifact.status === 'unavailable') {
      const state = ['NOT_AVAILABLE', 'NO_EVIDENCE', 'MISSING', 'SESSION_CHANGED'].includes(artifact.code) ? 'missing' : 'error'
      if (kind === 'screenshot') {
        screenshotState.value = state
        screenshotMessage.value = artifactUnavailableMessage(kind, artifact.code)
      } else {
        diagnosticState.value = state
        diagnosticMessage.value = `${artifactUnavailableMessage(kind, artifact.code)} 当前执行与同步摘要仍可查看。`
      }
    } else if (artifact.kind === 'screenshot') {
      screenshotDataUrl.value = artifact.dataUrl
      screenshotState.value = 'ready'
    } else {
      localDiagnostic.value = artifact.summary
      diagnosticState.value = 'ready'
    }
  } catch {
    if (requestVersion !== evidenceRequestVersion || !evidenceOpen.value || taskRunStore.runId !== runId) return
    if (kind === 'screenshot') {
      screenshotState.value = 'error'
      screenshotMessage.value = '本机截图暂时读取失败或内容无效，可重试读取；不会重新执行工具。'
    } else {
      diagnosticState.value = 'error'
      diagnosticMessage.value = '本机诊断暂时读取失败或内容无效，当前执行与同步摘要仍可查看。重试读取不会重新执行工具。'
    }
  }
}
async function showRunEvidence(kind: LocalArtifactKind = 'diagnostic'): Promise<void> {
  if (kind === 'screenshot' && !canViewScreenshot.value) return
  lastEvidenceIdentity = evidenceIdentity()
  evidenceView.value = kind
  evidenceOpen.value = true
  await readRunEvidence(kind)
}
function screenshotImageFailed(): void {
  screenshotDataUrl.value = ''
  screenshotState.value = 'error'
  screenshotMessage.value = '截图图片无法显示，可能已损坏；可重新读取，不会重新执行工具。'
}
watch(evidenceOpen, value => { if (!value) clearEvidence() })
watch(() => [taskRunStore.runId, appStore.currentTool?.id], closeEvidence)

function showProblemDetails() {
  if (!problemDetails.value) return
  problemDetails.value.open = true
  problemDetails.value.querySelector('summary')?.focus()
}

function stageState(index: number) {
  if (runStatus.value === 'completed') return 'done'
  if (index < currentStageIndex.value) return 'done'
  if (index === currentStageIndex.value) return 'active'
  return 'pending'
}

async function completeUserAction() {
  try {
    await taskRunStore.completeUserAction()
  } catch {
    showToast('暂时无法继续，请重试', 'error')
  }
}

async function stopRun() {
  if (endingRun.value) return
  endingRun.value = true
  try {
    if (!await confirmAction({
      title: '停止本次处理？',
      message: isDemo.value ? '停止后可以返回工具箱重新发起演示。' : '停止不会撤回已提交的平台操作。停止后请先核对平台状态，确认结果后再决定是否发起新任务。',
      confirmText: '停止处理',
      cancelText: '继续运行',
      danger: true,
    })) return
    await taskRunStore.cancel()
  } catch {
    showToast('暂时无法停止，当前现场已保留，请重试', 'error')
  } finally {
    endingRun.value = false
  }
}

async function closeWorkspace() {
  if (endingRun.value) return
  endingRun.value = true
  try {
    if (isActiveRun.value && !await confirmAction({
      title: isDemo.value ? '退出交互演示？' : '停止当前自动处理？',
      message: isBrowserPreview.value ? '当前流程预览尚未完成，退出后会停止播放。' : isDemo.value ? '当前演示尚未完成，退出后本地沙盒会停止。' : '退出会停止本次处理，但不会撤回已提交的平台操作。请先核对平台状态，无法确认时联系支持。',
      confirmText: isDemo.value ? '退出演示' : '停止处理',
      cancelText: '留在这里',
      danger: true,
    })) return
    if (isActiveRun.value) await taskRunStore.cancel()
    if (isPreflight.value) await cancelPreflight()
    taskRunStore.reset()
    appStore.closeTool()
  } catch {
    showToast('暂时无法退出，当前现场已保留，请重试', 'error')
  } finally {
    endingRun.value = false
  }
}

async function restartRun() {
  if (restarting.value || endingRun.value) return
  restarting.value = true
  try {
    const currentTool = appStore.currentTool
    if (!currentTool?.id) throw new Error('当前工具信息不完整')
    if (!['live', 'preflight'].includes(currentTool.executionMode || '')) throw new Error('旧演示入口已停用，请返回工具箱选择真实工具')
    if (currentTool.executionMode === 'preflight') {
      preflightResult.value = null
      taskStarted.value = false
      await startDemoTask()
      return
    }
    if (currentTool.executionMode === 'live') {
      await refreshRecoveryStatus()
      if (!recoveryRetryAllowed.value) throw new Error('没有确定可重试的本机证据；请先核对平台并记录结论。已完成输入不能重复执行。')
    }
    const nextTool = await refreshLiveLaunch(currentTool)
    appStore.currentTool = nextTool
    await taskRunStore.start(nextTool, { mode: 'live' })
  } catch (error) {
    showToast(errorMessage(error, '暂时无法重新执行'), 'error')
  } finally {
    restarting.value = false
  }
}

async function startReadyScript() {
  if (!isPreflight.value || !preflightResult.value?.canStart || restarting.value) return
  const currentTool = appStore.currentTool
  if (!currentTool?.id) return
  restarting.value = true
  try {
    await cancelPreflight()
    const nextTool = await refreshLiveLaunch(currentTool)
    appStore.currentTool = nextTool
    preflightResult.value = null
    await taskRunStore.start(nextTool, { mode: 'live' })
  } catch (error) {
    showToast(errorMessage(error, '暂时无法开始执行，请重新预检'), 'error')
  } finally {
    restarting.value = false
  }
}

async function cancelPreflight(): Promise<void> {
  if (!isPreflight.value) return
  try { await window.electronAPI?.automation?.cancel() } catch { /* release is best effort during teardown */ }
}

async function openSupport() {
  prepareSupportContext({
    tool_name: toolName.value,
    problem_code: problemCode.value,
    run_status: runStatus.value,
    execution_mode: appStore.currentTool?.executionMode,
    result_requires_review: needsPlatformReview.value,
    record_pending: recordPending.value,
  }, appStore.currentTool?.platformKey || 'amazon')
  await closeWorkspace()
  if (!appStore.toolVisible) router.push('/user/ai-chat')
}

 async function startDemoTask() {
   if (taskStarted.value || taskStarting.value) return
   taskStarting.value = true
   taskStarted.value = true
   try {
    const currentTool = appStore.currentTool
    if (!['live', 'preflight'].includes(currentTool?.executionMode || '')) throw new Error('旧演示入口已停用，请返回工具箱选择真实工具')
    if (currentTool?.executionMode === 'preflight') {
      const api = window.electronAPI?.automation
      if (!api?.preflight) throw new Error('当前桌面端不支持浏览器预检，请更新课赛通')
      taskStarted.value = true
      preflightResult.value = await api.preflight(JSON.parse(JSON.stringify(currentTool)))
      return
    }
     const nextTool = currentTool!
     appStore.currentTool = nextTool
     await taskRunStore.start(nextTool, { mode: 'live' })
    } catch {
      // A failed preflight must be retryable without remounting the workspace.
      // Keep the normal task-start guard for an already-running demo/live run.
      if (appStore.currentTool?.executionMode === 'preflight') taskStarted.value = false
      showToast(isDemo.value ? '旧演示入口已停用，请返回工具箱选择真实工具' : '自动处理启动失败，请检查授权和运行环境或联系支持', 'error')
   } finally {
     taskStarting.value = false
     browserLoading.value = false
   }
 }

 async function registerWorkspaceBrowser(event: Event): Promise<void> {
   if (browserRegistered.value) return
   const webview = event.currentTarget as HTMLElement & { getWebContentsId?: () => number }
   const webContentsId = webview.getWebContentsId?.()
   if (typeof webContentsId !== 'number') {
     browserLoading.value = false
     showToast('应用内浏览器尚未就绪，请重新打开工具', 'error')
     return
   }
   try {
     await window.electronAPI?.automation?.registerBrowser(webContentsId)
     browserRegistered.value = true
     await startDemoTask()
   } catch (error) {
     browserLoading.value = false
     showToast(errorMessage(error, '应用内浏览器启动失败'), 'error')
   }
 }

async function prepareWorkspaceBrowser() {
  const request = ++browserPreparation
  try {
    const automation = window.electronAPI?.automation
    if (!automation?.prepareBrowser) throw new Error('当前桌面版本不支持账号隔离，请更新后重新打开工具')
    const result = await automation.prepareBrowser(appStore.currentTool?.platformKey === 'aliexpress' ? 'aliexpress' : 'amazon')
    if (request === browserPreparation) browserPartition.value = result.partition
  } catch (error) {
    if (request !== browserPreparation) return
    browserLoading.value = false
    showToast(errorMessage(error, '独立浏览器准备失败，请重新打开工具'), 'error')
  }
}

onMounted(() => {
  window.addEventListener('toolbox:recovery-updated', refreshRecoveryStatus)
  window.addEventListener('toolbox:auth-cleared', closeEvidence)
  window.addEventListener('toolbox:user-updated', handleEvidenceUserUpdate)
  // Desktop runs wait for the WebView's dom-ready event so preflight uses the
  // same embedded host instead of opening a second Playwright window.
  if (!isDesktop.value) void startDemoTask()
  else if (!isDemo.value) void prepareWorkspaceBrowser()
})

watch(runStatus, status => {
  if (status === 'failed' || status === 'cancelled' || status === 'completed') {
    browserLoading.value = false
    void refreshRecoveryStatus()
  }
}, { immediate: true })

onUnmounted(() => {
  browserPreparation += 1
  recoveryRequest += 1
  window.removeEventListener('toolbox:recovery-updated', refreshRecoveryStatus)
  closeEvidence()
  window.removeEventListener('toolbox:auth-cleared', closeEvidence)
  window.removeEventListener('toolbox:user-updated', handleEvidenceUserUpdate)
  void cancelPreflight()
  if (browserRegistered.value) void window.electronAPI?.automation?.unregisterBrowser()
  taskRunStore.reset()
})
  return {
    currentRunId, recoveryRetryAllowed, browserPartition,
    browserLoading, restarting, endingRun, stageItems, toolName, isDemo, isPreflight, isDesktop, isBrowserPreview,
    preflightResult, preflightMessage,
    platformName, platformShortName, isActiveRun, isTerminal, needsPlatformReview, interactionLocked, displayUrl,
    freightQuote, adapterVersion, evidenceSummary, recordPending, recordSyncing,
    evidenceOpen, evidenceView, diagnosticRows, localDiagnosticRows, diagnosticState, diagnosticMessage,
    screenshotState, screenshotDataUrl, screenshotMessage, canReadDiagnostic, canViewScreenshot, screenshotAvailabilityMessage,
    showRunEvidence, readRunEvidence, screenshotImageFailed,
    currentStageIndex, runningMessage, customerStatusText, problemCode, runStatus, userAction,
    isBrowserRetryableError, failureTitle, failureDescription, technicalError, problemDetails, showProblemDetails,
    stageState, completeUserAction, stopRun, closeWorkspace, restartRun, startReadyScript, openSupport, registerWorkspaceBrowser,
  }
}
