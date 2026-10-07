<template>
  <div data-testid="business-workspace-page" :class="['batch-workspace', { 'has-batch': store.isActive || store.snapshot.status === 'completed' }]">
    <PageHeader
      eyebrow="BATCH AUTOMATION"
      title="批量自动化工作台"
      description="按业务任务找到已开放工具，导入自己的 Excel 并检查字段；真实批量执行由桌面端提供。"
    >
      <template #actions>
        <button class="help-entry" type="button" @click="helpOpen = true">使用帮助</button>
      </template>
    </PageHeader>
    <AsyncStateNotice v-if="store.bootstrapStale" state="stale" :message="store.error || ''" @retry="refreshTools" />
    <p v-if="store.bootstrapRefreshing && !store.isActive" class="preparation-notice" role="status">正在更新工具目录，暂不能导入或开始新的批次；当前执行不受影响。</p>
    <p v-if="store.preparationNotice && !store.isActive" class="preparation-notice" role="status">{{ store.preparationNotice }}</p>
    <AsyncStateNotice
      v-if="!store.isActive && (store.recoveryPending || store.recoveryStorageUnavailable)"
      state="stale"
      stale-title="演示退出记录待核对"
      :message="store.recoveryStorageUnavailable ? '本机未能完整保存待同步状态，请保持页面打开，联网后核对执行记录。' : `有 ${store.recoveryPending} 个演示批次待同步；使用同一授权联网后会自动核对，不会重新启动任务。`"
      @retry="store.retryRecovery()"
    />
    <template v-if="!store.isActive && store.snapshot.status !== 'completed'">
      <p class="workspace-privacy"><ShieldCheck :size="16" /><span>Excel 原文和登录凭据仅留在本机</span></p>
      <section v-if="!store.bootstrap" class="workspace-loading-state">
        <template v-if="store.error">
          <span><CircleAlert :size="24" /></span>
          <strong>批量工作台暂时无法载入</strong>
          <small>可重试加载目录或打开使用帮助，不会重新执行已有批次。</small>
          <button type="button" @click="refreshTools"><RefreshCw :size="16" />重新载入</button>
        </template>
        <template v-else>
          <span><LoaderCircle :size="24" class="spin" /></span>
          <strong>正在准备专业工作台</strong>
        </template>
      </section>

      <section v-else-if="!customerTools.length" class="workspace-ready-empty">
        <div class="ready-brand"><span>BUSINESS WORKSPACE</span><strong>专业工作台</strong></div>
        <div class="ready-symbol"><Boxes :size="30" /></div>
        <h1>当前还没有开放的批量工具</h1>
        <p>当前目录没有向你开放真实批量工具。内部测试工具不会替代真实功能；你可以先准备业务资料、检查授权或联系支持。</p>
        <div class="ready-flow" aria-label="批量执行准备">
          <article><FileSpreadsheet :size="19" /><div><strong>本地导入</strong><span>客户表格只在本机解析</span></div></article>
          <i></i>
          <article><Layers3 :size="19" /><div><strong>检查准备项</strong><span>按实际任务准备对象和字段</span></div></article>
          <i></i>
          <article><CircleAlert :size="19" /><div><strong>核对后执行</strong><span>工具开放后再导入和确认</span></div></article>
        </div>
        <div class="ready-actions">
          <button type="button" :disabled="store.loading || store.bootstrapRefreshing" @click="refreshTools">
            <LoaderCircle v-if="store.loading" :size="16" class="spin" />
            <RefreshCw v-else :size="16" />
            刷新可用工具
          </button>
          <router-link to="/business/license">查看授权信息</router-link>
        </div>
        <small class="ready-note"><ShieldCheck :size="14" />工具未开放时不会自动启动任何平台任务</small>
        <div class="task-preparation"><article v-for="task in PRODUCT_TASKS" :key="task.id"><strong>{{ task.title }}</strong><p>{{ task.preparation }}</p></article></div>
      </section>

      <section v-else class="batch-setup">
        <div class="setup-stage-rail" aria-label="批量执行流程">
          <div v-for="(stage, index) in ['选择工具','导入数据','检查映射','队列执行']" :key="stage" :class="{ active: setupStageIndex === index, done: setupStageIndex > index }"><span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ stage }}</strong></div>
        </div>

        <div class="setup-section">
          <div class="section-number">01</div>
          <div class="section-copy"><strong>选择批量工具</strong><span>按任务查找，查看开放状态与执行条件</span></div>
          <div class="catalog-filters">
            <label>搜索工具<input v-model="search" type="search" placeholder="搜索任务、工具名称或说明" /></label>
            <label>业务任务<select v-model="taskFilter"><option value="">全部八项任务</option><option v-for="task in PRODUCT_TASKS" :key="task.id" :value="task.id">{{ task.title }}</option></select></label>
            <label>开放状态<select v-model="stateFilter"><option value="">全部状态</option><option value="execute">可执行 / 受控试用</option><option value="inspect">只读检查</option><option value="unavailable">准备中 / 暂不可用</option></select></label>
          </div>
          <div class="business-tools">
            <button v-for="tool in filteredTools" :key="tool.id" :class="{ selected: selectedTool?.id === tool.id }" :disabled="!canPrepare(tool)" @click="selectTool(tool)">
              <span class="tool-icon"><Boxes :size="19" /></span>
              <span><strong>{{ tool.name }} · {{ getToolPresentation(tool).label }}</strong><small>{{ getToolPresentation(tool).description }}</small><small>{{ canPrepare(tool) ? String(tool.business_description || tool.description || '按工具支持范围检查并执行') : '当前不支持批量启动，可打开使用帮助了解准备条件。' }}</small></span>
              <Check v-if="selectedTool?.id === tool.id" :size="17" />
            </button>
            <div v-if="!filteredTools.length" class="no-tools">没有符合筛选条件的工具。请调整搜索或打开使用帮助。</div>
          </div>
        </div>

        <div class="setup-section" :class="{ disabled: !selectedTool }">
          <div class="section-number">02</div>
          <div class="section-copy"><strong>导入本地 Excel</strong><span>只在本机解析；原始单元格、账号和 Cookie 均不会上传</span></div>
          <div v-if="webLiveSelected" class="desktop-required-callout">
            <span><Download :size="21" /></span>
            <div><strong>真实批量执行需要 KST 桌面端</strong><small>网页版不会启动 Runner 或外部平台浏览器。安装桌面端后可继续使用同一账号和授权。</small></div>
            <button type="button" @click="downloadDesktop">下载桌面端</button>
          </div>
          <div v-else class="import-zone">
            <div class="import-actions">
              <button data-testid="business-file-upload" class="import-choice" :disabled="!selectedTool || store.loading || store.bootstrapRefreshing" @click="chooseFile">
                <Upload :size="18" /><span><strong>选择自己的 Excel</strong><small>.xlsx / .csv，最多 {{ store.entitlements.max_batch_rows || 50 }} 行</small></span>
              </button>
              <button class="import-choice compact" type="button" @click="helpOpen = true"><CircleAlert :size="18" /><span><strong>查看导入准备与帮助</strong><small>使用真实业务资料，不载入虚构账号</small></span></button>
            </div>
            <div v-if="selectedTool" class="input-preparation"><strong>导入前请准备</strong><p>{{ selectedTasks.map(task => task.preparation).join(' ') || '准备当前工具所需的账号和业务对象，仅在本机填写。' }}</p><ul v-if="inputFields.length"><li v-for="field in inputFields" :key="field.key">{{ field.label }}：{{ field.required ? '必填，使用本机真实资料' : '按实际情况填写' }}</li></ul><p v-else>字段格式以工具要求为准；导入后仍须检查映射和问题行，不会生成演示数据。</p></div>
            <div v-if="store.importPreview" class="selected-import"><FileSpreadsheet :size="16" /><span><strong>{{ store.importPreview.fileName }}</strong><small>{{ store.importPreview.worksheetName ? `已匹配工作表：${store.importPreview.worksheetName}` : '字段匹配完成' }}<template v-if="store.importPreview.templateVersion"> · 模板 {{ store.importPreview.templateVersion }}</template></small></span></div>
            <div v-if="store.importPreview" class="import-result">
              <span class="valid"><CheckCircle2 :size="15" />{{ store.importPreview.validCount }} 行通过字段检查</span>
              <span v-if="store.importPreview.errorCount" class="invalid"><CircleAlert :size="15" />{{ store.importPreview.errorCount }} 行需要修正</span>
            </div>
            <div v-if="store.importPreview?.rows?.length" class="preview-list">
              <div v-for="row in store.importPreview.rows.slice(0, 6)" :key="row.itemId">
                <span>{{ row.preview.account_label }}</span><small>已通过字段检查</small>
              </div>
              <div v-if="store.importPreview.validCount > 6" class="more-row">还有 {{ store.importPreview.validCount - 6 }} 行未展开</div>
            </div>
            <div v-if="store.importPreview?.errors?.length" class="error-list">
              <div v-for="problem in store.importPreview.errors.slice(0, 4)" :key="problem.rowNumber">第 {{ problem.rowNumber }} 行：{{ problem.message }}</div>
              <button type="button" @click="exportErrors">导出问题清单</button>
              <button type="button" @click="helpOpen = true">导入问题求助</button>
            </div>
          </div>
        </div>

        <footer v-if="webLiveSelected" class="setup-footer desktop-footer">
          <div><strong>桌面端专属能力</strong><span>网页版可查看目录与记录；不会启动平台浏览器或执行任务。</span></div>
          <button type="button" @click="downloadDesktop"><Download :size="16" />下载 KST 桌面端</button>
        </footer>
        <footer v-else class="setup-footer">
          <div><strong>真实执行</strong><span>系统按受控队列操作工具支持的平台；导入通过不代表任务成功，异常结果需先核对。</span></div>
          <button :disabled="!selectedTool || !store.importPreview?.validCount || store.loading || store.bootstrapRefreshing" @click="beginBatch">
            <LoaderCircle v-if="store.loading" :size="16" class="spin" /><Play v-else :size="16" />开始批量执行
          </button>
        </footer>
      </section>
    </template>

    <BusinessBatchRunConsole v-else @exit="endBatch" @new="newBatch" />
    <p v-if="importError" class="import-failure" role="alert">{{ importError }} <button type="button" @click="helpOpen = true">导入问题求助</button></p>
    <BusinessHelpDrawer v-model="helpOpen" :entry-point="importError ? '导入问题' : '批量工作台'" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { Boxes, Check, CheckCircle2, CircleAlert, Download, FileSpreadsheet, Layers3, LoaderCircle, Play, RefreshCw, ShieldCheck, Upload } from '@lucide/vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { showToast } from '@/utils'
import { useBusinessWorkspaceStore } from '@/stores/businessWorkspace'
import AsyncStateNotice from '@/components/AsyncStateNotice.vue'
import PageHeader from '@/components/PageHeader.vue'
import BusinessBatchRunConsole from '@/features/business/BusinessBatchRunConsole.vue'
import BusinessHelpDrawer from '@/features/business/BusinessHelpDrawer.vue'
import type { BusinessTool } from '@/features/business/model'
import { PRODUCT_TASKS, getToolTaskIds, getToolPresentation, isCustomerTool, isToolCurrentlyUsable } from '@/features/tools/presentation'
import { licensePlanCode, readStoredLicense } from '@/features/user/model'
import { getRuntimeCapabilities } from '@/runtime/capabilities'
import { downloadDesktopInstaller } from '@/runtime/desktop-download'

const store = useBusinessWorkspaceStore()
const router = useRouter()
const runtime = getRuntimeCapabilities()
const helpOpen = ref(false)
const importError = ref('')
const search = ref('')
const taskFilter = ref('')
const stateFilter = ref('')
const profileVersion = ref(0)
function refreshPreparation(): void { profileVersion.value += 1; store.reconcileToolSelection() }
const customerTools = computed(() => store.tools.filter(isCustomerTool))
const filteredTools = computed(() => customerTools.value.filter(tool => {
  const taskIds = getToolTaskIds(tool)
  const text = [tool.name, tool.description, tool.business_description, ...PRODUCT_TASKS.filter(task => taskIds.includes(task.id)).map(task => task.title)].join(' ').toLowerCase()
  return (!search.value.trim() || text.includes(search.value.trim().toLowerCase())) && (!taskFilter.value || taskIds.some(id => id === taskFilter.value)) && (!stateFilter.value || getToolPresentation(tool).action === stateFilter.value)
}))
const canPrepare = (tool: BusinessTool): boolean => {
  void profileVersion.value
  const license = readStoredLicense()
  if (store.entitlements.batch_execution === false || store.entitlements.multi_account_workspace === false
    || license.entitlements?.batch_execution === false || license.entitlements?.multi_account_workspace === false
    || license.business_workspace_enabled === false || license.product_type === 'consumer') return false
  return isToolCurrentlyUsable(tool, { planCode: licensePlanCode(license), platformScope: license.platform_scope, platformKey: tool.platform_key || tool.platformKey, runtimeAvailable: true, mode: 'batch' })
}
const selectedTool = computed(() => {
  const latest = customerTools.value.find(tool => tool.id === store.selectedTool?.id)
  return latest && canPrepare(latest) ? latest : null
})
const selectedTasks = computed(() => PRODUCT_TASKS.filter(task => selectedTool.value && getToolTaskIds(selectedTool.value).includes(task.id)))
const inputFields = computed(() => (selectedTool.value?.batch_input_schema || []).map(field => ({ key: String(field.key || ''), label: String(field.label || field.key || '字段'), required: field.required !== false })))
function selectTool(tool: BusinessTool): void { if (canPrepare(tool)) { importError.value = ''; store.chooseTool(tool) } }

const errorMessage = (error: unknown, fallback: string): string => error instanceof Error && error.message ? error.message : fallback
const webLiveSelected = computed(() => Boolean(selectedTool.value) && !runtime.batchLive)
const setupStageIndex = computed(() => store.isActive || store.snapshot.status === 'completed' ? 3 : store.importPreview && selectedTool.value ? 2 : selectedTool.value ? 1 : 0)
async function chooseFile() { if (!selectedTool.value) return; importError.value = ''; try { await store.selectImportFile() } catch (error) { importError.value = errorMessage(error, '导入失败'); showToast(importError.value, 'error') } }
async function refreshTools() {
  try {
    await store.refreshBootstrap()
    showToast(customerTools.value.length ? '工具目录已刷新，请查看各项开放状态' : '暂时没有新开放的批量工具', customerTools.value.length ? 'success' : 'info')
  } catch (error) {
    showToast(errorMessage(error, '刷新失败'), 'error')
  }
}
async function exportErrors() { try { const result = await store.exportImportErrors(); if (result) showToast('问题清单已导出', 'success') } catch (error) { showToast(errorMessage(error, '导出失败'), 'error') } }
async function beginBatch() { if (!selectedTool.value || !runtime.batchLive) return; try { await store.startBatch() } catch (error) { showToast(errorMessage(error, '无法开始批次'), 'error') } }
async function downloadDesktop() { try { await downloadDesktopInstaller() } catch (error) { showToast(errorMessage(error, '桌面安装包暂时无法下载'), 'error') } }
async function endBatch() {
  try {
    const isDemo = store.isDemoBatch
    await ElMessageBox.confirm(
      isDemo ? '退出后会停止全部演示账号，已完成的结果仍会保留。' : '结束后会停止当前队列并清理本地浏览器现场。',
      isDemo ? '退出当前演示？' : '结束当前批次？',
      { confirmButtonText: isDemo ? '退出演示' : '结束批次', cancelButtonText: '继续处理', type: 'warning' },
    )
    await store.cancelBatch('cancelled')
    if (isDemo) await router.push('/business/overview')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') showToast(errorMessage(error, '结束失败'), 'error')
  }
}
async function newBatch() { try { await store.resetWorkspace() } catch (error) { showToast(errorMessage(error, '暂时不能新建批次'), 'error') } }
onMounted(() => { void store.init().catch(() => undefined); window.addEventListener('toolbox:user-updated', refreshPreparation) })
onUnmounted(() => { window.removeEventListener('toolbox:user-updated', refreshPreparation) })
onBeforeRouteLeave(async () => {
  if (!store.isActive) return true
  try {
    await ElMessageBox.confirm('离开工作台会停止当前批次并保存已有结果。', '离开批量工作台？', { confirmButtonText: '停止并离开', cancelButtonText: '留在这里', type: 'warning' })
    await store.cancelBatch('interrupted')
    return true
  } catch (error) {
    if (error === 'cancel' || error === 'close') return false
    showToast(errorMessage(error, '暂时无法离开工作台'), 'error')
    return false
  }
})
</script>

<style scoped>
.preparation-notice{margin:0 0 12px;padding:12px 14px;border:1px solid var(--color-border);border-radius:10px;color:var(--color-text-secondary);background:var(--color-surface-soft);font-size:var(--type-meta);line-height:1.6}
.help-entry{min-height:40px;padding:8px 14px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface);color:var(--color-primary);font:inherit;cursor:pointer}.catalog-filters{grid-column:2/-1;display:flex;gap:12px;flex-wrap:wrap;width:100%}.catalog-filters label{display:grid;gap:5px;flex:1;min-width:160px;color:var(--color-text-secondary);font-size:var(--type-meta)}.catalog-filters input,.catalog-filters select{min-height:38px;padding:7px 10px;border:1px solid var(--color-border);border-radius:8px;color:var(--color-text);background:var(--color-surface);font:inherit}.task-preparation{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:24px;text-align:left;width:100%}.task-preparation article,.input-preparation{padding:13px;border:1px solid var(--color-border);border-radius:10px;background:var(--color-surface-soft)}.task-preparation strong,.input-preparation strong{color:var(--color-text);font-size:var(--type-control)}.task-preparation p,.input-preparation p,.input-preparation li{margin:5px 0;color:var(--color-text-secondary);font-size:var(--type-meta);line-height:1.6}.input-preparation{margin-top:14px}.input-preparation ul{padding-left:20px;margin:8px 0}.import-failure{padding:13px;border:1px solid var(--color-border);border-radius:10px;color:var(--color-danger);overflow-wrap:anywhere}.import-failure button{margin-left:10px;padding:6px 10px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-surface);color:var(--color-primary);cursor:pointer}.business-tools button:disabled{cursor:not-allowed;opacity:.72}@media(max-width:720px){.catalog-filters{grid-column:1/-1}.task-preparation{grid-template-columns:1fr}}
.desktop-required-callout{min-height:116px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;padding:18px;border:1px solid rgba(45,95,202,.18);border-radius:14px;background:var(--color-primary-soft)}
.desktop-required-callout>span{width:44px;height:44px;display:grid;place-items:center;border-radius:13px;color:var(--color-primary);background:var(--color-surface)}
.desktop-required-callout>div{display:grid;gap:5px}.desktop-required-callout strong{color:var(--color-text);font-size:var(--type-control)}.desktop-required-callout small{max-width:520px;color:var(--color-text-secondary);font-size:var(--type-meta);line-height:1.55}.desktop-required-callout button{min-height:40px;padding:0 14px;border:0;border-radius:10px;color:#fff;background:var(--color-primary);font-size:var(--type-control);font-weight:700;cursor:pointer}.desktop-footer{background:linear-gradient(90deg,var(--color-surface-soft),var(--color-primary-soft))}
@media(max-width:899px){.setup-section>.desktop-required-callout{grid-column:1/-1}}
@media(max-width:720px){.desktop-required-callout{grid-template-columns:auto 1fr}.desktop-required-callout button{grid-column:1/-1}.desktop-footer{align-items:stretch;flex-direction:column}.desktop-footer button{justify-content:center}}
.batch-workspace{height:100%;min-height:0}.batch-workspace:not(.has-batch){overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}.workspace-loading-state,.workspace-ready-empty{width:min(900px,100%);min-height:560px;margin:0 auto;display:grid;place-content:center;justify-items:center;text-align:center;border:1px solid var(--color-border);border-radius:20px;background:var(--color-surface);box-shadow:var(--shadow-medium)}.workspace-loading-state{gap:12px;color:var(--color-text-secondary)}.workspace-loading-state>span{width:48px;height:48px;display:grid;place-items:center;border-radius:15px;color:var(--color-primary);background:var(--color-primary-soft)}.workspace-loading-state strong{font-size:var(--type-card);color:var(--color-text)}.workspace-ready-empty{position:relative;overflow:hidden;padding:48px 42px}.workspace-ready-empty::before{content:'';position:absolute;left:0;right:0;top:0;height:4px;background:linear-gradient(90deg,var(--color-primary),#7799df,var(--color-premium))}.ready-brand{display:grid;gap:5px}.ready-brand span{font-size:var(--type-micro);font-weight:800;letter-spacing:.13em;color:var(--color-premium)}.ready-brand strong{font-size:var(--type-meta);color:var(--color-text-secondary)}.ready-symbol{width:64px;height:64px;display:grid;place-items:center;margin:20px 0 15px;border-radius:20px;color:var(--color-primary);background:var(--color-primary-soft);box-shadow:0 16px 36px rgba(45,95,202,.12)}.workspace-ready-empty h1{margin:0;color:var(--color-text);font-size:26px;letter-spacing:-.035em}.workspace-ready-empty>p{max-width:620px;margin:10px 0 28px;color:var(--color-text-secondary);font-size:var(--type-control);line-height:1.7}.ready-flow{width:100%;display:grid;grid-template-columns:1fr 32px 1fr 32px 1fr;align-items:center;gap:7px}.ready-flow article{min-height:96px;display:grid;grid-template-columns:auto 1fr;align-items:center;gap:11px;padding:15px;text-align:left;border:1px solid var(--color-border);border-radius:13px;background:var(--color-surface-soft)}.ready-flow article>svg{color:var(--color-primary)}.ready-flow article>div{display:grid;gap:4px}.ready-flow strong{font-size:var(--type-control);color:var(--color-text)}.ready-flow span{font-size:var(--type-meta);line-height:1.45;color:var(--color-text-tertiary)}.ready-flow>i{height:1px;background:var(--color-border);position:relative}.ready-flow>i::after{content:'';position:absolute;right:0;top:-3px;border-left:5px solid var(--color-border-strong);border-top:3px solid transparent;border-bottom:3px solid transparent}.ready-actions{display:flex;gap:9px;margin-top:24px}.ready-actions button,.ready-actions a{min-height:40px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 15px;border-radius:10px;font-size:var(--type-control);font-weight:700;text-decoration:none;cursor:pointer}.ready-actions button{border:0;color:#fff;background:var(--color-primary)}.ready-actions button:disabled{opacity:.55;cursor:not-allowed}.ready-actions a{border:1px solid var(--color-border);color:var(--color-text);background:var(--color-surface)}.ready-note{display:flex;align-items:center;gap:6px;margin-top:18px;color:var(--color-success);font-size:var(--type-meta)}.batch-setup{width:min(1060px,100%);margin:0 auto 30px;display:grid;border:1px solid var(--color-border);border-radius:18px;background:var(--color-surface);box-shadow:var(--shadow-medium);overflow:hidden}.setup-header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding:28px 30px;border-bottom:1px solid var(--color-border);background:linear-gradient(135deg,#fcfcfd,#f8f7f4)}.setup-header>div:first-child>span{font-size:var(--type-micro);font-weight:800;letter-spacing:.13em;color:var(--color-primary)}.setup-header h1{margin:7px 0 0;font-size:27px;letter-spacing:-.04em;color:var(--color-text)}.setup-header p{margin:8px 0 0;color:var(--color-text-secondary);font-size:var(--type-control)}.privacy-mark{display:flex;align-items:center;gap:7px;padding:7px 10px;border-radius:9px;color:var(--color-success);background:#edf8f4;font-size:var(--type-meta);font-weight:700;white-space:nowrap}.setup-section{display:grid;grid-template-columns:38px 190px 1fr;gap:15px;padding:24px 30px;border-bottom:1px solid var(--color-border)}.setup-section.disabled{opacity:.55}.section-number{font:700 var(--type-micro)/1 var(--font-mono,monospace);color:var(--color-primary);padding-top:4px}.section-copy{display:grid;align-content:start;gap:5px}.section-copy strong{font-size:var(--type-control);color:var(--color-text)}.section-copy span{font-size:var(--type-meta);line-height:1.55;color:var(--color-text-tertiary)}.business-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.business-tools button{min-height:76px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:13px;text-align:left;border:1px solid var(--color-border);border-radius:13px;background:var(--color-surface);cursor:pointer;transition:border var(--motion-fast),box-shadow var(--motion-fast),transform var(--motion-press)}.business-tools button:hover{border-color:var(--color-border-strong);box-shadow:var(--shadow-low)}.business-tools button:active{transform:scale(.99)}.business-tools button.selected{border-color:rgba(45,95,202,.45);background:var(--color-primary-soft)}.tool-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;color:var(--color-primary);background:var(--color-primary-soft)}.business-tools button>span:nth-child(2){display:grid;gap:4px}.business-tools strong{font-size:var(--type-control);color:var(--color-text)}.business-tools small{font-size:var(--type-meta);line-height:1.4;color:var(--color-text-tertiary)}.business-tools button>svg{color:var(--color-primary)}.no-tools{grid-column:1/-1;padding:24px;border:1px dashed var(--color-border);border-radius:12px;text-align:center;color:var(--color-text-secondary);font-size:var(--type-meta)}.import-zone{display:grid;gap:10px}.import-button{min-height:68px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;padding:12px 15px;border:1px dashed var(--color-border-strong);border-radius:13px;background:var(--color-surface-soft);text-align:left;cursor:pointer}.import-button:disabled{cursor:not-allowed}.import-button>svg{color:var(--color-primary)}.import-button span{display:grid;gap:3px}.import-button strong{font-size:var(--type-control);color:var(--color-text)}.import-button small{font-size:var(--type-meta);color:var(--color-text-tertiary)}.import-result{display:flex;gap:12px}.import-result span{display:flex;align-items:center;gap:5px;font-size:var(--type-meta);font-weight:700}.valid{color:var(--color-success)}.invalid{color:var(--color-warning)}.preview-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.preview-list>div{display:flex;justify-content:space-between;padding:8px 10px;border-radius:8px;background:var(--color-surface-soft);font-size:var(--type-meta);color:var(--color-text-secondary)}.preview-list small{color:var(--color-text-tertiary)}.preview-list .more-row{grid-column:1/-1;justify-content:center}.error-list{display:grid;gap:4px;padding:10px;border-radius:9px;color:var(--color-danger);background:#fff2f3;font-size:var(--type-meta)}.setup-footer{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:20px 30px;background:var(--color-surface-soft)}.setup-footer>div{display:grid;gap:4px}.setup-footer strong{font-size:var(--type-control);color:var(--color-text)}.setup-footer span{font-size:var(--type-meta);color:var(--color-text-tertiary)}.setup-footer button{height:42px;display:flex;align-items:center;gap:8px;padding:0 18px;border:0;border-radius:11px;color:#fff;background:var(--color-primary);font-size:var(--type-control);font-weight:700;cursor:pointer;box-shadow:0 8px 18px rgba(45,95,202,.18)}.setup-footer button:disabled{opacity:.45;cursor:not-allowed}
.has-batch{display:grid;grid-template-rows:auto minmax(0,1fr);gap:10px}.workspace-header{min-height:58px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:18px;padding:0 15px;border:1px solid var(--color-border);border-radius:14px;background:var(--color-surface);box-shadow:var(--shadow-low)}.batch-identity{display:flex;align-items:center;gap:10px}.professional-badge{padding:5px 7px;border-radius:6px;color:#765d38;background:#f1eadf;font-size:var(--type-micro);font-weight:800;letter-spacing:.1em}.batch-identity div{display:grid;gap:2px}.batch-identity strong{font-size:var(--type-control);color:var(--color-text)}.batch-identity small{font-size:var(--type-micro);color:var(--color-text-tertiary)}.batch-counts{display:flex;align-items:center}.batch-counts>span{min-width:84px;display:grid;gap:2px;padding:0 16px;border-left:1px solid var(--color-border);text-align:center}.batch-counts>span:first-child{border:0}.batch-counts small{font-size:var(--type-micro);color:var(--color-text-tertiary)}.batch-counts strong{font-size:15px;color:var(--color-text);font-variant-numeric:tabular-nums}.batch-counts .attention strong{color:var(--color-warning)}.header-actions{display:flex;justify-content:flex-end;align-items:center;gap:12px}.sync-state{font-size:var(--type-meta);color:var(--color-success)}.sync-state.is-offline{color:var(--color-warning)}.header-actions button{height:34px;display:flex;align-items:center;gap:6px;padding:0 10px;border:1px solid var(--color-border);border-radius:8px;color:var(--color-text-secondary);background:transparent;font-size:var(--type-control);cursor:pointer}.workspace-grid{min-height:0;display:grid;grid-template-columns:244px minmax(0,1fr) 300px;gap:10px}.account-queue,.action-panel,.browser-shell{min-height:0;border:1px solid var(--color-border);border-radius:14px;background:var(--color-surface);box-shadow:var(--shadow-low);overflow:hidden}.account-queue{display:grid;grid-template-rows:auto 1fr}.account-queue>header,.action-panel>header{min-height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid var(--color-border)}.account-queue header div,.action-panel header div{display:grid;gap:3px}.account-queue header strong,.action-panel header strong{font-size:var(--type-control);color:var(--color-text)}.account-queue header small,.action-panel header span{font-size:var(--type-meta);color:var(--color-text-tertiary)}.queue-list{min-height:0;padding:8px;display:flex;flex-direction:column;gap:4px;overflow-y:auto}.queue-item{width:100%;min-height:54px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;padding:7px 9px;border:1px solid transparent;border-radius:10px;background:transparent;text-align:left;cursor:pointer;transition:background var(--motion-fast),border var(--motion-fast)}.queue-item:hover{background:var(--color-surface-soft)}.queue-item.selected{border-color:rgba(45,95,202,.2);background:var(--color-primary-soft)}.queue-state{width:28px;height:28px;display:grid;place-items:center;border-radius:9px;color:var(--color-text-tertiary);background:var(--color-surface-soft)}.queue-state>span{width:7px;height:7px;border-radius:50%;background:var(--color-border-strong)}.queue-item.is-running .queue-state{color:var(--color-primary);background:var(--color-primary-soft)}.queue-item.is-waiting_user .queue-state{color:var(--color-warning);background:#fff0d2;animation:attention-pulse 700ms ease 2}.queue-item.is-failed .queue-state{color:var(--color-danger);background:#fff0f1}.queue-item.is-completed .queue-state{color:var(--color-success);background:#eaf8f2}.queue-copy{display:grid;gap:3px;min-width:0}.queue-copy strong{overflow:hidden;text-overflow:ellipsis;font-size:var(--type-control);color:var(--color-text)}.queue-copy small{font-size:var(--type-meta);color:var(--color-text-tertiary)}.queue-item>svg{color:var(--color-text-tertiary)}.browser-stage{min-width:0;min-height:0}.browser-shell{height:100%;display:grid;grid-template-rows:42px minmax(0,1fr)}.browser-toolbar{display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--color-border);color:var(--color-text-tertiary);font-size:var(--type-meta)}.browser-toolbar>span:nth-of-type(2){min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.browser-toolbar small{padding:4px 7px;border-radius:6px;background:var(--color-surface-soft);color:var(--color-text-secondary)}.traffic{display:flex;gap:4px;margin-right:3px}.traffic i{width:6px;height:6px;border-radius:50%;background:#d8dce3}.browser-viewport{position:relative;min-height:0;background:#f2f4f7}.batch-webview{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}.browser-placeholder,.desktop-required{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:10px;text-align:center;color:var(--color-text-tertiary)}.browser-placeholder strong,.desktop-required strong{color:var(--color-text)}.browser-placeholder span,.desktop-required span{font-size:var(--type-meta)}.automation-shield{position:absolute;left:50%;bottom:16px;z-index:3;transform:translateX(-50%);display:flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid rgba(45,95,202,.18);border-radius:99px;color:var(--color-primary);background:rgba(252,252,253,.94);box-shadow:var(--shadow-medium);font-size:var(--type-meta);pointer-events:none}.action-panel{padding-bottom:14px}.action-panel>header{margin-bottom:14px}.mobile-close{display:none;border:0;background:transparent;color:var(--color-text-secondary)}.status-hero{margin:0 14px;padding:17px;border-radius:13px;background:var(--color-surface-soft);display:grid;justify-items:start;gap:7px}.status-symbol{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;color:var(--color-text-secondary);background:#fff}.status-hero>span{font-size:var(--type-control);font-weight:800;color:var(--color-text)}.status-hero p{min-height:34px;margin:0;font-size:var(--type-meta);line-height:1.6;color:var(--color-text-secondary)}.status-hero.is-running{background:var(--color-primary-soft)}.status-hero.is-running .status-symbol{color:var(--color-primary)}.status-hero.is-waiting_user{background:#fff8eb}.status-hero.is-waiting_user .status-symbol{color:var(--color-warning)}.status-hero.is-completed{background:#edf8f4}.status-hero.is-completed .status-symbol{color:var(--color-success)}.status-hero.is-failed{background:#fff2f3}.status-hero.is-failed .status-symbol{color:var(--color-danger)}.business-stage{margin:18px 14px;display:grid;gap:8px}.business-stage>span{font-size:var(--type-meta);color:var(--color-text-tertiary)}.business-stage>div{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.business-stage i{height:3px;border-radius:9px;background:var(--color-border)}.business-stage i.done{background:var(--color-success)}.business-stage i.active{background:var(--color-primary)}.business-stage small{font-size:var(--type-meta);color:var(--color-text-tertiary);word-spacing:7px}.primary-action{width:calc(100% - 28px);height:40px;margin:0 14px;border:0;border-radius:10px;color:#fff;background:var(--color-primary);font-size:var(--type-control);font-weight:700;cursor:pointer}.primary-action.warning{background:var(--color-warning)}.security-note{margin:14px;display:flex;align-items:flex-start;gap:7px;padding:11px;border-radius:10px;color:var(--color-success);background:#edf8f4}.security-note span{font-size:var(--type-meta);line-height:1.55}.mobile-toolbar,.mobile-overlay{display:none}.spin{animation:spin 900ms linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@keyframes attention-pulse{50%{transform:scale(1.06);box-shadow:0 0 0 5px rgba(183,121,31,.09)}}
@media(max-width:1279px){.workspace-grid{grid-template-columns:230px minmax(0,1fr)}.action-panel{position:fixed;top:calc(var(--header-height) + 10px);right:10px;bottom:10px;z-index:1001;width:min(310px,88vw);transform:translateX(calc(100% + 20px));transition:transform var(--motion-normal) var(--ease-emphasized);box-shadow:var(--shadow-overlay)}.action-panel.mobile-open{transform:translateX(0)}.mobile-toolbar{height:38px;display:flex;align-items:center;justify-content:space-between;padding:0 8px}.mobile-toolbar button{display:flex;align-items:center;gap:5px;border:0;background:transparent;color:var(--color-text-secondary);font-size:var(--type-micro)}.mobile-toolbar span{font-size:var(--type-micro);color:var(--color-text)}.browser-stage{display:grid;grid-template-rows:auto minmax(0,1fr)}.mobile-close{display:grid}.mobile-overlay{display:block;position:fixed;inset:0;z-index:1000;background:var(--color-overlay)}}
@media(max-width:899px){.workspace-ready-empty{min-height:100%;padding:34px 24px}.ready-flow{grid-template-columns:1fr}.ready-flow>i{width:1px;height:18px;justify-self:center}.ready-flow>i::after{right:-2px;top:auto;bottom:0;transform:rotate(90deg)}.workspace-header{grid-template-columns:1fr auto}.batch-counts{display:none}.sync-state{display:none}.workspace-grid{display:block;position:relative}.browser-stage{height:100%}.account-queue{position:fixed;top:calc(var(--header-height) + 10px);left:10px;bottom:10px;z-index:1001;width:min(280px,88vw);transform:translateX(calc(-100% - 20px));transition:transform var(--motion-normal) var(--ease-emphasized);box-shadow:var(--shadow-overlay)}.account-queue.mobile-open{transform:translateX(0)}.setup-header,.setup-footer{display:grid}.setup-section{grid-template-columns:32px 1fr;padding:20px}.setup-section>.section-copy{grid-column:2}.setup-section>.business-tools,.setup-section>.import-zone{grid-column:1/-1}.business-tools,.preview-list{grid-template-columns:1fr}.privacy-mark{width:max-content}.setup-footer button{width:100%;justify-content:center}}
@media(max-width:560px){.workspace-ready-empty{padding:30px 18px}.workspace-ready-empty h1{font-size:23px}.ready-actions{width:100%;display:grid}.ready-actions button,.ready-actions a{width:100%}}
.error-list button{width:max-content;margin-top:4px;padding:4px 7px;border:1px solid rgba(195,61,73,.18);border-radius:6px;color:var(--color-danger);background:#fff;font-size:var(--type-micro);cursor:pointer}
@media(prefers-reduced-motion:reduce){.spin{animation:none}.queue-item.is-waiting_user .queue-state{animation:none}.action-panel,.account-queue{transition:none}}
.workspace-loading-state small{max-width:430px;color:var(--color-text-secondary);font-size:var(--type-meta);line-height:1.6}.workspace-loading-state button{height:40px;display:flex;align-items:center;gap:7px;padding:0 14px;border:1px solid var(--color-border);border-radius:10px;color:var(--color-primary);background:var(--color-surface);font-size:var(--type-control);cursor:pointer}
.demo-browser-preview{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:10px;padding:24px;text-align:center;color:var(--color-primary);background:linear-gradient(145deg,#f7f9ff,#eef3ff)}
.demo-browser-preview strong{color:var(--color-text)}.demo-browser-preview span{max-width:420px;color:var(--color-text-secondary);font-size:var(--type-meta);line-height:1.6}
.setup-stage-rail{display:grid;grid-template-columns:repeat(4,1fr);gap:0;padding:12px 30px;border-bottom:1px solid var(--color-border);background:var(--color-surface-soft)}.setup-stage-rail>div{display:flex;align-items:center;gap:8px;min-width:0;color:var(--color-text-tertiary)}.setup-stage-rail>div:not(:last-child)::after{content:'';height:1px;flex:1;margin:0 12px;background:var(--color-border)}.setup-stage-rail span{font:700 var(--type-micro)/1 var(--font-mono)}.setup-stage-rail strong{font-size:var(--type-meta);white-space:nowrap}.setup-stage-rail .active{color:var(--color-primary)}.setup-stage-rail .done{color:var(--color-success)}.setup-stage-rail .done::after{background:rgba(22,138,99,.35)!important}
.import-actions{display:grid;grid-template-columns:1.15fr 1fr .9fr;gap:8px}.import-choice{min-height:68px;display:grid;grid-template-columns:auto 1fr;align-items:center;gap:10px;padding:11px 13px;border:1px solid var(--color-border);border-radius:12px;color:var(--color-text-secondary);background:var(--color-surface);text-align:left;cursor:pointer;transition:border-color var(--motion-fast),box-shadow var(--motion-fast),transform var(--motion-press)}.import-choice:hover:not(:disabled){border-color:var(--color-border-strong);box-shadow:var(--shadow-low)}.import-choice:active:not(:disabled){transform:scale(.99)}.import-choice:disabled{opacity:.5;cursor:not-allowed}.import-choice>svg{color:var(--color-primary)}.import-choice.featured{border-color:rgba(45,95,202,.25);background:var(--color-primary-soft)}.import-choice.featured>svg{color:var(--color-premium)}.import-choice span,.selected-import span{display:grid;gap:3px}.import-choice strong,.selected-import strong{font-size:var(--type-control);color:var(--color-text)}.import-choice small,.selected-import small{font-size:var(--type-micro);line-height:1.4;color:var(--color-text-tertiary)}.selected-import{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:9px;color:var(--color-success);background:var(--color-success-soft)}
.batch-webview{visibility:hidden;opacity:0;transition:opacity var(--motion-normal)}.batch-webview.active{visibility:visible;opacity:1}
.browser-shell .browser-toolbar{border-bottom-color:var(--color-execution-border);color:rgba(248,250,252,.68);background:var(--color-execution-surface)}.browser-shell .browser-toolbar small{color:#d8c39d;background:rgba(255,255,255,.08)}.browser-shell .traffic i{background:rgba(255,255,255,.22)}
@media(max-width:899px){.import-actions{grid-template-columns:1fr}.import-choice{min-height:62px}}
@media(max-width:760px){.setup-stage-rail{grid-template-columns:1fr 1fr;gap:8px;padding:12px 20px}.setup-stage-rail>div::after{display:none}}
.batch-webview{visibility:hidden}.batch-webview.active{visibility:visible}
.help-entry{flex-shrink:0;white-space:nowrap}
.workspace-privacy{width:min(1060px,100%);display:flex;align-items:flex-start;gap:7px;margin:0 auto 12px;color:var(--color-success);font-size:var(--type-meta);line-height:1.5}
.workspace-privacy>svg{flex-shrink:0;margin-top:2px}
.setup-section{grid-template-columns:38px 190px minmax(0,1fr)}
.catalog-filters{min-width:0}
.catalog-filters label{flex:1 1 160px;min-width:0}
.catalog-filters input,.catalog-filters select{width:100%;min-width:0;box-sizing:border-box}
.business-tools{grid-column:2/-1;min-width:0}
.business-tools button{min-width:0;grid-template-columns:auto minmax(0,1fr) auto}
.business-tools button>span:nth-child(2){min-width:0;overflow-wrap:anywhere}
.import-actions{grid-template-columns:repeat(2,minmax(0,1fr))}
@media(max-width:899px){.setup-section{grid-template-columns:32px minmax(0,1fr)}.setup-section>.catalog-filters,.setup-section>.business-tools{grid-column:1/-1}.import-actions{grid-template-columns:1fr}}
</style>
