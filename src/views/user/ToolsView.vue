<template>
  <div class="toolbox-page" data-testid="tools-page">
    <PageHeader
      eyebrow="课赛通工具箱"
      title="先选要完成的任务"
      description="从注册公司、选品到商品、物流、营销与发货，按任务找到工具；授权、平台现场和桌面端能力会在开始前逐项核对。"
    >
      <template #actions>
        <router-link class="plan-chip" to="/user/plans">
          <ShieldCheck :size="15" />
          {{ currentPlanName }}
        </router-link>
      </template>
    </PageHeader>
    <AsyncStateNotice v-if="staleError" state="stale" :message="staleError" @retry="loadData" />

    <TargetWorkspace :tool-id="targetToolId" :open-request="targetWorkspaceRequest" :has-open-tools="targetWorkspaceAvailable" />

    <section class="directory-intro" data-testid="directory-intro" aria-labelledby="directory-title">
      <div>
        <span class="directory-kicker">工具目录</span>
        <h2 id="directory-title">按任务找工具</h2>
        <p>先按任务筛选，再查看当前授权、平台和运行环境是否满足。</p>
      </div>
      <span class="directory-count">{{ filteredTools.length }} 项匹配</span>
    </section>
    <section class="directory-filters" aria-label="工具查找">
      <label class="search-box"><Search :size="17" /><input v-model.trim="searchQuery" type="search" aria-label="搜索任务或工具" placeholder="搜索任务、工具或能力" /></label>
      <label class="available-filter"><input v-model="onlyUsable" type="checkbox" />当前可用</label>
      <button type="button" :aria-pressed="selectedTask === 'all'" @click="selectedTask = 'all'">全部任务</button>
      <button v-if="otherToolCount" type="button" :aria-pressed="selectedTask === 'other'" @click="selectedTask = 'other'">其他工具 {{ otherToolCount }}</button>
    </section>
    <div class="task-groups" aria-label="按任务选择工具">
      <section v-for="group in PRODUCT_TASK_GROUPS" :key="group.id" class="task-group">
        <div class="task-group-heading"><div><h3>{{ group.title }}</h3><p>{{ group.description }}</p></div><span class="task-group-count">{{ PRODUCT_TASKS.filter(item => item.group === group.id).length }} 个任务</span></div>
        <div class="task-grid">
          <button v-for="task in PRODUCT_TASKS.filter(item => item.group === group.id)" :key="task.id" type="button" :data-task-id="task.id" :aria-pressed="selectedTask === task.id" @click="selectedTask = task.id">
            <strong>{{ task.title }}</strong><span>{{ task.preparation }}</span>
            <small>{{ loading ? '正在核对工具' : loadError ? '工具目录待重试' : toolCountForTask(task.id) ? `${toolCountForTask(task.id)} 项目录能力 · 开放状态见下方` : '尚无开放工具 · 可先准备资料' }}</small>
            <span class="task-action" aria-hidden="true">查看工具 <ArrowRight :size="14" /></span>
          </button>
        </div>
      </section>
    </div>
    <p class="directory-summary" role="status">{{ selectedTaskTitle }} · {{ filteredTools.length }} 项匹配工具<span v-if="onlyUsable"> · 已核对套餐、发布状态与本机能力</span></p>
    <section v-if="!loading && !loadError && firstReadyTool" class="ready-next-step" aria-label="开始使用">
      <div><strong>先准备「{{ firstReadyTool.name }}」</strong><p>当前授权与本机支持使用。先查看输入资料和使用条件，确认后再启动。</p></div>
      <button type="button" @click="openDetails(firstReadyTool)">查看准备项 <ArrowRight :size="16" /></button>
    </section>

    <div v-if="loading" class="tool-grid" aria-label="工具加载中">
      <div v-for="item in 6" :key="item" class="tool-card skeleton-card"></div>
    </div>

    <div v-else-if="loadError" class="empty-state error-state" role="alert">
      <CircleAlert :size="44" :stroke-width="1.5" />
      <h3>工具列表暂时无法加载</h3>
      <p>{{ loadError }}</p>
      <button type="button" @click="loadData">重新加载</button>
      <button type="button" @click="openSupport('catalog-load')">联系支持核对</button>
    </div>

    <div v-else-if="filteredTools.length" class="tool-grid">
      <button
        v-for="tool in filteredTools"
        :key="tool.id"
        type="button"
        :class="['tool-card', `is-${toolState(tool)}`, { 'is-launching': launchingToolId === tool.id, 'is-focused': route.query?.tool === tool.id }]"
        :disabled="launchingToolId !== null || (!hasToolDetails(tool) && toolExecutionUnavailable(tool))"
        :aria-label="`${tool.name}，${hasToolDetails(tool) ? '查看工具说明，' : ''}${toolActionText(tool)}`"
        :data-testid="'tool-card-' + tool.name"
        @click="hasToolDetails(tool) ? openDetails(tool) : handleToolClick(tool)"
      >
        <span v-if="launchingToolId === tool.id" class="launch-rail" aria-hidden="true"></span>
        <span class="tool-card-top">
          <span class="tool-icon"><component :is="toolIcon(tool)" :size="21" /></span>
          <span v-if="toolState(tool) === 'platform-locked'" class="state-badge locked"><LockKeyhole :size="12" /> 当前平台未授权</span>
          <span v-else-if="toolState(tool) === 'locked'" class="state-badge locked"><LockKeyhole :size="12" /> 当前套餐未包含</span>
          <span v-else-if="toolState(tool) === 'maintenance'" class="state-badge maintenance">暂时不可用</span>
          <span v-else class="state-badge live">{{ getToolPresentation(tool).label }}</span>
        </span>

        <span class="tool-copy">
          <strong>{{ tool.name }}</strong>
          <span>{{ tool.description || defaultDescription(tool) }}</span>
          <span v-if="toolCapabilities(tool).length" class="capability-tags" aria-label="工具能力">
            <span v-for="tag in toolCapabilities(tool)" :key="tag">{{ tag }}</span>
          </span>
          <span class="tool-operational-meta">
            <span><small>目标平台</small><b>{{ toolPlatformLabel(tool) }}</b></span>
            <span><small>需要准备</small><b>{{ toolInputLabel(tool) }}</b></span>
            <span><small>执行方式</small><b>{{ getToolPresentation(tool).operationLabel }}</b></span>
          </span>
        </span>

        <span class="tool-action">
          <span
            v-if="hasToolDetails(tool)"
            class="learn-more"
          >查看能力与准备</span>
          <span class="action-label">
          <template v-if="launchingToolId === tool.id">
            <LoaderCircle :size="16" class="spin" /> 正在打开…
          </template>
          <template v-else>
            {{ cardActionText(tool) }} <ArrowRight :size="16" />
          </template>
          </span>
        </span>
      </button>
    </div>

    <div v-else class="empty-state">
      <Wrench :size="44" :stroke-width="1.5" />
      <h3>{{ tools.length ? '没有符合条件的工具' : '当前平台尚无开放工具' }}</h3>
      <p>{{ tools.length ? onlyUsable ? '当前可用同时要求套餐包含、平台授权、工具已开放和本机支持；可取消筛选查看使用条件。' : '请调整任务或搜索词，也可查看使用条件。不会以模拟流程替代真实功能。' : '当前平台目录尚未向此账号开放工具。可先核对授权范围、准备资料或联系支持；升级套餐不代表工具自动开放。' }}</p>
      <div class="empty-actions"><button v-if="tools.length" type="button" @click="clearDirectoryFilters">清除筛选</button><router-link to="/user/plans">核对授权信息</router-link><button type="button" @click="openSupport('tool-availability')">联系支持核对</button></div>
    </div>

    <el-drawer v-model="detailsVisible" direction="rtl" size="min(420px, 92vw)" class="tool-detail-drawer">
      <template #header>
        <div class="drawer-heading">
          <span class="drawer-icon"><component :is="detailsTool ? toolIcon(detailsTool) : Boxes" :size="20" /></span>
          <div><small>工具能力</small><strong>{{ detailsTool?.name }}</strong></div>
        </div>
      </template>
      <div v-if="detailsTool" class="drawer-content">
        <p class="drawer-description">{{ detailsTool.description || defaultDescription(detailsTool) }}</p>
        <p v-if="toolState(detailsTool) === 'platform-locked'" class="drawer-authorization-note">当前授权未包含{{ toolPlatformLabel(detailsTool) }}，请联系授权提供方核对平台范围。更换套餐并不代表已获此平台授权。</p>
        <p v-else-if="toolState(detailsTool) === 'locked'" class="drawer-authorization-note">当前套餐未包含此工具，可查看可用套餐；平台范围和工具开放状态仍需分别核对。</p>
        <section v-if="toolCapabilities(detailsTool).length">
          <span class="section-label">可以帮你完成</span>
          <div class="drawer-tags"><span v-for="tag in toolCapabilities(detailsTool)" :key="tag"><CheckCircle2 :size="14" />{{ tag }}</span></div>
        </section>
        <section v-if="normalizedList(detailsTool.preparation_notes).length">
          <span class="section-label">开始前准备</span>
          <ul><li v-for="note in normalizedList(detailsTool.preparation_notes)" :key="note">{{ note }}</li></ul>
        </section>
        <section v-if="normalizedList(detailsTool.intervention_scenarios).length">
          <span class="section-label">什么时候需要你操作</span>
          <ul><li v-for="scenario in normalizedList(detailsTool.intervention_scenarios)" :key="scenario">{{ scenario }}</li></ul>
        </section>
        <div class="drawer-assurance"><ShieldCheck :size="17" /><span>{{ getToolPresentation(detailsTool).description }}{{ liveUnavailable(detailsTool) ? ' 需要下载桌面端，本网页不会启动外部平台操作。' : '' }}</span></div>
      </div>
      <template #footer>
        <button class="drawer-primary" :disabled="!detailsTool || launchingToolId !== null || toolExecutionUnavailable(detailsTool)" @click="launchFromDetails">
          {{ detailsActionText }} <ArrowRight :size="16" />
        </button>
      </template>
    </el-drawer>

    <el-dialog v-model="runDialogVisible" width="min(560px, 94vw)" :close-on-click-modal="!launchingToolId" destroy-on-close>
      <template #header>
        <div class="run-dialog-heading"><small>LIVE AUTOMATION</small><h3>{{ pendingTool?.name }}</h3><p>参数只会发送给本机执行器。</p></div>
      </template>
      <p v-if="pendingTool" class="platform-account-confirmation" role="note" data-testid="platform-account-confirmation">请核对当前平台账号；KST 未自动核验平台身份。开始前请确认目标平台登录的是本次要操作的账号。</p>
      <el-form v-if="pendingTool" label-position="top" class="run-form">
        <el-form-item v-for="field in pendingTool.single_input_schema || []" :key="field.key" :label="field.label" :required="field.required">
          <el-input-number v-if="field.type === 'number'" :model-value="numberInput(field.key)" :controls="false" @update:model-value="value => setNumberInput(field.key, value)" />
          <el-select v-else-if="field.type === 'select'" v-model="runInput[field.key]" placeholder="请选择"><el-option v-for="option in field.options || []" :key="option" :label="option" :value="option" /></el-select>
          <div v-else-if="field.type === 'file'" class="file-input" :data-testid="`file-input-${field.key}`">
            <span class="file-name">{{ selectedFileNames[field.key] || '尚未选择文件' }}</span>
            <div class="file-actions">
              <button type="button" :disabled="Boolean(selectingFile) || Boolean(launchingToolId) || !canSelectFile" @click="selectInputFile(field.key, field.label)">{{ selectingFile === field.key ? '正在选择…' : selectedFileNames[field.key] ? '更换文件' : '选择文件' }}</button>
              <button v-if="selectedFileNames[field.key]" type="button" :disabled="Boolean(launchingToolId)" @click="clearInputFile(field.key)">清除</button>
            </div>
            <small>{{ canSelectFile ? '文件仅在本机使用，不上传文件内容或完整路径。' : '请使用支持文件选择的 Windows 客户端。' }}</small>
            <p v-if="fileInputErrors[field.key]" class="file-error" role="alert">{{ fileInputErrors[field.key] }}</p>
          </div>
          <el-input v-else v-model="runInput[field.key]" :placeholder="`请输入${field.label}`" />
        </el-form-item>
      </el-form>
      <template #footer><div class="run-dialog-actions"><el-button :disabled="Boolean(launchingToolId)" @click="runDialogVisible=false">取消</el-button><el-button type="primary" :disabled="Boolean(selectingFile)" :loading="Boolean(launchingToolId)" @click="confirmRun">启动自动处理</el-button></div></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import AsyncStateNotice from '@/components/AsyncStateNotice.vue'
import PageHeader from '@/components/PageHeader.vue'
import TargetWorkspace from '@/features/targets/TargetWorkspace.vue'
import { requiresTargetProfile, supportsTargetWorkspace } from '@/features/targets/presentation'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import {
  ArrowRight,
  BadgeDollarSign,
  Boxes,
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  LockKeyhole,
  Megaphone,
  PackageCheck,
  PackagePlus,
  Search,
  ShieldCheck,
  Truck,
  UserPlus,
  Warehouse,
  Wrench,
  Zap,
} from '@lucide/vue'
import { getTools } from '@/utils/api'
import { showToast } from '@/utils'
import { useAppStore } from '@/stores/app'
import { usePlatformStore } from '@/stores/platform'
import { licenseAllowedCapabilities, licensePlanCode, readStoredLicense } from '@/features/user/model'
import {
  errorMessage,
  toolCatalogItemSchema,
  toolCatalogSchema,
  type ToolCatalogItem,
} from '@/features/tools/model'
import { buildLiveLaunch, buildPreflightLaunch, isLiveTool } from '@/features/automation/launch'
import { getRuntimeCapabilities } from '@/runtime/capabilities'
import { downloadDesktopInstaller } from '@/runtime/desktop-download'
import { validateSingleToolInput } from '@/features/automation/input-validation'
import { PRODUCT_TASKS, PRODUCT_TASK_GROUPS, getToolTaskIds, getToolPresentation, isCustomerTool, isToolCurrentlyUsable, isToolIncluded, isToolInPlatformScope, isToolPublished, type ProductTaskId } from '@/features/tools/presentation'

const router = useRouter() || { push: () => {} }
const route = useRoute() || { query: {} as LocationQuery }
const appStore = useAppStore()
const platformStore = usePlatformStore()
const tools = ref<ToolCatalogItem[]>([])
const loading = ref(true)
const loadError = ref('')
const staleError = ref('')
const launchingToolId = ref<string | number | null>(null)
const detailsVisible = ref(false)
const detailsTool = ref<ToolCatalogItem | null>(null)
const runDialogVisible = ref(false)
const pendingTool = ref<ToolCatalogItem | null>(null)
const targetToolId = ref<string | number>()
const targetWorkspaceRequest = ref(0)
const runInput = ref<Record<string, string | number | undefined>>({})
const selectedFileNames = ref<Record<string, string>>({})
const fileInputErrors = ref<Record<string, string>>({})
const selectingFile = ref('')
const canSelectFile = computed(() => typeof window.electronAPI?.files?.select === 'function')
const runtime = getRuntimeCapabilities()
const profileVersion = ref(0)
const refreshProfile = () => { profileVersion.value += 1 }
const searchQuery = ref('')
const onlyUsable = ref(false)
type TaskFilter = ProductTaskId | 'all' | 'other'
function taskFilter(value: unknown): TaskFilter {
  return value === 'other' || PRODUCT_TASKS.some(task => task.id === value) ? value as TaskFilter : 'all'
}
const selectedTask = ref<TaskFilter>(taskFilter(route.query?.task))
const selectedTaskTitle = computed(() => PRODUCT_TASKS.find(task => task.id === selectedTask.value)?.title || (selectedTask.value === 'other' ? '其他工具' : '全部任务'))
const otherToolCount = computed(() => tools.value.filter(tool => !getToolTaskIds(tool).length).length)
const toolCountForTask = (taskId: ProductTaskId) => tools.value.filter(tool => getToolTaskIds(tool).includes(taskId)).length
const filteredTools = computed(() => tools.value.filter(tool => {
  const taskIds = getToolTaskIds(tool)
  if (selectedTask.value === 'other' ? taskIds.length > 0 : selectedTask.value !== 'all' && !taskIds.includes(selectedTask.value)) return false
  if (onlyUsable.value && !isToolCurrentlyUsable(tool, currentUsability.value)) return false
  const query = searchQuery.value.toLocaleLowerCase()
  const taskWords = PRODUCT_TASKS.filter(task => taskIds.includes(task.id)).map(task => `${task.title} ${task.intent}`).join(' ')
  return !query || `${tool.name} ${tool.description} ${tool.capability_key || ''} ${toolCapabilities(tool).join(' ')} ${taskWords}`.toLocaleLowerCase().includes(query)
}))
const firstReadyTool = computed(() => filteredTools.value.find(tool => isToolCurrentlyUsable(tool, currentUsability.value)))
function clearDirectoryFilters(): void { searchQuery.value = ''; selectedTask.value = 'all'; onlyUsable.value = false }
function openSupport(reason: string): void { void router.push({ path: '/user/ai-chat', query: { reason, task: selectedTask.value, platform: platformStore.currentPlatform } }) }
watch(() => route.query?.task, value => { selectedTask.value = taskFilter(value) })
let catalogSequence = 0
let launchSequence = 0

function numberInput(key: string): number | undefined {
  const value = runInput.value[key]
  return typeof value === 'number' ? value : undefined
}

function setNumberInput(key: string, value: number | null | undefined): void {
  runInput.value[key] = value ?? undefined
}

function clearInputFile(key: string): void {
  runInput.value[key] = undefined
  delete selectedFileNames.value[key]
  delete fileInputErrors.value[key]
}

async function selectInputFile(key: string, label: string): Promise<void> {
  const api = window.electronAPI?.files
  if (!api || selectingFile.value) return
  const tool = pendingTool.value
  selectingFile.value = key
  try {
    const selection = await api.select({ label })
    // Cancellation preserves the previous value. Late dialogs cannot mutate another tool.
    if (!selection || pendingTool.value !== tool || !runDialogVisible.value) return
    runInput.value[key] = selection.filePath
    selectedFileNames.value[key] = selection.fileName
    delete fileInputErrors.value[key]
  } catch (error) {
    if (pendingTool.value === tool) fileInputErrors.value[key] = errorMessage(error, '文件选择失败，请重试')
  } finally { selectingFile.value = '' }
}

const userInfo = computed(() => {
  void profileVersion.value
  try {
    return readStoredLicense()
  } catch {
    return {}
  }
})

const currentPlanName = computed(() => userInfo.value.plan_name || '当前授权')
const currentPlanCode = computed(() => {
  return licensePlanCode(userInfo.value)
})
const currentUsability = computed(() => ({
  planCode: currentPlanCode.value,
  allowedCapabilities: licenseAllowedCapabilities(userInfo.value),
  platformScope: userInfo.value.platform_scope,
  platformKey: platformStore.currentPlatform,
  runtimeAvailable: runtime.singleLive,
  mode: 'single' as const,
}))
const targetWorkspaceAvailable = computed<boolean | undefined>(() => loading.value
  ? undefined
  : tools.value.some(tool => supportsTargetWorkspace(tool) && isToolCurrentlyUsable(tool, currentUsability.value)))

const iconMap = {
  register: UserPlus,
  ali_register: UserPlus,
  logistics_standard: Truck,
  logistics_template: Truck,
  logistics_cost: BadgeDollarSign,
  ad_script: Megaphone,
  ads: Megaphone,
  ship_script: PackageCheck,
  ali_ship: PackageCheck,
  listing_script: PackagePlus,
  listing: PackagePlus,
  ali_listing: PackagePlus,
  fba_agl: Warehouse,
}

function toolIcon(tool: ToolCatalogItem) {
  return (tool.capability_key ? iconMap[tool.capability_key as keyof typeof iconMap] : undefined) || (tool.category === 'automation' ? Zap : Boxes)
}

function defaultDescription(tool: ToolCatalogItem) {
  return `自动处理${tool.name || '当前功能'}中的重复操作`
}

function normalizedList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[\n,，]/).map(item => item.trim()).filter(Boolean)
  return []
}

function toolCapabilities(tool: ToolCatalogItem) {
  return normalizedList(tool?.capability_tags).slice(0, 3)
}

function toolPlatformLabel(tool: ToolCatalogItem): string {
  const key = String(tool.platform_key || platformStore.currentPlatform || 'amazon').toLowerCase()
  return key === 'aliexpress' ? '速卖通' : '亚马逊'
}

function toolInputCount(tool: ToolCatalogItem): number {
  return Array.isArray(tool.single_input_schema) ? tool.single_input_schema.length : 0
}

function toolInputLabel(tool: ToolCatalogItem): string {
  const count = toolInputCount(tool)
  return count ? `${count} 项` : '无需填写'
}

function hasToolDetails(tool: ToolCatalogItem) {
  return toolCapabilities(tool).length
    || normalizedList(tool?.preparation_notes).length
    || normalizedList(tool?.intervention_scenarios).length
}

function liveUnavailable(tool: ToolCatalogItem): boolean {
  return isLiveTool(tool) && !runtime.singleLive
}

function scriptPreflightRequired(tool: ToolCatalogItem): boolean {
  return getToolPresentation(tool).action === 'inspect'
}
function toolExecutionUnavailable(tool: ToolCatalogItem): boolean {
  return ['unavailable', 'calculate'].includes(getToolPresentation(tool).action)
}

function toolActionText(tool: ToolCatalogItem): string {
  if (toolState(tool) === 'platform-locked') return '核对平台授权'
  if (toolState(tool) === 'locked') return '查看可用套餐'
  const presentation = getToolPresentation(tool)
  if (presentation.action === 'unavailable' || presentation.action === 'calculate') return presentation.actionLabel
  if (liveUnavailable(tool)) return '下载桌面端'
  return presentation.actionLabel
}

function cardActionText(tool: ToolCatalogItem): string {
  if (liveUnavailable(tool)) return '下载桌面端'
  // Cards with guidance always open the read-only detail surface first. Keep
  // the CTA honest instead of implying that a click immediately starts work.
  if (!hasToolDetails(tool)) return toolActionText(tool)
  if (toolState(tool) === 'platform-locked') return '查看授权说明'
  if (toolState(tool) === 'locked') return '查看套餐说明'
  return '查看准备项'
}

function openDetails(rawTool: unknown) {
  detailsTool.value = toolCatalogItemSchema.parse(rawTool)
  detailsVisible.value = true
}

const detailsActionText = computed(() => {
  if (!detailsTool.value) return '关闭'
  return toolActionText(detailsTool.value)
})

async function launchFromDetails() {
  if (!detailsTool.value || toolExecutionUnavailable(detailsTool.value)) return
  const tool = detailsTool.value
  detailsVisible.value = false
  handleToolClick(tool)
}

async function downloadKstDesktop(): Promise<void> {
  try {
    await downloadDesktopInstaller()
  } catch (error) {
    showToast(errorMessage(error, '桌面安装包暂时无法下载'), 'error')
  }
}

function toolState(tool: ToolCatalogItem) {
  if (!isToolPublished(tool)) return 'maintenance'
  if (!isToolInPlatformScope(tool, currentUsability.value)) return 'platform-locked'
  if (!isToolIncluded(tool, currentPlanCode.value, currentUsability.value.allowedCapabilities)) return 'locked'
  return 'available'
}

function handleToolClick(rawTool: unknown) {
  const tool = toolCatalogItemSchema.parse(rawTool)
  const state = toolState(tool)
  if (!isCustomerTool(tool) || toolExecutionUnavailable(tool)) return
  if (state === 'platform-locked') {
    showToast(`当前授权未包含${toolPlatformLabel(tool)}，请联系授权提供方核对平台范围；更换套餐并不代表已获此平台授权。`, 'info')
    router.push({ path: '/user/ai-chat', query: { tool: tool.id, reason: 'platform-scope' } })
    return
  }
  if (state === 'locked') {
    router.push({ path: '/user/plans', query: { tool: tool.id } })
    return
  }
  if (liveUnavailable(tool)) {
    void downloadKstDesktop()
    return
  }
  if (requiresTargetProfile(tool)) {
    if (!supportsTargetWorkspace(tool)) {
      showToast('此工具需要尚未接入的目标能力或运行协议，不能使用通用脚本执行。', 'info')
      return
    }
    targetToolId.value = tool.id
    targetWorkspaceRequest.value++
    return
  }
  if (scriptPreflightRequired(tool)) {
    void runTool(tool)
    return
  }
  if (isLiveTool(tool)) {
    pendingTool.value = tool
    runInput.value = Object.fromEntries((tool.single_input_schema || []).map(field => [field.key, undefined]))
    selectedFileNames.value = {}
    fileInputErrors.value = {}
    runDialogVisible.value = true
    return
  }
  void runTool(tool)
}

async function loadData() {
  const sequence = ++catalogSequence
  const platform = platformStore.currentPlatform
  const current = () => sequence === catalogSequence && platform === platformStore.currentPlatform
  const hadData = tools.value.length > 0
  loading.value = !hadData
  loadError.value = ''
  staleError.value = ''
  try {
    const next = toolCatalogSchema
      .parse(await getTools({ platform_key: platform }))
      .filter(tool => isCustomerTool(tool) && tool.supports_live_single)
    if (current()) {
      tools.value = next
      if (targetToolId.value !== undefined && !next.some(tool => tool.id === targetToolId.value && supportsTargetWorkspace(tool) && isToolCurrentlyUsable(tool, currentUsability.value))) targetToolId.value = undefined
    }
  } catch (error) {
    if (!current()) return
    const message = errorMessage(error, '请检查网络连接后重试。')
    if (hadData) staleError.value = message
    else loadError.value = message
  } finally {
    if (current()) loading.value = false
  }
}

async function confirmRun() {
  if (selectingFile.value) return
  const tool = pendingTool.value
  if (!tool) return
  const validation = validateSingleToolInput(tool.single_input_schema || [], runInput.value)
  if (validation) {
    for (const field of tool.single_input_schema || []) if (field.type === 'file' && field.required && !runInput.value[field.key]) fileInputErrors.value[field.key] = `请选择${field.label}`
    showToast(validation, 'warning'); return
  }
  const fileFields = (tool.single_input_schema || []).filter(field => field.type === 'file' && typeof runInput.value[field.key] === 'string' && runInput.value[field.key])
  if (fileFields.length) {
    const api = window.electronAPI?.files
    if (!api) { showToast('请使用支持文件选择的 Windows 客户端', 'warning'); return }
    try {
      const result = await api.validate({ paths: fileFields.map(field => String(runInput.value[field.key])) })
      if (pendingTool.value !== tool || !runDialogVisible.value) return
      fileInputErrors.value = {}
      for (const issue of result.issues) {
        for (const field of fileFields) if (runInput.value[field.key] === issue.filePath) fileInputErrors.value[field.key] = issue.message
      }
      if (!result.valid) return
    } catch { showToast('本机文件暂时无法核对，请重新选择后重试', 'error'); return }
  }
  await runTool(tool, { ...runInput.value })
  if (appStore.toolVisible) runDialogVisible.value = false
}

async function runTool(tool: ToolCatalogItem, input: Record<string, unknown> = {}) {
  // Internal demo launchers remain in their module; this directory never
  // falls back to them when real execution conditions are not satisfied.
  if (!isCustomerTool(tool) || !isToolCurrentlyUsable(tool, currentUsability.value)) return
  if (launchingToolId.value !== null) return
  const sequence = ++launchSequence
  const platformKey = platformStore.currentPlatform
  launchingToolId.value = tool.id
  try {
    if (isLiveTool(tool) && !runtime.singleLive) throw new Error('真实自动化仅支持已启用本地 Runner 的桌面客户端')
    const launchTool = scriptPreflightRequired(tool)
      ? buildPreflightLaunch(tool, platformKey, input)
      : await buildLiveLaunch(tool, platformKey, input)
    launchTool.executionContext = { ...launchTool.executionContext, fileInputKeys: (tool.single_input_schema || []).filter(field => field.type === 'file').map(field => field.key) }
    if (sequence === launchSequence && platformKey === platformStore.currentPlatform) appStore.openTool(launchTool)
  } catch (error) {
    if (sequence === launchSequence) showToast(errorMessage(error, '工具启动失败，请稍后重试'), 'error')
  } finally {
    if (sequence === launchSequence) launchingToolId.value = null
  }
}

watch(() => platformStore.currentPlatform, () => {
  launchSequence += 1
  launchingToolId.value = null
  detailsVisible.value = false
  detailsTool.value = null
  runDialogVisible.value = false
  pendingTool.value = null
  targetToolId.value = undefined
  runInput.value = {}
  selectedFileNames.value = {}
  fileInputErrors.value = {}
  tools.value = []
  void loadData()
})
onMounted(() => { void loadData(); window.addEventListener('toolbox:user-updated', refreshProfile) })
onUnmounted(() => { catalogSequence += 1; launchSequence += 1; window.removeEventListener('toolbox:user-updated', refreshProfile) })
</script>

<style scoped>
.ready-next-step{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:16px 18px;margin-bottom:18px;border:1px solid var(--color-primary-muted);border-radius:12px;background:var(--color-primary-soft)}.ready-next-step>div{min-width:0}.ready-next-step strong{color:var(--color-text);font-size:var(--type-control);overflow-wrap:anywhere}.ready-next-step p{margin:5px 0 0;color:var(--color-text-secondary);font-size:var(--type-meta);line-height:1.65}.ready-next-step button{display:inline-flex;align-items:center;gap:7px;flex-shrink:0;min-height:40px;padding:9px 14px;border:0;border-radius:9px;background:var(--color-primary);color:#fff;font:inherit;font-size:var(--type-control);font-weight:700;cursor:pointer}.empty-actions{display:flex;justify-content:center;flex-wrap:wrap;gap:10px;margin-top:8px}.empty-actions a{display:inline-flex;align-items:center;min-height:38px;padding:0 14px;border:1px solid var(--color-border);border-radius:9px;color:var(--color-primary);background:var(--color-surface);font-size:13px;font-weight:700;text-decoration:none}@media(max-width:620px){.ready-next-step{align-items:stretch;flex-direction:column}.ready-next-step button{justify-content:center}}
.file-input{display:grid;gap:8px;width:100%;padding:12px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface-soft)}.file-name{overflow-wrap:anywhere;color:var(--color-text)}.file-actions{display:flex;gap:8px;flex-wrap:wrap}.file-actions button{border:1px solid var(--color-border);border-radius:7px;background:var(--color-surface);color:var(--color-primary);padding:7px 12px;cursor:pointer}.file-actions button:disabled{opacity:.5;cursor:not-allowed}.file-input small{line-height:1.6;color:var(--color-text-secondary)}.file-input .file-error{margin:0;color:var(--color-danger);line-height:1.5}
.directory-filters{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:0 0 22px}.search-box{display:flex;align-items:center;gap:8px;flex:1;min-width:220px;padding:10px 12px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface)}.search-box input{width:100%;min-width:0;border:0;background:transparent;color:var(--color-text);font:inherit;outline:none}.search-box:focus-within{outline:2px solid var(--color-focus-ring)}.available-filter{display:flex;align-items:center;gap:6px;font-size:13px}.directory-filters>button{padding:9px 12px;border:1px solid var(--color-border);border-radius:9px;background:var(--color-surface);color:var(--color-text);cursor:pointer}.directory-filters>button[aria-pressed=true]{border-color:var(--color-primary);color:var(--color-primary)}.task-groups{display:grid;gap:18px;margin-bottom:20px}.task-group-heading{display:flex;align-items:baseline;justify-content:space-between;gap:14px;margin-bottom:10px}.task-group-heading>div{min-width:0}.task-group h3{margin:0;font-size:14px;color:var(--color-text)}.task-group-heading p{margin:4px 0 0;color:var(--color-text-secondary);font-size:12px;line-height:1.55}.task-group-count{flex:none;color:var(--color-text-tertiary);font-size:11px}.task-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.task-grid button{display:grid;align-content:start;gap:7px;padding:15px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface);color:var(--color-text);text-align:left;cursor:pointer}.task-grid button[aria-pressed=true]{border-color:var(--color-primary);background:var(--color-primary-soft)}.task-grid span{font-size:12px;line-height:1.6;color:var(--color-text-secondary)}.task-grid small{font-size:11px;color:var(--color-text-tertiary)}.task-grid .task-action{display:inline-flex;align-items:center;justify-content:flex-end;gap:4px;margin-top:2px;color:var(--color-primary);font-size:12px;font-weight:700}.directory-summary{font-size:13px;color:var(--color-text-secondary)}@media(max-width:760px){.task-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:480px){.task-grid{grid-template-columns:1fr}}
.toolbox-page {
  width: min(1120px, 100%);
  margin: 0 auto;
}

.toolbox-header {
  min-height: 78px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 24px;
}

.toolbox-eyebrow {
  display: block;
  margin-bottom: 8px;
  color: var(--color-primary);
  font-size:var(--type-meta);
  font-weight: 800;
  letter-spacing: .12em;
}

.toolbox-header h2 {
  margin: 0;
  color: var(--color-text);
  font-size: var(--type-page);
  line-height: 1.3;
  letter-spacing: -.03em;
}

.toolbox-header p {
  margin: 7px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.plan-chip {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  border: 1px solid rgba(169, 133, 82, .22);
  border-radius: 999px;
  color: var(--color-premium);
  background: var(--color-premium-soft);
  font-size:var(--type-control);
  font-weight: 600;
  text-decoration: none;
}

.plan-chip:hover {
  color: var(--color-primary);
  border-color: var(--color-primary-muted);
}

.tool-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.tool-card:last-child:nth-child(odd) { grid-column: 1 / -1; }

.tool-card {
  position: relative;
  min-height: 176px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 22px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text);
  background: var(--color-surface);
  box-shadow: var(--shadow-low);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: transform var(--motion-normal) var(--ease-emphasized), border-color var(--motion-fast), box-shadow var(--motion-normal);
}

.tool-card:not(:disabled):hover {
  transform: translateY(-3px);
  border-color: #bdcbe8;
  box-shadow: var(--shadow-medium);
}

.tool-card:focus-visible {
  outline: 3px solid var(--color-focus-ring);
  outline-offset: 2px;
}

.tool-card:disabled {
  cursor: default;
}

.tool-card-top {
  min-height: 38px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.tool-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.state-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border-radius: 999px;
  font-size:var(--type-micro);
  font-weight: 700;
}

.state-badge.locked {
  color: #b45309;
  background: rgba(255, 153, 0, 0.12);
}

.state-badge.maintenance {
  color: var(--color-text-secondary);
  background: var(--color-surface-soft);
}

.state-badge.demo {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.state-badge.live { color: var(--color-success); background: var(--color-success-soft); }
.run-dialog-heading small { color: var(--color-success); font-size: var(--type-micro); font-weight: 800; letter-spacing: .12em; }
.run-dialog-heading h3 { margin: 5px 0 0; color: var(--color-text); }
.run-dialog-heading p { margin: 5px 0 0; color: var(--color-text-secondary); font-size: var(--type-meta); }
.platform-account-confirmation { margin: 0 0 16px; padding: 12px 14px; border: 1px solid var(--color-border); border-radius: 10px; color: var(--color-text-secondary); background: var(--color-surface-soft); font-size: var(--type-meta); line-height: 1.65; overflow-wrap: anywhere; }
.run-form :deep(.el-input-number), .run-form :deep(.el-select) { width: 100%; }
.run-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }

.tool-copy {
  display: block;
  flex: 1;
  padding: 18px 0 16px;
}

.tool-copy strong,
.tool-copy span {
  display: block;
}

.tool-copy strong {
  margin-bottom: 8px;
  font-size: 17px;
  letter-spacing: -.015em;
  line-height: 1.35;
}

.tool-copy span {
  color: var(--color-text-secondary);
  font-size:var(--type-control);
  line-height: 1.65;
}

.tool-copy .capability-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 13px;
}

.tool-copy .capability-tags > span {
  display: inline-flex;
  padding: 3px 7px;
  border: 1px solid rgba(45, 95, 202, .12);
  border-radius: 6px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  font-size:var(--type-micro);
  font-weight: 650;
  line-height: 1.45;
}
.tool-operational-meta{display:grid!important;grid-template-columns:.8fr .7fr 1.35fr;gap:6px;margin-top:14px;padding-top:12px;border-top:1px solid var(--color-border)}.tool-operational-meta>span{display:grid!important;gap:3px}.tool-operational-meta small{color:var(--color-text-tertiary);font-size:10px}.tool-operational-meta b{overflow:hidden;color:var(--color-text);font-size:var(--type-micro);font-weight:700;text-overflow:ellipsis;white-space:nowrap}
.tool-operational-meta small{color:var(--color-text-secondary)}.tool-operational-meta b{white-space:normal;overflow-wrap:anywhere}.empty-state p{max-width:640px;line-height:1.75}.task-grid small{color:var(--color-text-secondary)}

.tool-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  color: var(--color-primary);
  font-size:var(--type-control);
  font-weight: 700;
}

.learn-more {
  position: relative;
  z-index: 2;
  padding: 4px 0;
  color: var(--color-text-secondary);
  font-size: var(--type-control);
  font-weight: 600;
}

.learn-more:hover,
.learn-more:focus-visible {
  color: var(--color-primary);
  outline: none;
}

.action-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.drawer-heading {
  display: flex;
  align-items: center;
  gap: 11px;
}

.drawer-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.drawer-heading div { display: grid; gap: 3px; }
.drawer-heading small { color: var(--color-text-secondary); font-size:var(--type-micro); letter-spacing: .08em; }
.drawer-heading strong { color: var(--color-text); font-size: 15px; }
.drawer-content { display: grid; gap: 25px; }
.drawer-description { margin: 0; color: var(--color-text-secondary); font-size: 13px; line-height: 1.75; }
.drawer-authorization-note { margin: 0; padding: 12px; border-radius: 10px; color: var(--color-warning); background: var(--color-warning-soft); font-size: var(--type-meta); line-height: 1.7; }
.drawer-content section { display: grid; gap: 11px; }
.section-label { color: var(--color-text); font-size:var(--type-control); font-weight: 750; }
.drawer-tags { display: grid; gap: 7px; }
.drawer-tags > span { display: flex; align-items: center; gap: 8px; padding: 10px 11px; border-radius: 10px; color: var(--color-primary); background: var(--color-primary-soft); font-size:var(--type-control); }
.drawer-content ul { margin: 0; padding-left: 18px; color: var(--color-text-secondary); font-size:var(--type-control); line-height: 1.8; }
.drawer-assurance { display: flex; align-items: flex-start; gap: 9px; padding: 12px; border-radius: 11px; color: var(--color-success); background: var(--color-success-soft); }
.drawer-assurance span { font-size:var(--type-meta); line-height: 1.6; }
.drawer-primary { width: 100%; height: 42px; display: flex; align-items: center; justify-content: center; gap: 7px; border: 0; border-radius: 11px; color: #fff; background: var(--color-primary); font-weight: 700; cursor: pointer; }
.drawer-primary:disabled { opacity: .5; cursor: default; }
:deep(.tool-detail-drawer .el-drawer__header) { margin: 0; padding: 22px 22px 16px; border-bottom: 1px solid var(--color-border); }
:deep(.tool-detail-drawer .el-drawer__body) { padding: 22px; }
:deep(.tool-detail-drawer .el-drawer__footer) { padding: 16px 22px 22px; border-top: 1px solid var(--color-border); }

.is-locked .tool-icon,
.is-locked .tool-action,
.is-platform-locked .tool-icon,
.is-platform-locked .tool-action {
  color: var(--color-warning);
  background-color: var(--color-warning-soft);
}

.is-maintenance {
  opacity: 0.68;
}

.is-maintenance .tool-action {
  color: var(--color-text-secondary);
}

.is-launching {
  opacity: 1;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-focus-ring), var(--shadow-medium);
  animation: launchCardConfirm var(--motion-signature) var(--ease-emphasized) both;
}

.launch-rail {
  position: absolute;
  top: 0;
  left: -58%;
  width: 58%;
  height: 4px;
  border-radius: 0 999px 999px 0;
  background: linear-gradient(90deg, transparent 0%, #8eace8 54%, var(--color-primary) 78%, transparent 100%);
  filter: drop-shadow(0 2px 4px rgba(45, 95, 202, .24));
  animation: launchRail var(--motion-signature) var(--ease-emphasized) both;
}

.is-focused {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-focus-ring), var(--shadow-medium);
}

.spin {
  animation: spin 0.8s linear infinite;
}

.skeleton-card {
  border-color: transparent;
  background: linear-gradient(90deg, #eef2f7 25%, #f8fafc 50%, #eef2f7 75%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite;
}

.empty-state {
  min-height: 320px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 9px;
  color: var(--color-text-secondary);
  text-align: center;
}

.empty-state h3,
.empty-state p {
  margin: 0;
}

.empty-state h3 {
  color: var(--color-text);
  font-size: 16px;
}

.empty-state p {
  font-size: 13px;
}

.empty-state button {
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--color-border);
  border-radius: 9px;
  color: var(--color-primary);
  background: var(--color-surface);
  font-weight: 700;
  cursor: pointer;
}

.error-state > svg { color: var(--color-danger); }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes shimmer { to { background-position: -200% 0; } }
@keyframes launchRail { to { left: 100%; } }
@keyframes launchCardConfirm {
  0% { transform: scale(1); }
  45% { transform: scale(.992); }
  100% { transform: scale(1); }
}

@media (max-width: 620px) {
  .toolbox-header { flex-direction: column; gap: 12px; }
  .tool-grid { grid-template-columns: 1fr; }
  .tool-card:last-child:nth-child(odd) { grid-column: auto; }
}

@media (prefers-reduced-motion: reduce) {
  .launch-rail { display: none; }
  .is-launching { animation: none; }
}

/* 目录层级：让“找任务”和“看状态”先于卡片细节，保留现有搜索、品牌与分类。 */
.directory-intro {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  margin: 26px 0 12px;
  padding: 18px 20px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg, 14px);
  background: var(--color-surface);
}
.directory-kicker {
  display: block;
  margin-bottom: 5px;
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: .1em;
}
.directory-intro h2 { margin: 0; color: var(--color-text); font-size: 18px; letter-spacing: -.02em; }
.directory-intro p { margin: 6px 0 0; color: var(--color-text-secondary); font-size: 13px; line-height: 1.55; }
.directory-count { flex: none; color: var(--color-text-tertiary); font-size: 12px; font-weight: 700; }

@media (max-width: 620px) {
  .directory-intro { align-items: flex-start; flex-direction: column; gap: 8px; margin-top: 20px; padding: 16px; }
  .directory-count { font-size: 11px; }
  .tool-operational-meta { grid-template-columns: 1fr 1fr !important; }
  .tool-operational-meta > span:last-child { grid-column: 1 / -1; }
}

@media (max-width: 420px) {
  .directory-filters { align-items: stretch; }
  .search-box { min-width: 100%; }
  .directory-filters > button { flex: 1; }
  .tool-operational-meta { grid-template-columns: 1fr !important; }
  .tool-operational-meta > span:last-child { grid-column: auto; }
}
</style>
