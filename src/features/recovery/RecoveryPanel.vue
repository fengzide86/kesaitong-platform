<template>
  <section v-if="bridge" class="recovery-panel" aria-label="本机结果核对" data-testid="recovery-panel">
    <header><div><h3>本机结果核对</h3><p>核对结论与执行状态分开记录。未知结果不能直接重试，人工确认不会变成工具执行成功。</p></div><button type="button" :disabled="busy" @click="load">刷新</button></header>
    <p v-if="error" class="recovery-error" role="alert">{{ error }}</p>
    <p v-else-if="!visibleRecords.length" class="recovery-empty">当前没有待处理的本机恢复记录。旧记录缺少提交证据时，请先自行核对平台，不能据此确认未提交。</p>
    <article v-for="record in visibleRecords" :key="record.id" class="recovery-row">
      <div class="recovery-summary"><strong>{{ record.originalRow ? `原表第 ${record.originalRow} 行` : '单条任务' }} · {{ recoveryLabels[record.classification] }}{{ record.executionStatus === 'queued' ? ' · 尚未派发' : '' }}</strong><span>{{ record.errorCode || '未记录错误码' }} · {{ formatTime(record.updatedAt) }}</span></div>
      <div class="recovery-actions">
        <button type="button" :disabled="busy" @click="viewEvidence(record)">查看本机证据</button>
        <button type="button" :disabled="busy || !record.targetOrigin" @click="openPlatform(record)">打开平台核对</button>
        <button type="button" :disabled="busy || record.executionStatus === 'queued'" @click="reviewing = record; checked = false">记录核对结论</button>
        <button type="button" @click="openSupport">求助</button>
      </div>
      <p v-if="!record.retryAllowed" class="recovery-warning">当前不能重新执行：请先核对结果并记录结论。</p>
    </article>
    <footer v-if="visibleRecords.length"><button type="button" :disabled="busy" @click="exportRows">导出失败及待核对行</button><button v-for="batchId in retryBatches" :key="batchId" type="button" :disabled="busy || workspace.isActive" @click="prepareBatch(batchId)">重新选择原文件，准备可重试行</button></footer>
    <el-dialog v-model="reviewOpen" title="记录平台核对结论" width="min(500px, 94vw)">
      <p>请实际查看同一商品、订单或活动的列表/详情。这里记录的是你的核对结论，不是 Runner 验收成功。</p>
      <label class="review-check"><input v-model="checked" type="checkbox" />我已在平台查看同一业务对象的当前状态</label>
      <template #footer><button type="button" :disabled="!checked || busy" @click="conclude('not_completed')">确认未完成</button><button type="button" :disabled="!checked || busy" @click="conclude('completed')">确认已完成</button></template>
    </el-dialog>
    <el-dialog v-model="evidenceOpen" title="本机证据" width="min(850px, 94vw)"><p>{{ evidenceMessage }}</p><img v-if="evidenceImage" :src="evidenceImage" class="evidence-image" alt="本机任务证据截图" /></el-dialog>
    <BusinessHelpDrawer v-if="isBusiness" v-model="helpOpen" />
  </section>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useBusinessWorkspaceStore } from '@/stores/businessWorkspace'
import { importPreviewSchema } from '@/features/business/model'
import { recoveryLabels, type RecoveryRecord } from '@/shared/ipc/recovery-contract'
const props = defineProps<{ batchId?: string; runId?: string }>()
const bridge = window.electronAPI?.recovery
const router = useRouter()
const workspace = useBusinessWorkspaceStore()
const BusinessHelpDrawer = defineAsyncComponent(() => import('@/features/business/BusinessHelpDrawer.vue'))
const isBusiness = computed(() => router.currentRoute.value.path.startsWith('/business'))
const helpOpen = ref(false)
function openSupport() { if (isBusiness.value) helpOpen.value = true; else void router.push('/user/ai-chat') }
const records = ref<RecoveryRecord[]>([])
const error = ref('')
const busy = ref(false)
const reviewing = ref<RecoveryRecord | null>(null)
const checked = ref(false)
const reviewOpen = computed({ get: () => reviewing.value !== null, set: value => { if (!value) reviewing.value = null } })
const evidenceOpen = ref(false)
const evidenceImage = ref('')
const evidenceMessage = ref('')
let sequence = 0
let authEpoch = 0
const visibleRecords = computed(() => records.value.filter(row => (!props.runId || row.runId === props.runId) && row.executionStatus !== 'running' && !['verified', 'manual_completed'].includes(row.classification)))
const retryBatches = computed(() => [...new Set(visibleRecords.value.filter(row => row.retryAllowed && row.batchId).map(row => row.batchId!))])
const formatTime = (time: string) => new Date(time).toLocaleString('zh-CN')
const message = (cause: unknown) => cause instanceof Error ? cause.message : '本机恢复操作失败'
async function load() {
  if (!bridge) return
  const request = ++sequence
  try { const rows = await bridge.list(props.batchId ? { batchId: props.batchId } : {}); if (request === sequence) { records.value = rows; error.value = '' } }
  catch (cause) { if (request === sequence) { records.value = []; error.value = message(cause) } }
}
async function action(operation: () => Promise<unknown>) {
  if (busy.value) return
  const epoch = authEpoch
  busy.value = true
  try { await operation(); if (epoch === authEpoch) error.value = '' } catch (cause) { if (epoch === authEpoch) error.value = message(cause) }
  finally { busy.value = false }
}
async function conclude(conclusion: 'completed' | 'not_completed') {
  const record = reviewing.value
  const epoch = authEpoch
  if (!record || !checked.value || !bridge) return
  await action(async () => { await bridge.review({ id: record.id, revision: record.revision, conclusion }); if (epoch !== authEpoch) return; reviewing.value = null; window.dispatchEvent(new Event('toolbox:recovery-updated')); await load() })
}
async function openPlatform(record: RecoveryRecord) { await action(async () => { await bridge?.openPlatform(record.id) }) }
async function exportRows() { await action(async () => { await bridge?.export(props.batchId ? { batchId: props.batchId } : {}) }) }
async function viewEvidence(record: RecoveryRecord) {
  const epoch = authEpoch
  evidenceImage.value = ''; evidenceMessage.value = ''; evidenceOpen.value = true
  await action(async () => {
    if (!record.runId || !bridge) { evidenceMessage.value = '这条记录没有可读取的截图；请在平台列表或详情核对。'; return }
    const result = await bridge.readEvidence(record.id)
    if (epoch !== authEpoch) return
    if (result.status === 'available' && result.kind === 'screenshot') {
      evidenceImage.value = 'dataUrl' in result ? String(result.dataUrl) : ''
      evidenceMessage.value = '截图仅作为核对依据，不自动判定业务成功。'
    } else evidenceMessage.value = 'message' in result ? result.message : '当前授权没有这条截图的读取权限，请在平台核对。'
  })
}
async function prepareBatch(batchId: string) {
  if (!bridge) return
  const epoch = authEpoch
  await action(async () => {
    await workspace.init()
    if (epoch !== authEpoch) return
    const record = records.value.find(row => row.batchId === batchId)
    const tool = workspace.tools.find(item => String(item.id) === record?.toolId)
    if (!tool || !record) throw new Error('当前授权目录没有原工具，请刷新目录或联系支持。')
    workspace.chooseTool(tool)
    const preview = await workspace.selectImportFile()
    if (epoch !== authEpoch) return
    const toolVersion = typeof tool.tool_version === 'string' ? tool.tool_version : record.toolVersion
    const prepared = importPreviewSchema.parse(await bridge.prepare({ batchId, importId: preview.importId, toolId: record.toolId, toolVersion }))
    if (epoch !== authEpoch) return
    workspace.importPreview = prepared
    await router.push('/business/workspace')
  })
}
function clearForAuth() { authEpoch += 1; sequence += 1; records.value = []; reviewing.value = null; evidenceImage.value = ''; evidenceOpen.value = false; error.value = ''; helpOpen.value = false }
onMounted(() => { void load(); window.addEventListener('toolbox:auth-cleared', clearForAuth) })
onUnmounted(() => { clearForAuth(); window.removeEventListener('toolbox:auth-cleared', clearForAuth) })
watch(() => [props.batchId, props.runId], () => { void load() })
</script>

<style scoped>
.recovery-panel{margin:16px 0;padding:18px;border:1px solid var(--color-border,#dce3ed);border-radius:14px;background:var(--color-surface,#fff);color:var(--color-text,#273548)}header{display:flex;justify-content:space-between;gap:16px}h3{font-size:16px;margin:0 0 8px}p{font-size:13px;line-height:1.7;margin:6px 0;color:var(--color-text-secondary,#62718a)}button{font:inherit;font-size:12px;cursor:pointer;background:var(--color-surface,#fff);color:var(--color-primary,#2466c6);border:1px solid var(--color-border,#dce3ed);border-radius:8px;padding:8px 12px}button:disabled{cursor:not-allowed;opacity:.5}.recovery-row{margin-top:14px;padding-top:14px;border-top:1px solid var(--color-border,#dce3ed)}.recovery-summary{display:flex;flex-direction:column;gap:6px;font-size:13px}.recovery-summary span{font-size:12px;color:var(--color-text-secondary,#62718a)}.recovery-actions,footer{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.recovery-error,.recovery-warning{color:#a24c1e}.review-check{display:flex;align-items:center;gap:8px;line-height:1.6;margin:18px 0}.evidence-image{display:block;width:100%;height:auto;border-radius:8px}@media(max-width:600px){.recovery-panel{padding:12px}header{gap:8px}.recovery-actions button{flex:1 1 40%}}
</style>
