<template>
  <div>
    <PageHeader title="知识库管理" description="维护固定的工具帮助内容、关键词与适用范围">
      <template #actions>
        <el-button type="primary" @click="openCreate">+ 新建条目</el-button>
      </template>
    </PageHeader>
    <AsyncStateNotice :state="loadState" :message="loadError" loading-text="正在加载知识库…" @retry="loadInitial" />

    <!-- 统计 -->
    <section v-if="loadState !== 'loading' && loadState !== 'error'" class="knowledge-stats" aria-label="知识库统计">
      <article class="stat-card">
          <div class="stat-value">{{ metaHasLoaded ? stats.total : '—' }}</div>
          <div class="stat-label">总条目</div>
      </article>
      <article class="stat-card">
          <div class="stat-value">{{ metaHasLoaded ? stats.active : '—' }}</div>
          <div class="stat-label">已启用</div>
      </article>
      <article class="stat-card">
          <div class="stat-value">{{ metaHasLoaded ? stats.categories : '—' }}</div>
          <div class="stat-label">分类数</div>
      </article>
    </section>
    <AsyncStateNotice
      v-if="loadState !== 'loading' && loadState !== 'error'"
      :state="metaState"
      :message="metaError"
      loading-text="正在加载知识库统计…"
      error-title="知识库统计暂时无法加载"
      @retry="loadMeta"
    />

    <!-- 筛选 -->
    <DataToolbar v-if="loadState !== 'loading' && loadState !== 'error'" label="知识库筛选">
      <el-select v-model="filterCategory" placeholder="全部分类" clearable @change="applyFilters" style="width: 200px;">
        <el-option 
          v-for="cat in categories" 
          :key="cat.name" 
          :label="`${cat.name} (${cat.count})`" 
          :value="cat.name"
        />
      </el-select>
      <el-input 
        v-model="searchKeyword" 
        placeholder="搜索标题/内容..." 
        clearable
        @keyup.enter="applyFilters"
        @clear="applyFilters"
        style="width: 250px;"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <template #summary>共 {{ total }} 条</template>
    </DataToolbar>

    <!-- 列表 -->
    <el-card v-if="loadState !== 'loading' && loadState !== 'error'" class="table-card" shadow="never">
      <el-table :data="list" stripe style="width: 100%">
        <el-table-column prop="title" label="标题" min-width="250" show-overflow-tooltip />
        <el-table-column v-if="!isCompact" prop="id" label="ID" width="80" />
        <el-table-column v-if="!isCompact" prop="category" label="分类" width="120" />
        <el-table-column v-if="!isCompact" label="优先级" width="100">
          <template #default="{ row }">
            <el-tag 
              :type="row.priority === 'high' ? 'danger' : row.priority === 'low' ? 'info' : 'warning'" 
              size="small"
            >
              {{ row.priority === 'high' ? '高' : row.priority === 'low' ? '低' : '中' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'" size="small">
              {{ row.status === 'active' ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" prop="view_count" label="查看" width="80" />
        <el-table-column label="操作" :width="isCompact ? 136 : 180" fixed="right">
          <template #default="{ row }">
            <template v-if="isCompact">
              <el-button size="small" @click="openKnowledgeDetail(row)">详情</el-button>
              <el-dropdown trigger="click" @command="command => handleKnowledgeCommand(command, row)">
                <el-button size="small">更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit">编辑</el-dropdown-item>
                    <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
            <template v-else>
              <el-button size="small" @click="openEdit(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="handleDelete(row)">删除</el-button>
            </template>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-state">暂无数据</div>
        </template>
      </el-table>
    </el-card>

    <!-- 分页 -->
    <div v-if="total > pageSize" class="pagination-wrapper">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        @current-change="loadData"
      />
    </div>

    <AdminDetailDrawer v-model="showDetailDrawer" title="知识条目详情">
      <div v-if="detailItem" class="detail-list">
        <div><span>标题</span><strong>{{ detailItem.title }}</strong></div>
        <div><span>分类</span><strong>{{ detailItem.category || '-' }}</strong></div>
        <div><span>状态</span><strong>{{ detailItem.status === 'active' ? '启用' : '停用' }}</strong></div>
        <div><span>优先级</span><strong>{{ detailItem.priority || '-' }}</strong></div>
        <div><span>查看次数</span><strong>{{ detailItem.view_count || 0 }}</strong></div>
        <div class="detail-content"><span>内容</span><p>{{ detailItem.content }}</p></div>
      </div>
      <template #footer><el-button @click="showDetailDrawer = false">关闭</el-button></template>
    </AdminDetailDrawer>

    <!-- 编辑弹窗 -->
    <el-dialog 
      v-model="showModal" 
      :title="editingId ? '编辑知识条目' : '新建知识条目'" 
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form label-width="120px">
        <el-form-item label="分类">
          <el-select v-model="form.category" style="width: 100%;">
            <el-option v-for="cat in allCategories" :key="cat" :label="cat" :value="cat" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="form.title" placeholder="输入标题" />
        </el-form-item>
        <el-form-item label="优先级">
          <el-radio-group v-model="form.priority">
            <el-radio label="high">高</el-radio>
            <el-radio label="medium">中</el-radio>
            <el-radio label="low">低</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="keywordsStr" placeholder="如：安装,报错,0x80070005（逗号分隔）" />
        </el-form-item>
        <el-form-item label="内容">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="10"
            placeholder="输入内容（支持 Markdown）..."
            style="font-family: monospace;"
          />
        </el-form-item>
        <el-form-item v-if="editingId" label="状态">
          <el-select v-model="form.status" style="width: 100%;">
            <el-option label="启用" value="active" />
            <el-option label="禁用" value="disabled" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showModal = false">取消</el-button>
        <el-button type="primary" @click="submitForm" :loading="submitting">
          {{ submitting ? '保存中...' : '保存' }}
        </el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { getKnowledgeList, getKnowledgeCategories, getKnowledgeStats, createKnowledge, updateKnowledge, deleteKnowledge } from '@/utils/api'
import { showToast } from '@/utils'
import { usePlatformStore } from '@/stores/platform'
import { useCompactLayout } from '@/composables/useCompactLayout'
import PageHeader from '@/components/PageHeader.vue'
import DataToolbar from '@/components/DataToolbar.vue'
import AdminDetailDrawer from '@/components/AdminDetailDrawer.vue'
import AsyncStateNotice from '@/components/AsyncStateNotice.vue'
import { Search } from '@element-plus/icons-vue'
import { confirmAction } from '@/shared/ui/confirm'
import { failedDataState, settledDataState, type AsyncDataState } from '@/features/async/state'
import {
  knowledgeCategoriesSchema,
  knowledgeItemSchema,
  knowledgeListSchema,
  knowledgeStatsSchema,
  type KnowledgeItem,
} from '@/features/admin/model'

const platformStore = usePlatformStore()
const isCompact = useCompactLayout()

const list = ref<KnowledgeItem[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const filterCategory = ref('')
const searchKeyword = ref('')
const categories = ref<Array<{ name: string; count: number }>>([])
const stats = ref(knowledgeStatsSchema.parse({}))
const showModal = ref(false)
const editingId = ref<string | number | null>(null)
const submitting = ref(false)
const keywordsStr = ref('')
const showDetailDrawer = ref(false)
const detailItem = ref<KnowledgeItem | null>(null)
const loadState = ref<AsyncDataState>('loading')
const loadError = ref('')
const metaState = ref<AsyncDataState>('loading')
const metaError = ref('')
const metaHasLoaded = ref(false)
let listSequence = 0
let active = true
function applyFilters() { page.value = 1; void loadData() }
watch(() => platformStore.adminPlatform, applyFilters)
onUnmounted(() => { active = false; listSequence += 1 })

const allCategories = ['安装教程', '授权说明', '使用教程', '报错处理', '套餐说明', '退款规则', '比赛须知', '其他']

const form = ref({
  category: '安装教程',
  title: '',
  content: '',
  priority: 'medium',
  status: 'active',
  platform_key: '',
  capability_key: '',
})

async function loadData() {
  const sequence = ++listSequence
  loadState.value = list.value.length ? 'data' : 'loading'
  loadError.value = ''
  try {
    const params: Record<string, string | number> = { page: page.value, page_size: pageSize }
    if (filterCategory.value) params.category = filterCategory.value
    if (searchKeyword.value) params.keyword = searchKeyword.value
    const pk = platformStore.adminPlatform
    if (pk && pk !== 'all') params.platform_key = pk
    const result = knowledgeListSchema.parse(await getKnowledgeList(params))
    if (!active || sequence !== listSequence) return
    const lastPage = Math.max(1, Math.ceil(result.total / pageSize))
    if (page.value > lastPage) { page.value = lastPage; await loadData(); return }
    list.value = result.items
    total.value = result.total
    loadState.value = settledDataState(result.items.length)
  } catch (error) {
    if (!active || sequence !== listSequence) return
    loadError.value = error instanceof Error && error.message ? error.message : '知识库列表暂时无法加载'
    loadState.value = failedDataState(list.value.length > 0)
  }
}

async function loadMeta() {
  metaState.value = metaHasLoaded.value ? 'data' : 'loading'
  metaError.value = ''
  try {
    const [cats, st] = await Promise.all([getKnowledgeCategories(), getKnowledgeStats()])
    categories.value = knowledgeCategoriesSchema.parse(cats)
    stats.value = knowledgeStatsSchema.parse(st)
    metaHasLoaded.value = true
    metaState.value = 'data'
  } catch (error) {
    metaError.value = error instanceof Error && error.message ? error.message : '知识库统计暂时无法更新'
    metaState.value = failedDataState(metaHasLoaded.value)
  }
}

async function loadInitial() {
  await Promise.allSettled([loadData(), loadMeta()])
}

function openCreate() {
  editingId.value = null
  const pk = platformStore.adminPlatform
  form.value = { category: '安装教程', title: '', content: '', priority: 'medium', status: 'active', platform_key: (pk && pk !== 'all') ? pk : '', capability_key: '' }
  keywordsStr.value = ''
  showModal.value = true
}

function openEdit(rawItem: unknown) {
  const item = knowledgeItemSchema.parse(rawItem)
  editingId.value = item.id
  form.value = {
    category: item.category,
    title: item.title,
    content: item.content,
    priority: item.priority,
    status: item.status,
    platform_key: item.platform_key || '',
    capability_key: item.capability_key || '',
  }
  keywordsStr.value = (item.keywords || []).join(', ')
  showModal.value = true
}

async function submitForm() {
  if (!form.value.title.trim()) {
    showToast('请输入标题', 'error')
    return
  }
  if (!form.value.content.trim()) {
    showToast('请输入内容', 'error')
    return
  }
  submitting.value = true
  try {
    const keywords = keywordsStr.value.split(/[,，]/).map(s => s.trim()).filter(Boolean)
    const data = { ...form.value, keywords }
    if (editingId.value) {
      await updateKnowledge(editingId.value, data)
      showToast('更新成功', 'success')
    } else {
      await createKnowledge(data)
      showToast('创建成功', 'success')
    }
    showModal.value = false
    await Promise.all([loadData(), loadMeta()])
  } catch {
    showToast('保存失败', 'error')
  } finally {
    submitting.value = false
  }
}

async function handleDelete(rawItem: unknown) {
  const item = knowledgeItemSchema.parse(rawItem)
  if (!await confirmAction({
    title: '删除知识条目？',
    message: `「${item.title}」将从工具帮助中移除，此操作不能撤销。`,
    confirmText: '确认删除',
    danger: true,
  })) return
  try {
    await deleteKnowledge(item.id)
    showToast('已删除', 'success')
    await Promise.all([loadData(), loadMeta()])
  } catch {
    showToast('删除失败', 'error')
  }
}

function openKnowledgeDetail(rawItem: unknown) {
  detailItem.value = knowledgeItemSchema.parse(rawItem)
  showDetailDrawer.value = true
}

function handleKnowledgeCommand(command: string, item: unknown) {
  if (command === 'edit') openEdit(item)
  if (command === 'delete') handleDelete(item)
}

onMounted(loadInitial)
</script>

<style scoped>
.retrieval-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 12px;
}

.retrieval-result { margin-top: 20px; }
.retrieval-summary { margin-bottom: 12px; color: var(--color-text-secondary); }
.retrieval-item { margin-bottom: 10px; }
.retrieval-item-header { display: flex; justify-content: space-between; gap: 12px; }
.retrieval-meta { margin: 6px 0; color: var(--color-text-secondary); font-size: 12px; }
.retrieval-content { max-height: 120px; overflow: auto; white-space: pre-wrap; line-height: 1.5; }

.knowledge-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; margin-bottom: 1rem; }

.knowledge-stats + :deep(.async-notice) { margin: -0.25rem 0 1rem; }

.stat-card {
  padding: 18px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  text-align: center;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-text);
}

.stat-label {
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  margin-top: 0.25rem;
}

.data-toolbar-v6 { margin-bottom: 1rem; }

.table-card {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-secondary);
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 1rem;
}

:deep(.el-table) {
  --el-table-border-color: var(--color-border);
  --el-table-header-bg-color: var(--color-canvas);
  --el-table-row-hover-bg-color: var(--color-surface-soft);
}

:deep(.el-dialog) {
  border-radius: var(--radius-lg);
}

:deep(.el-dialog__header) {
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 1rem;
}

:deep(.el-dialog__footer) {
  border-top: 1px solid var(--color-border);
  padding-top: 1rem;
}

.detail-list { display: grid; gap: 12px; }
.detail-list > div { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--color-border); }
.detail-list span { color: var(--color-text-secondary); font-size: 13px; }
.detail-list strong { color: var(--color-text); font-size: 14px; overflow-wrap: anywhere; }
.detail-content { grid-template-columns: 1fr !important; }
.detail-content p { margin: 0; color: var(--color-text); line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }

@media (max-width: 899px) { .knowledge-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .knowledge-stats { grid-template-columns: 1fr; } .retrieval-options { grid-template-columns: 1fr; } }
</style>
