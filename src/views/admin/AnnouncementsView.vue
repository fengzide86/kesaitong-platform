<template>
  <div class="announcement-admin">
    <PageHeader title="公告管理" subtitle="查找已发消息，或向指定用户发布使用提醒。">
      <template #actions><el-button v-if="canWrite" type="primary" @click="openCreate">新建公告</el-button></template>
    </PageHeader>

    <AsyncStateNotice :state="loadState" :message="loadError" loading-text="正在加载公告…" @retry="load" />

    <AppSurface v-if="loadState !== 'loading' && loadState !== 'error'" class="announcement-table" tone="default">
      <DataToolbar label="公告筛选">
        <el-input v-model="filters.keyword" class="announcement-search" aria-label="搜索公告" placeholder="搜索标题或内容" clearable />
        <el-select v-model="filters.status" aria-label="公告状态" placeholder="全部状态" clearable><el-option label="草稿" value="draft" /><el-option label="已发布" value="published" /><el-option label="已过期" value="expired" /></el-select>
        <el-select v-model="filters.audience" aria-label="公告人群" placeholder="全部人群" clearable><el-option label="全部用户" value="all" /><el-option label="个人工具箱" value="consumer" /><el-option label="批量工作台" value="business" /></el-select>
        <el-select v-model="filters.category" aria-label="公告类别" placeholder="全部类别" clearable><el-option v-for="option in categoryOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select>
        <template #summary><span>{{ hasFilters ? `找到 ${filtered.length} 条 · 共 ${items.length} 条` : `共 ${items.length} 条公告` }}</span></template>
        <template #actions><el-button :loading="loading" @click="load">刷新</el-button></template>
      </DataToolbar>

      <el-table :data="filtered" v-loading="loading" row-key="id" @row-click="showDetails">
        <el-table-column label="公告" min-width="260">
          <template #default="{ row }"><div class="title-cell"><span v-if="!row.is_read" /><strong>{{ row.title }}</strong><small>{{ row.content }}</small></div></template>
        </el-table-column>
        <el-table-column prop="audience" label="人群" width="140"><template #default="{ row }"><StatusBadge :status="audienceTone(row.audience)">{{ audienceLabel(row.audience) }}</StatusBadge></template></el-table-column>
        <el-table-column v-if="!compact" prop="category" label="类别" width="110"><template #default="{ row }">{{ categoryLabel(row.category) }}</template></el-table-column>
        <el-table-column v-if="!compact" prop="severity" label="级别" width="100"><template #default="{ row }"><StatusBadge :status="severityTone(row.severity)">{{ severityLabel(row.severity) }}</StatusBadge></template></el-table-column>
        <el-table-column prop="status" label="状态" width="120"><template #default="{ row }"><StatusBadge :status="statusTone(row.status)">{{ statusLabel(row.status) }}</StatusBadge></template></el-table-column>
        <el-table-column v-if="!compact" label="生效时间" width="170"><template #default="{ row }">{{ formatDate(row.starts_at || row.published_at || row.created_at) }}</template></el-table-column>
        <el-table-column v-if="canWrite" label="操作" width="104" fixed="right">
          <template #default="{ row }">
            <el-dropdown trigger="click" @command="command => handleCommand(command, row)" @click.stop>
              <el-button size="small">处理</el-button>
              <template #dropdown><el-dropdown-menu><el-dropdown-item command="edit">编辑</el-dropdown-item><el-dropdown-item command="toggle">{{ row.status === 'published' ? '转为草稿' : '立即发布' }}</el-dropdown-item><el-dropdown-item command="delete" divided>删除</el-dropdown-item></el-dropdown-menu></template>
            </el-dropdown>
          </template>
        </el-table-column>
        <template #empty><EmptyState :icon="Megaphone" :title="hasFilters ? '没有匹配的公告' : '还没有公告'" :description="hasFilters ? '试试其他关键词或清除筛选，原公告不会被删除。' : '发布使用提醒后，可以在这里查看和管理。'"><el-button v-if="hasFilters" class="clear-filters" @click="clearFilters">清除筛选</el-button></EmptyState></template>
      </el-table>
    </AppSurface>

    <el-drawer v-model="editorOpen" size="min(680px, 94vw)" :close-on-click-modal="false" destroy-on-close>
      <template #header><div class="drawer-heading"><p>公告编辑</p><h2>{{ form.id ? '编辑公告' : '新建公告' }}</h2></div></template>
      <el-form label-position="top" class="composer-form">
        <div class="form-grid form-grid--2">
          <el-form-item label="发布人群"><el-segmented v-model="form.audience" :options="audienceOptions" /></el-form-item>
          <el-form-item label="消息类别"><el-select v-model="form.category"><el-option v-for="option in categoryOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select></el-form-item>
          <el-form-item label="重要级别"><el-select v-model="form.severity" @change="normalizePresentation"><el-option label="普通信息" value="info" /><el-option label="重要提醒" value="important" /><el-option label="关键通知" value="critical" /></el-select></el-form-item>
          <el-form-item label="呈现方式"><el-select v-model="form.presentation" :disabled="form.severity === 'critical'"><el-option label="页面横幅" value="banner" /><el-option label="确认弹窗" value="modal" /></el-select></el-form-item>
        </div>
        <el-form-item label="标题"><el-input v-model="form.title" maxlength="200" show-word-limit placeholder="一句话说明用户为什么需要关注" /></el-form-item>
        <el-form-item label="正文"><el-input v-model="form.content" type="textarea" :rows="6" maxlength="10000" show-word-limit placeholder="只说明事实、影响和用户需要采取的行动" /></el-form-item>
        <el-form-item v-if="form.category === 'update'" label="关联应用版本"><el-input v-model="form.app_version" placeholder="例如 1.8.0" /></el-form-item>
        <div class="form-grid form-grid--2">
          <el-form-item label="开始生效"><el-date-picker v-model="form.starts_at" type="datetime" placeholder="立即生效可留空" /></el-form-item>
          <el-form-item label="到期时间"><el-date-picker v-model="form.expires_at" type="datetime" placeholder="长期有效可留空" /></el-form-item>
        </div>

        <section class="preview-section">
          <div class="preview-title"><span>双端预览</span><small>实际仅投放给所选人群</small></div>
          <div class="preview-grid">
            <article :class="['preview-card', { muted: form.audience === 'business' }]">
              <label>个人工具箱</label><strong>{{ form.title || '公告标题' }}</strong><p>{{ form.content || '公告正文会在这里呈现。' }}</p>
            </article>
            <article :class="['preview-card', 'business', { muted: form.audience === 'consumer' }]">
              <label>批量工作台</label><strong>{{ form.title || '公告标题' }}</strong><p>{{ form.content || '公告正文会在这里呈现。' }}</p>
            </article>
          </div>
        </section>
      </el-form>
      <template #footer>
        <div class="drawer-actions"><el-button @click="editorOpen = false">取消</el-button><el-button :loading="saving" @click="save('draft')">保存草稿</el-button><el-button type="primary" :loading="saving" @click="save('published')">{{ form.starts_at ? '安排发布' : '立即发布' }}</el-button></div>
      </template>
    </el-drawer>

    <AdminDetailDrawer v-model="detailOpen" title="公告详情">
      <div v-if="detail" class="detail-grid">
        <div><span>标题</span><strong>{{ detail.title }}</strong></div><div><span>投放人群</span><strong>{{ audienceLabel(detail.audience) }}</strong></div>
        <div><span>类别</span><strong>{{ categoryLabel(detail.category) }}</strong></div><div><span>内容版本</span><strong>第 {{ detail.revision }} 版</strong></div>
        <div class="detail-content"><span>正文</span><p>{{ detail.content }}</p></div>
      </div>
    </AdminDetailDrawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { Megaphone } from '@lucide/vue'

import AdminDetailDrawer from '@/components/AdminDetailDrawer.vue'
import AppSurface from '@/components/AppSurface.vue'
import DataToolbar from '@/components/DataToolbar.vue'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import AsyncStateNotice from '@/components/AsyncStateNotice.vue'
import { createAnnouncement, deleteAnnouncement, getAnnouncements, updateAnnouncement } from '@/utils/api'
import { useCompactLayout } from '@/composables/useCompactLayout'
import { hasStaffPermission } from '@/features/auth/permissions'
import { authService } from '@/utils/auth'
import { failedDataState, settledDataState, type AsyncDataState } from '@/features/async/state'

type Audience = 'all' | 'consumer' | 'business'
type Category = 'system' | 'update' | 'activity' | 'maintenance'
type Severity = 'info' | 'important' | 'critical'
type Presentation = 'banner' | 'modal'
type AnnouncementStatus = 'draft' | 'published' | 'expired'
interface AnnouncementRow { id: number; title: string; content: string; audience: Audience; category: Category; severity: Severity; presentation: Presentation; status: AnnouncementStatus; priority: number; revision: number; app_version?: string | null; starts_at?: string | null; expires_at?: string | null; published_at?: string | null; created_at?: string | null; is_read?: boolean }
interface AnnouncementForm { id: number | null; title: string; content: string; audience: Audience; category: Category; severity: Severity; presentation: Presentation; app_version: string; starts_at: Date | null; expires_at: Date | null }

const compact = useCompactLayout()
const canWrite = computed(() => hasStaffPermission(authService.getRole(), 'announcements.write'))
const loading = ref(false), saving = ref(false), editorOpen = ref(false), detailOpen = ref(false)
const items = ref<AnnouncementRow[]>([]), detail = ref<AnnouncementRow | null>(null)
const loadState = ref<AsyncDataState>('loading')
const loadError = ref('')
const filters = reactive<{ keyword: string; status: AnnouncementStatus | ''; audience: Audience | ''; category: Category | '' }>({ keyword: '', status: '', audience: '', category: '' })
const emptyForm = (): AnnouncementForm => ({ id: null, title: '', content: '', audience: 'all', category: 'system', severity: 'important', presentation: 'modal', app_version: '', starts_at: null, expires_at: null })
const form = reactive<AnnouncementForm>(emptyForm())
const audienceOptions = [{ label: '全部用户', value: 'all' }, { label: '个人工具箱', value: 'consumer' }, { label: '批量工作台', value: 'business' }]
const categoryOptions: Array<{ label: string; value: Category }> = [{ label: '系统消息', value: 'system' }, { label: '版本更新', value: 'update' }, { label: '活动通知', value: 'activity' }, { label: '维护通知', value: 'maintenance' }]
const hasFilters = computed(() => Boolean(filters.keyword.trim() || filters.status || filters.audience || filters.category))
const filtered = computed(() => {
  const keyword = filters.keyword.trim().toLocaleLowerCase()
  return items.value.filter(item => (!keyword || `${item.title} ${item.content}`.toLocaleLowerCase().includes(keyword)) && (!filters.status || item.status === filters.status) && (!filters.audience || item.audience === filters.audience) && (!filters.category || item.category === filters.category))
})
function clearFilters(): void { Object.assign(filters, { keyword: '', status: '', audience: '', category: '' }) }

async function load(): Promise<void> {
  loading.value = true
  loadState.value = items.value.length ? 'data' : 'loading'
  loadError.value = ''
  try {
    items.value = (await getAnnouncements()) as AnnouncementRow[]
    loadState.value = settledDataState(items.value.length)
  } catch (error) {
    loadError.value = error instanceof Error && error.message ? error.message : '公告暂时无法加载'
    loadState.value = failedDataState(items.value.length > 0)
  } finally {
    loading.value = false
  }
}
function resetForm(value?: AnnouncementRow): void { Object.assign(form, emptyForm(), value ? { ...value, starts_at: value.starts_at ? new Date(value.starts_at) : null, expires_at: value.expires_at ? new Date(value.expires_at) : null, app_version: value.app_version || '' } : {}) }
function openCreate(): void { if (!canWrite.value) return; resetForm(); editorOpen.value = true }
function openEdit(row: AnnouncementRow): void { if (!canWrite.value) return; resetForm(row); editorOpen.value = true }
function showDetails(row: Record<string, unknown>): void {
  if (typeof row.id !== 'number' || typeof row.title !== 'string') return
  detail.value = row as unknown as AnnouncementRow
  detailOpen.value = true
}
function normalizePresentation(): void { if (form.severity === 'critical') form.presentation = 'modal' }
async function save(status: 'draft' | 'published'): Promise<void> {
  if (!canWrite.value) return
  if (!form.title.trim() || !form.content.trim()) { ElMessage.warning('请填写标题和正文'); return }
  if (form.category === 'update' && form.app_version && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(form.app_version)) { ElMessage.warning('应用版本请使用 SemVer，例如 1.8.0'); return }
  saving.value = true
  const payload = { title: form.title, content: form.content, audience: form.audience, category: form.category, severity: form.severity, presentation: form.presentation, app_version: form.app_version || null, starts_at: form.starts_at?.toISOString() || null, expires_at: form.expires_at?.toISOString() || null, status }
  try { if (form.id) await updateAnnouncement(form.id, payload); else await createAnnouncement(payload); editorOpen.value = false; ElMessage.success(status === 'published' ? '公告已发布' : '草稿已保存'); await load() } finally { saving.value = false }
}
async function handleCommand(command: string, rawRow: Record<string, unknown>): Promise<void> {
  if (!canWrite.value) return
  if (typeof rawRow.id !== 'number' || typeof rawRow.status !== 'string') return
  const row = rawRow as unknown as AnnouncementRow
  if (command === 'edit') openEdit(row)
  else if (command === 'toggle') { await updateAnnouncement(row.id, { status: row.status === 'published' ? 'draft' : 'published' }); await load() }
  else if (command === 'delete') { await ElMessageBox.confirm('删除后用户将无法再查看这条公告。', '删除公告？', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }); await deleteAnnouncement(row.id); await load() }
}
const audienceLabel = (value: Audience) => ({ all: '全部用户', consumer: '个人工具箱', business: '批量工作台' })[value]
const categoryLabel = (value: Category) => ({ system: '系统', update: '版本更新', activity: '活动', maintenance: '维护' })[value]
const severityLabel = (value: Severity) => ({ info: '普通', important: '重要', critical: '关键' })[value]
const statusLabel = (value: AnnouncementStatus) => ({ draft: '草稿', published: '已发布', expired: '已过期' })[value]
const audienceTone = (value: Audience) => value === 'business' ? 'warning' : value === 'consumer' ? 'running' : 'neutral'
const severityTone = (value: Severity) => value === 'critical' ? 'failed' : value === 'important' ? 'warning' : 'neutral'
const statusTone = (value: AnnouncementStatus) => value === 'published' ? 'completed' : value === 'expired' ? 'failed' : 'neutral'
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '立即生效'
onMounted(load)
</script>

<style scoped>
.announcement-admin{display:grid;gap:18px}.announcement-table{padding:0;overflow:hidden}.announcement-table :deep(.el-select){width:138px}.title-cell{position:relative;display:grid;gap:4px;min-width:0;padding-left:12px}.title-cell>span{position:absolute;left:1px;top:7px;width:5px;height:5px;border-radius:50%;background:var(--color-primary)}.title-cell strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.title-cell small{overflow:hidden;color:var(--color-text-secondary);text-overflow:ellipsis;white-space:nowrap}.drawer-heading p{margin:0;color:var(--color-primary);font-size:var(--type-micro);font-weight:800;letter-spacing:.15em}.drawer-heading h2{margin:4px 0 0;color:var(--color-text);font-size:21px}.composer-form{padding-right:4px}.form-grid{display:grid;gap:0 14px}.form-grid--2{grid-template-columns:repeat(2,minmax(0,1fr))}.composer-form :deep(.el-select),.composer-form :deep(.el-date-editor),.composer-form :deep(.el-segmented){width:100%}.preview-section{margin-top:8px;padding-top:20px;border-top:1px solid var(--color-border)}.preview-title{display:flex;justify-content:space-between;margin-bottom:12px}.preview-title span{font-size:13px;font-weight:750}.preview-title small{color:var(--color-text-secondary)}.preview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.preview-card{display:grid;gap:7px;min-height:140px;padding:15px;border:1px solid rgba(45,95,202,.2);border-radius:13px;background:linear-gradient(145deg,var(--color-primary-soft),var(--color-surface) 64%)}.preview-card.business{border-color:rgba(169,133,82,.26);background:linear-gradient(145deg,var(--color-premium-soft),var(--color-surface) 64%)}.preview-card.muted{opacity:.42}.preview-card label{color:var(--color-primary);font-size:var(--type-micro);font-weight:800;letter-spacing:.05em}.preview-card.business label{color:var(--color-primary)}.preview-card strong{font-size:14px}.preview-card p{margin:0;color:var(--color-text-secondary);font-size:var(--type-meta);line-height:1.6;white-space:pre-wrap}.drawer-actions{display:flex;justify-content:flex-end;gap:8px}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.detail-grid>div{display:grid;gap:5px;padding:12px;border-radius:10px;background:var(--color-canvas)}.detail-grid span{color:var(--color-text-secondary);font-size:var(--type-meta)}.detail-content{grid-column:1/-1}.detail-content p{margin:0;line-height:1.7;white-space:pre-wrap}@media(max-width:760px){.form-grid--2,.preview-grid{grid-template-columns:1fr}.detail-grid{grid-template-columns:1fr}}
</style>

<style scoped>
.announcement-table :deep(.data-toolbar-v6) {
  margin: 0;
  padding: 18px 20px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.announcement-table :deep(.data-toolbar-v6__filters) { flex-wrap: wrap; gap: 10px; }
.announcement-search { width: 220px; }
.announcement-table :deep(.el-table .cell) { padding-left: 20px; padding-right: 20px; }
.announcement-table :deep(.el-table__cell) { padding-top: 14px; padding-bottom: 14px; }
.clear-filters { margin-top: 16px; }
</style>
