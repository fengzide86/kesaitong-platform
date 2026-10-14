<template>
  <div class="release-page">
    <PageHeader title="应用更新" subtitle="先完整校验发布文件，再由你确认把版本开放给桌面客户端">
      <template #actions>
        <router-link class="secondary-link" to="/admin/target-reviews">平台入口审核</router-link>
        <el-button type="primary" :disabled="Boolean(publishingVersion || deletingVersion)" @click="drawerOpen = true">暂存新版本</el-button>
      </template>
    </PageHeader>

    <section class="release-guide" aria-label="发布流程">
      <article><span>01</span><div><strong>选择发布文件</strong><p>系统会自动识别版本并核对安装文件。</p></div></article>
      <article><span>02</span><div><strong>人工确认</strong><p>暂存不会触达客户，可先核对文件和版本信息。</p></div></article>
      <article><span>03</span><div><strong>原子发布</strong><p>清单最后切换，客户端不会读到半发布状态。</p></div></article>
    </section>
    <section id="target-review" class="target-review-compat" aria-label="平台入口审核兼容入口">
      <div class="target-review-compat-header"><div><strong>平台入口审核</strong><p>兼容入口：审核平台网址与适配证据请进入产品与系统中的独立审核页。</p></div><router-link to="/admin/target-reviews">打开独立审核页</router-link></div>
      <TargetReviewPanel />
    </section>
    <AsyncStateNotice :state="loadState" :message="loadError" loading-text="正在加载更新版本…" @retry="load" />

    <AppSurface class="release-list">
      <DataToolbar label="桌面版本">
        <template #info><span>{{ releases.length }} 个版本</span></template>
        <template #actions><el-button :loading="loading" @click="load">刷新</el-button></template>
      </DataToolbar>

      <el-table v-if="loadState !== 'loading' && loadState !== 'error'" v-loading="loading" :data="releases" row-key="version">
        <el-table-column label="版本" min-width="150">
          <template #default="{ row }"><div class="version-cell"><strong>v{{ row.version }}</strong><small>{{ row.files.length }} 个发布文件</small><small v-if="row.published_at || row.staged_at">{{ row.published_at ? '发布于' : '暂存于' }} {{ formatDate(row.published_at || row.staged_at) }}</small></div></template>
        </el-table-column>
        <el-table-column v-if="!compact" label="文件" min-width="320">
          <template #default="{ row }"><div class="file-list"><span v-for="file in row.files" :key="file.name">{{ file.name }} · {{ formatBytes(file.size) }}</span></div></template>
        </el-table-column>
        <el-table-column label="状态" width="150">
          <template #default="{ row }"><StatusBadge :status="row.is_latest ? 'completed' : row.status === 'published' ? 'neutral' : 'warning'">{{ row.is_latest ? '当前更新版本' : row.status === 'published' ? '历史已发布' : '待发布' }}</StatusBadge></template>
        </el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button v-if="row.status === 'staged'" size="small" type="primary" :loading="publishingVersion === row.version" :disabled="Boolean(publishingVersion || deletingVersion)" @click="publish(row)">确认发布</el-button>
              <el-dropdown v-if="row.status === 'staged'" trigger="click" @command="remove(row)">
                <el-button size="small" :loading="deletingVersion === row.version" :disabled="Boolean(publishingVersion || deletingVersion)">更多</el-button>
                <template #dropdown><el-dropdown-menu><el-dropdown-item command="remove">删除暂存</el-dropdown-item></el-dropdown-menu></template>
              </el-dropdown>
              <span v-else class="published-note">{{ row.is_latest ? '客户端可检查到' : '保留历史记录' }}</span>
            </div>
          </template>
        </el-table-column>
        <template #empty><EmptyState :icon="PackageCheck" title="还没有桌面版本" description="上传完整的 electron-builder 发布文件后再确认发布" /></template>
      </el-table>
    </AppSurface>

    <el-drawer v-model="drawerOpen" size="min(560px, 94vw)" :show-close="!uploading" :close-on-click-modal="!uploading" :close-on-press-escape="!uploading">
      <template #header><div class="drawer-title"><p>安全发布</p><h2>暂存桌面更新</h2></div></template>
      <el-form label-position="top">
        <el-form-item label="发布文件">
          <el-upload v-model:file-list="fileList" drag multiple :auto-upload="false" :disabled="uploading" accept=".exe,.blockmap,.yml">
            <div class="upload-copy"><UploadCloud :size="24" /><strong>一次选择生成的发布文件</strong><small>需同时包含 Windows 安装文件、对应的 .blockmap 和 latest.yml</small></div>
          </el-upload>
        </el-form-item>
        <div class="security-note"><ShieldCheck :size="18" /><p><strong>发布前硬校验</strong><span>版本、文件名、大小、SHA-512 及 YAML 引用必须全部一致。</span></p></div>
        <section v-if="uploading || uploadMessage" class="upload-status" aria-live="polite">
          <strong>{{ uploadPhaseLabel }}</strong>
          <template v-if="uploading && uploadProgress.transferredBytes > 0">
            <el-progress v-if="uploadProgress.totalBytes" :percentage="Math.min(100, Math.floor(uploadProgress.transferredBytes / uploadProgress.totalBytes * 100))" />
            <p>{{ formatBytes(uploadProgress.transferredBytes) }}<template v-if="uploadProgress.totalBytes"> / {{ formatBytes(uploadProgress.totalBytes) }}</template> 已上传</p>
          </template>
          <p v-if="uploadMessage">{{ uploadMessage }}</p>
          <el-button v-if="!uploading && uncertainVersion" @click="recheckUncertain">重新核对版本状态</el-button>
          <el-button v-if="!uploading && uncertainVersion && manualRetryAvailable" @click="allowManualRetry">允许手动重试</el-button>
        </section>
      </el-form>
      <template #footer><div class="drawer-actions"><el-button v-if="uploading" :disabled="uploadPhase === 'checking' || uploadPhase === 'reconciling'" @click="cancelUpload">取消上传</el-button><el-button v-else @click="drawerOpen = false">关闭</el-button><el-button type="primary" :loading="uploading" :disabled="Boolean(uncertainVersion)" @click="stage">上传并校验</el-button></div></template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { UploadUserFile } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import { PackageCheck, ShieldCheck, UploadCloud } from '@lucide/vue'

import AppSurface from '@/components/AppSurface.vue'
import DataToolbar from '@/components/DataToolbar.vue'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import TargetReviewPanel from '@/features/targets/TargetReviewPanel.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import AsyncStateNotice from '@/components/AsyncStateNotice.vue'
import { useCompactLayout } from '@/composables/useCompactLayout'
import { listUpdateReleases, publishUpdateRelease, removeStagedUpdateRelease, stageUpdateRelease, type UpdateRelease } from '@/features/updates/release-api'
import { failedDataState, settledDataState, type AsyncDataState } from '@/features/async/state'
import { ApiError, type ApiUploadProgress } from '@/utils/api'
import { createReleaseUploadSession } from '@/features/updates/release-upload-session'

const uploadSession = createReleaseUploadSession()
const restoredUpload = uploadSession.read()
const compact = useCompactLayout()
const loading = ref(false)
const uploading = ref(false)
const publishingVersion = ref('')
const deletingVersion = ref('')
const drawerOpen = ref(Boolean(restoredUpload))
const releases = ref<UpdateRelease[]>([])
const loadState = ref<AsyncDataState>('loading')
const loadError = ref('')
const fileList = ref<UploadUserFile[]>([])
const uploadPhase = ref<'idle' | 'checking' | 'uploading' | 'validating' | 'reconciling'>('idle')
const uploadProgress = ref<ApiUploadProgress>({ transferredBytes: 0 })
const uploadMessage = ref(restoredUpload ? '上次上传结果仍待核对。请先重新核对版本状态，不会重复上传。' : '')
const uncertainVersion = ref(restoredUpload?.version || '')
const manualRetryAvailable = ref(false)
let uncertainSince = restoredUpload?.since || 0
let uploadController: AbortController | undefined
let disposed = false
const uploadPhaseLabel = computed(() => ({ idle: '上传状态', checking: '正在核对是否已有此版本', uploading: '正在上传发布文件', validating: '上传完成，正在等待服务端校验', reconciling: '正在回读版本状态' })[uploadPhase.value])

async function load(): Promise<void> {
  loading.value = true
  loadState.value = releases.value.length ? 'data' : 'loading'
  loadError.value = ''
  try {
    releases.value = await listUpdateReleases()
    loadState.value = settledDataState(releases.value.length)
  }
  catch (error) {
    loadError.value = error instanceof Error ? error.message : '更新版本加载失败'
    loadState.value = failedDataState(releases.value.length > 0)
  }
  finally { loading.value = false }
}

async function validateSelection(): Promise<{ files: File[]; version: string } | null> {
  const files = fileList.value.flatMap(item => item.raw ? [item.raw as File] : [])
  const manifest = files.find(file => file.name.toLowerCase() === 'latest.yml')
  const installer = files.find(file => file.name.toLowerCase().endsWith('.exe'))
  const blockmap = files.find(file => file.name.toLowerCase().endsWith('.blockmap'))
  if (!manifest || !installer || !blockmap) {
    ElMessage.warning('请同时选择 Windows 安装文件、对应的 .blockmap 和 latest.yml')
    return null
  }
  const version = (await manifest.text()).match(/^version:\s*["']?([^\s"']+)/m)?.[1]
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) { ElMessage.warning('版本清单中没有有效的版本号'); return null }
  return { files, version }
}

async function stage(): Promise<void> {
  if (uploading.value || uncertainVersion.value) return
  const pending = uploadSession.read()
  if (pending) {
    uncertainVersion.value = pending.version
    uncertainSince = pending.since
    uploadMessage.value = '已有上传结果待核对，请先重新核对版本状态。'
    return
  }
  uploading.value = true
  uploadMessage.value = ''
  uploadProgress.value = { transferredBytes: 0 }
  uploadPhase.value = 'checking'
  let selectedVersion = ''
  try {
    const selection = await validateSelection()
    if (!selection) return
    selectedVersion = selection.version
    releases.value = await listUpdateReleases()
    if (disposed || !uploadSession.isCurrent()) return
    if (releases.value.some(release => release.version === selection.version)) {
      uploadMessage.value = `v${selection.version} 已有记录，请核对版本列表；没有重复上传。`
      return
    }
    uploadController = new AbortController()
    uploadSession.remember(selection.version)
    uploadPhase.value = 'uploading'
    await stageUpdateRelease(selection.files, selection.version, {
      signal: uploadController.signal,
      onProgress: progress => {
        if (disposed || !uploadSession.isCurrent()) return
        uploadProgress.value = progress
        if (progress.totalBytes && progress.transferredBytes >= progress.totalBytes) uploadPhase.value = 'validating'
      },
    })
    uploadSession.clear(selection.version)
    if (disposed || !uploadSession.isCurrent()) return
    ElMessage.success(`v${selection.version} 已暂存并完成一致性校验`)
    drawerOpen.value = false
    fileList.value = []
    await load()
  } catch (error) {
    if (disposed || !uploadSession.isCurrent()) return
    if (selectedVersion && uploadController && (!(error instanceof ApiError) || ['timeout', 'network', 'cancelled', 'parse'].includes(error.kind) || error.status >= 500 || error.status === 409)) {
      uncertainVersion.value = selectedVersion
      uncertainSince = Date.now()
      uploadSession.remember(selectedVersion)
      manualRetryAvailable.value = false
      uploadMessage.value = `${error instanceof ApiError && error.kind === 'cancelled' ? '上传已取消' : '上传响应未确认'}。正在核对服务器是否已暂存，不会自动重复上传。`
      await reconcileVersion(selectedVersion)
    } else {
      uploadSession.clear(selectedVersion)
      uploadMessage.value = error instanceof Error ? error.message : '暂存失败'
      ElMessage.error(uploadMessage.value)
    }
  }
  finally { uploading.value = false; uploadController = undefined; uploadPhase.value = 'idle' }
}

function cancelUpload(): void { uploadController?.abort() }

async function reconcileVersion(version: string): Promise<void> {
  uploadPhase.value = 'reconciling'
  try {
    releases.value = await listUpdateReleases()
    if (disposed || !uploadSession.isCurrent()) return
    const existing = releases.value.find(release => release.version === version)
    loadState.value = settledDataState(releases.value.length)
    if (existing) {
      uncertainVersion.value = ''
      uploadSession.clear(version)
    }
    manualRetryAvailable.value = !existing && Date.now() - uncertainSince >= 30_000
    uploadMessage.value = existing
      ? `已找到 v${version} 的${existing.status === 'published' ? '发布' : '暂存'}记录，请核对列表中的文件。没有再次上传。`
      : manualRetryAvailable.value
        ? '再次核对仍未找到该版本。原请求仍可能在处理，可继续等待核对，或明确选择允许手动重试；不会自动重传。'
        : '目前没有找到该版本的暂存记录，但原请求可能仍在处理。请至少等待 30 秒后重新核对，不要立即重复上传。'
  } catch {
    manualRetryAvailable.value = false
    uploadMessage.value = '暂时无法确认服务器是否已暂存。请先重新核对版本状态，避免重复上传。'
  }
}

async function allowManualRetry(): Promise<void> {
  if (!manualRetryAvailable.value || uploading.value) return
  try {
    await ElMessageBox.confirm('原请求仍可能在服务端处理。允许重试不会立即上传，下一次上传前还会核对版本；已有同版本不会被覆盖。', '允许手动重试此版本？', { confirmButtonText: '允许手动重试', cancelButtonText: '继续等待核对', type: 'warning' })
    if (disposed || !uploadSession.isCurrent()) return
    uploadSession.clear(uncertainVersion.value)
    uncertainVersion.value = ''
    manualRetryAvailable.value = false
    uploadMessage.value = '已允许手动重试。请核对文件后重新点击上传；提交前仍会检查同版本记录。'
  } catch { /* Keep the uncertain-result guard until explicitly acknowledged. */ }
}

async function recheckUncertain(): Promise<void> {
  if (!uncertainVersion.value || uploading.value) return
  uploading.value = true
  try { await reconcileVersion(uncertainVersion.value) }
  finally { uploading.value = false; uploadPhase.value = 'idle' }
}

async function publish(raw: unknown): Promise<void> {
  const row = raw as UpdateRelease
  try {
    await ElMessageBox.confirm(`发布 v${row.version} 后，桌面客户端即可检查到该版本。`, '确认发布更新', { confirmButtonText: '确认发布', cancelButtonText: '继续核对', type: 'warning' })
    publishingVersion.value = row.version
    await publishUpdateRelease(row.version)
    ElMessage.success(`v${row.version} 已发布`)
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '发布失败，请刷新后核对版本状态')
  } finally {
    publishingVersion.value = ''
    await load()
  }
}

async function remove(raw: unknown): Promise<void> {
  const row = raw as UpdateRelease
  try {
    await ElMessageBox.confirm(`只删除 v${row.version} 的暂存文件，不影响已发布版本。`, '删除暂存版本', { confirmButtonText: '删除暂存', cancelButtonText: '取消', type: 'warning' })
    deletingVersion.value = row.version
    await removeStagedUpdateRelease(row.version)
    ElMessage.success('暂存版本已删除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '删除失败，请刷新后重试')
  } finally {
    deletingVersion.value = ''
    await load()
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未提供' : date.toLocaleString('zh-CN', { hour12: false })
}

onMounted(load)
onBeforeUnmount(() => { disposed = true; uploadController?.abort() })
</script>

<style scoped>
.release-page{display:grid;gap:18px}.release-guide{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.release-guide article{display:flex;gap:13px;min-height:90px;padding:17px;border:1px solid var(--color-border);border-radius:14px;background:var(--color-surface)}.release-guide article>span{color:var(--color-primary);font-size:var(--type-meta);font-weight:800;letter-spacing:.08em}.release-guide div{display:grid;align-content:start;gap:5px}.release-guide strong{color:var(--color-text);font-size:var(--type-control)}.release-guide p{margin:0;color:var(--color-text-secondary);font-size:var(--type-meta);line-height:1.6}.target-review-compat{display:grid;gap:10px}.target-review-compat-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 17px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface-soft)}.target-review-compat-header strong{color:var(--color-text);font-size:var(--type-control)}.target-review-compat-header p{margin:4px 0 0;color:var(--color-text-secondary);font-size:var(--type-meta);line-height:1.5}.target-review-compat-header a{flex:0 0 auto;color:var(--color-primary);font-size:var(--type-control);font-weight:700;text-decoration:none}.release-list{padding:0;overflow:hidden}.release-list :deep(.data-toolbar){margin:0;padding:14px 16px;border-bottom:1px solid var(--color-border)}.version-cell{display:grid;gap:4px}.version-cell strong{font-size:14px}.version-cell small,.published-note{color:var(--color-text-secondary);font-size:var(--type-meta)}.file-list{display:grid;gap:4px;color:var(--color-text-secondary);font-size:var(--type-meta)}.row-actions{display:flex;align-items:center;gap:7px}.drawer-title p{margin:0;color:var(--color-primary);font-size:var(--type-micro);font-weight:800;letter-spacing:.15em}.drawer-title h2{margin:4px 0 0;font-size:21px}.upload-copy{display:grid;justify-items:center;gap:7px;padding:15px;color:var(--color-text-secondary)}.upload-copy strong{color:var(--color-text);font-size:var(--type-control)}.upload-copy small{font-size:var(--type-meta)}.security-note{display:flex;gap:11px;padding:14px;border:1px solid rgba(45,95,202,.18);border-radius:12px;background:var(--color-primary-soft);color:var(--color-primary)}.security-note p{display:grid;gap:3px;margin:0}.security-note strong{font-size:var(--type-meta)}.security-note span{color:var(--color-text-secondary);font-size:var(--type-meta);line-height:1.5}.drawer-actions{display:flex;justify-content:flex-end;gap:8px}@media(max-width:900px){.release-guide{grid-template-columns:1fr}.release-guide article{min-height:auto}}@media(max-width:760px){.release-list :deep(.el-table__fixed-right){position:static!important}}@media(max-width:620px){.target-review-compat-header{align-items:flex-start;flex-direction:column}}
</style>

<style scoped>
.upload-status{margin-top:16px;padding:14px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-surface-soft);color:var(--color-text);font-size:var(--type-control)}
.upload-status p{margin:8px 0;color:var(--color-text-secondary);line-height:1.6;overflow-wrap:anywhere}.upload-status :deep(.el-progress){margin-top:12px}.drawer-actions{flex-wrap:wrap}
</style>
