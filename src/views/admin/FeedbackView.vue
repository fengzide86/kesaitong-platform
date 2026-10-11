<template>
  <div>
    <PageHeader title="工单管理" description="查看客户反馈并跟进处理状态" />
    <div v-if="relatedUserId" class="context-banner">
      <span>正在查看用户 #{{ relatedUserId }} 的工单</span>
      <el-button size="small" @click="clearUserFilter">查看全部工单</el-button>
    </div>
    <AsyncStateNotice
      :state="loadState"
      :message="loadError"
      loading-text="正在加载工单…"
      @retry="loadData"
    />

    <DataToolbar
      v-if="loadState !== 'loading' && loadState !== 'error'"
      label="工单筛选"
    >
      <el-select
        v-model="filterStatus"
        placeholder="全部状态"
        clearable
        style="width: 160px"
      >
        <el-option label="全部状态" value="" />
        <el-option label="待处理" value="pending" />
        <el-option label="处理中" value="processing" />
        <el-option label="已解决" value="resolved" />
      </el-select>
      <template #summary>共 {{ total }} 个工单 · 本页 {{ feedbacks.length }} 个</template>
    </DataToolbar>

    <el-card
      v-if="loadState !== 'loading' && loadState !== 'error'"
      class="table-card"
      shadow="never"
    >
      <el-table :data="feedbacks" stripe style="width: 100%">
        <el-table-column v-if="!isCompact" prop="id" label="ID" width="80" />
        <el-table-column
          prop="title"
          label="标题"
          min-width="200"
          show-overflow-tooltip
        />
        <el-table-column
          v-if="!isCompact"
          prop="user_id"
          label="用户ID"
          width="100"
        />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)" size="small">
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="创建时间" width="160">
          <template #default="{ row }">
            <span class="time-text">{{ formatTime(row.created_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="viewDetail(row)">查看与处理</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-state">暂无工单数据</div>
        </template>
      </el-table>
      <div class="feedback-pagination">
        <el-pagination :current-page="page" :page-size="pageSize" :total="total" :pager-count="5" layout="prev, pager, next" @current-change="changePage" />
      </div>
    </el-card>

    <!-- 查看详情 -->
    <AdminDetailDrawer
      v-model="showDetailModal"
      title="工单详情"
      size="min(600px, 92vw)"
      @update:model-value="onDetailVisibility"
    >
      <div v-if="detailLoading" class="empty-state">正在读取完整工单…</div>
      <div v-else-if="detailError" class="detail-error" role="alert">
        <p>{{ detailError }}</p>
        <el-button v-if="selectedTicketId" @click="openTicket(selectedTicketId)">重试读取</el-button>
      </div>
      <div v-else-if="currentFeedback" class="detail-content">
        <div class="context-actions">
          <span>工单 #{{ currentFeedback.id }}</span>
          <el-button v-if="currentFeedback.user_id" size="small" @click="openLinkedUser">查看用户</el-button>
          <el-button v-if="linkedUser?.auth_code_id" size="small" @click="openLinkedAuthorization">授权与设备</el-button>
          <span v-if="linkedUserError" class="context-hint">用户关联暂时无法读取，可从用户详情核对</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">标题：</span>
          <span>{{ currentFeedback?.title || "-" }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">用户ID：</span>
          <span>{{ currentFeedback?.user_id || "-" }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">状态：</span>
          <el-tag :type="getStatusType(currentFeedback?.status)" size="small">
            {{ getStatusText(currentFeedback?.status) }}
          </el-tag>
        </div>
        <div class="detail-row">
          <span class="detail-label">创建时间：</span>
          <span class="time-text">{{
            formatTime(currentFeedback?.created_at)
          }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">内容：</span>
          <div class="detail-text">
            {{ currentFeedback?.content || "无内容" }}
          </div>
        </div>
        <div
          class="detail-row"
          v-if="currentFeedback && feedbackScreenshots(currentFeedback)"
        >
          <span class="detail-label">截图：</span>
          <div class="screenshot-list">
            <el-image
              v-for="(url, index) in parseScreenshots(
                feedbackScreenshots(currentFeedback),
              )"
              :key="index"
              :src="url"
              :preview-src-list="
                parseScreenshots(feedbackScreenshots(currentFeedback))
              "
              :initial-index="index"
              fit="cover"
              class="screenshot-img"
            />
          </div>
        </div>
        <div class="detail-row" v-if="currentFeedback?.admin_reply">
          <span class="detail-label">管理员回复：</span>
          <div class="detail-text reply-text">
            {{ currentFeedback.admin_reply }}
          </div>
        </div>
        <div v-if="currentFeedback.replied_at" class="detail-row time-text">回复时间：{{ formatTime(currentFeedback.replied_at) }}</div>
        <el-form v-if="canReply" label-position="top" class="inline-reply" @submit.prevent="submitReply">
          <el-form-item label="处理状态">
            <el-select v-model="replyStatus" aria-label="处理状态" :disabled="isSubmitting" style="width: 100%">
              <el-option label="处理中" value="processing" />
              <el-option label="已解决" value="resolved" />
            </el-select>
          </el-form-item>
          <el-form-item label="回复内容">
            <el-input v-model="replyContent" aria-label="回复内容" type="textarea" :rows="4" :disabled="isSubmitting" placeholder="写明处理结果或客户需要完成的下一步" />
          </el-form-item>
          <p class="context-hint">保存后仍保留本工单，回复会显示在客户的求助记录中。</p>
          <p v-if="replyError" class="detail-error" role="alert">{{ replyError }}</p>
          <el-button v-if="replyError && selectedTicketId" @click="openTicket(selectedTicketId)">重新读取工单</el-button>
        </el-form>
      </div>
      <template #footer>
        <el-button v-if="returnPath" @click="router.push(returnPath)">返回来源</el-button>
        <el-button @click="closeDetail">返回列表</el-button>
        <el-button v-if="canReply && currentFeedback && !detailLoading && !detailError" type="primary" @click="submitReply" :loading="isSubmitting" :disabled="!!replyError">保存处理结果</el-button>
      </template>
    </AdminDetailDrawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRouter } from "vue-router";
import { getFeedbacksPage, getFeedback, getUser, updateFeedback, API_BASE } from "@/utils/api";
import { authService } from "@/utils/auth";
import { hasStaffPermission } from "@/features/auth/permissions";
import { contextId, contextText, supportReturnPath, supportSourcePath } from "@/features/admin/supportContext";
import { showToast } from "@/utils";
import DataToolbar from "@/components/DataToolbar.vue";
import AsyncStateNotice from "@/components/AsyncStateNotice.vue";
import { usePlatformStore } from "@/stores/platform";
import { useCompactLayout } from "@/composables/useCompactLayout";
import {
  failedDataState,
  settledDataState,
  type AsyncDataState,
} from "@/features/async/state";
import PageHeader from "@/components/PageHeader.vue";
import AdminDetailDrawer from "@/components/AdminDetailDrawer.vue";
import {
  adminFeedbacksSchema,
  adminFeedbackSchema,
  adminUserSchema,
  type AdminUser,
  type AdminFeedback,
  type FeedbackStatus,
} from "@/features/admin/model";

const platformStore = usePlatformStore();
const router = useRouter();
const isCompact = useCompactLayout();
const feedbacks = ref<AdminFeedback[]>([]);
const query = () => router?.currentRoute.value.query || {};
const initialStatus = contextText(query().status);
const filterStatus = ref(["pending", "processing", "resolved"].includes(initialStatus) ? initialStatus : "");
const page = ref(contextId(query().page) || 1);
const relatedUserId = ref(contextId(query().user_id));
let restoringQuery = false;
const pageSize = 20;
const total = ref(0);
let loadSequence = 0;
const showDetailModal = ref(false);
const currentFeedback = ref<AdminFeedback | null>(null);
const linkedUser = ref<AdminUser | null>(null);
const linkedUserError = ref(false);
const selectedTicketId = ref<number | undefined>();
const detailLoading = ref(false);
const detailError = ref("");
const replyError = ref("");
let detailSequence = 0;
const canReply = computed(() => hasStaffPermission(authService.getRole(), "feedback.write"));
const returnPath = computed(() => supportReturnPath(query().return_to, authService.getRole()));
const replyStatus = ref<FeedbackStatus>("processing");
const replyContent = ref("");
const isSubmitting = ref(false);
const loadState = ref<AsyncDataState>("loading");
const loadError = ref("");

function getStatusType(status?: string | null): "warning" | "info" | "success" {
  const map: Record<string, "warning" | "info" | "success"> = {
    pending: "warning",
    processing: "info",
    resolved: "success",
  };
  return status ? map[status] || "warning" : "warning";
}

function getStatusText(status?: string | null) {
  const map: Record<string, string> = {
    pending: "待处理",
    processing: "处理中",
    resolved: "已解决",
  };
  return status ? map[status] || status : "-";
}

function formatTime(timeStr?: string | null) {
  if (!timeStr) return "-";
  const d = new Date(timeStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function scopeParams() {
  return platformStore.adminPlatform === "all" ? {} : { platform_key: platformStore.adminPlatform };
}

function syncListQuery(extra: Record<string, string | undefined> = {}) {
  if (!router) return;
  void router.replace({ path: '/admin/feedback', query: { ...query(), status: filterStatus.value || undefined, page: String(page.value), user_id: relatedUserId.value ? String(relatedUserId.value) : undefined, ...extra } });
}

function viewDetail(fb: unknown) {
  const id = Number(adminFeedbackSchema.parse(fb).id);
  syncListQuery({ ticket_id: String(id) });
  void openTicket(id);
}

async function openTicket(id: number) {
  const sequence = ++detailSequence;
  selectedTicketId.value = id;
  currentFeedback.value = null;
  linkedUser.value = null;
  linkedUserError.value = false;
  replyContent.value = '';
  replyError.value = '';
  isSubmitting.value = false;
  showDetailModal.value = true;
  detailLoading.value = true;
  detailError.value = '';
  const params = scopeParams();
  try {
    const result = adminFeedbackSchema.parse(await getFeedback(id, params));
    if (sequence !== detailSequence) return;
    if (Number(result.id) !== id) throw new Error('工单编号不匹配，请重新读取');
    currentFeedback.value = result;
    replyStatus.value = result.status === 'pending' ? 'processing' : result.status;
    replyContent.value = result.admin_reply || '';
    detailLoading.value = false;
    if (result.user_id) {
      try {
        const user = adminUserSchema.parse(await getUser(result.user_id, params));
        if (sequence === detailSequence && String(user.id) === String(result.user_id)) linkedUser.value = user;
      } catch { if (sequence === detailSequence) linkedUserError.value = true; }
    }
  } catch (error) {
    if (sequence !== detailSequence) return;
    currentFeedback.value = null;
    detailError.value = error instanceof Error ? error.message : '无法读取该工单，请核对权限与当前平台';
  } finally { if (sequence === detailSequence) detailLoading.value = false; }
}

function closeDetail() {
  detailSequence += 1;
  showDetailModal.value = false;
  currentFeedback.value = null;
  selectedTicketId.value = undefined;
  syncListQuery({ ticket_id: undefined });
}
function onDetailVisibility(value: boolean) { if (!value) closeDetail(); }
function clearUserFilter() { relatedUserId.value = undefined; page.value = 1; syncListQuery({ user_id: undefined }); void loadData(); }
function openLinkedUser() {
  if (currentFeedback.value?.user_id) void router.push({ path: '/admin/users', query: { user_id: String(currentFeedback.value.user_id), return_to: supportSourcePath(router.currentRoute.value.fullPath) } });
}
function openLinkedAuthorization() {
  if (linkedUser.value?.auth_code_id) void router.push({ path: '/admin/authcodes', query: { auth_code_id: String(linkedUser.value.auth_code_id), return_to: supportSourcePath(router.currentRoute.value.fullPath) } });
}

async function submitReply() {
  if (!canReply.value || !currentFeedback.value || isSubmitting.value || detailLoading.value || replyError.value) return;
  if (!replyContent.value.trim() && replyStatus.value === "resolved") {
    showToast("请输入回复内容", "error");
    return;
  }
  isSubmitting.value = true;
  replyError.value = '';
  const sequence = detailSequence;
  const ticketId = currentFeedback.value.id;
  try {
    await updateFeedback(ticketId, {
      status: replyStatus.value,
      admin_reply: replyContent.value.trim(),
    });
    if (sequence !== detailSequence) return;
    const updated = adminFeedbackSchema.parse(await getFeedback(ticketId, scopeParams()));
    if (sequence !== detailSequence) return;
    if (String(updated.id) !== String(ticketId)) throw new Error('工单回读不匹配');
    currentFeedback.value = updated;
    replyStatus.value = updated.status === 'pending' ? 'processing' : updated.status;
    replyContent.value = updated.admin_reply || '';
    showToast("处理结果已保存并回读", "success");
    await loadData();
  } catch {
    if (sequence === detailSequence) replyError.value = '保存或回读失败，请重新读取本工单核对结果后再操作。';
  } finally {
    if (sequence === detailSequence) isSubmitting.value = false;
  }
}

function feedbackScreenshots(
  feedback: AdminFeedback,
): string | string[] | null | undefined {
  return feedback.screenshots ?? feedback.screenshot;
}

function parseScreenshots(
  screenshotsStr: string | string[] | null | undefined,
): string[] {
  if (!screenshotsStr) return [];
  try {
    const candidate: unknown =
      typeof screenshotsStr === "string"
        ? JSON.parse(screenshotsStr)
        : screenshotsStr;
    if (!Array.isArray(candidate)) return [];
    return candidate
      .filter((url): url is string => typeof url === "string")
      .map((url) => (url.startsWith("http") ? url : `${API_BASE}${url}`));
  } catch {
    return [];
  }
}

async function loadData() {
  const sequence = ++loadSequence;
  loadState.value = feedbacks.value.length ? "data" : "loading";
  loadError.value = "";
  try {
    const platformKey =
      platformStore.adminPlatform !== "all"
        ? platformStore.adminPlatform
        : undefined;
    const result = await getFeedbacksPage({ platform_key: platformKey, status: filterStatus.value || undefined, ...(relatedUserId.value ? { user_id: relatedUserId.value } : {}), page: page.value, page_size: pageSize });
    if (sequence !== loadSequence) return;
    total.value = result.total;
    if (page.value > 1 && (page.value - 1) * pageSize >= total.value) {
      page.value = Math.max(1, Math.ceil(total.value / pageSize));
      syncListQuery();
      await loadData();
      return;
    }
    feedbacks.value = adminFeedbacksSchema.parse(result.items);
    loadState.value = settledDataState(feedbacks.value.length);
  } catch (error) {
    if (sequence !== loadSequence) return;
    loadError.value =
      error instanceof Error && error.message
        ? error.message
        : "工单数据暂时无法加载";
    loadState.value = failedDataState(feedbacks.value.length > 0);
    showToast("数据加载失败", "error");
  }
}

function changePage(nextPage: number) {
  page.value = nextPage;
  syncListQuery();
  void loadData();
}

watch(
  () => platformStore.adminPlatform,
  () => {
    page.value = 1;
    showDetailModal.value = false;
    detailSequence += 1;
    currentFeedback.value = null;
    linkedUser.value = null;
    selectedTicketId.value = undefined;
    feedbacks.value = [];
    relatedUserId.value = undefined;
    syncListQuery({ ticket_id: undefined, user_id: undefined, return_to: undefined });
    loadData();
  },
);

watch(filterStatus, () => { if (restoringQuery) return; page.value = 1; syncListQuery(); void loadData(); }, { flush: 'sync' });
watch(() => query().ticket_id, value => { const id = contextId(value); if (id && id !== selectedTicketId.value) void openTicket(id); else if (!id && showDetailModal.value) { detailSequence += 1; showDetailModal.value = false; currentFeedback.value = null; selectedTicketId.value = undefined; } });
watch(() => [query().user_id, query().status, query().page], () => {
  const id = contextId(query().user_id);
  const value = contextText(query().status);
  const status = ['pending', 'processing', 'resolved'].includes(value) ? value : '';
  const nextPage = contextId(query().page) || 1;
  if (id === relatedUserId.value && status === filterStatus.value && nextPage === page.value) return;
  restoringQuery = true;
  relatedUserId.value = id;
  filterStatus.value = status;
  page.value = nextPage;
  restoringQuery = false;
  void loadData();
});
onMounted(() => { void loadData(); const id = contextId(query().ticket_id); if (id) void openTicket(id); });
onBeforeUnmount(() => { loadSequence += 1; detailSequence += 1; });
</script>

<style scoped>
.feedback-pagination { display: flex; justify-content: flex-end; margin-top: 16px; overflow-x: auto; }
.context-banner, .context-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 16px; }
.context-banner { padding: 12px 16px; background: var(--color-surface-soft); border-radius: 10px; }
.context-hint { color: var(--color-text-secondary); font-size: 12px; line-height: 1.6; }
.detail-error { color: var(--color-danger, #b42318); line-height: 1.6; }
.inline-reply { border-top: 1px solid var(--color-border); padding-top: 20px; margin-top: 24px; }
.data-toolbar-v6 {
  margin-bottom: 1rem;
}

.table-card {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
}

.time-text {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-secondary);
}

.detail-content {
  min-width: 0;
}

.detail-row {
  margin-bottom: 1rem;
}

.detail-label {
  font-weight: 600;
  color: var(--color-text);
  margin-right: 0.5rem;
}

.detail-text {
  margin-top: 0.5rem;
  padding: 0.75rem;
  background: var(--color-canvas);
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.9rem;
  line-height: 1.6;
}

.reply-text {
  background: rgba(14, 165, 233, 0.05);
  border-left: 3px solid var(--color-primary);
}

.reply-info {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-bottom: 1rem;
  padding: 0.75rem;
  background: var(--color-canvas);
  border-radius: var(--radius-sm);
}

.screenshot-list {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.5rem;
}

.screenshot-img {
  width: 120px;
  height: 90px;
  border-radius: var(--radius-sm);
  cursor: pointer;
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
</style>
