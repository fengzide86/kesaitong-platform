<template>
  <div>
    <PageHeader title="用户管理" description="找到用户，核对项目和授权状态；需要调整资料或设备时再打开详情。" />
    <AsyncStateNotice
      :state="loadState"
      :message="loadError"
      loading-text="正在加载用户…"
      @retry="loadData"
    />

    <DataToolbar
      v-if="loadState !== 'loading' && loadState !== 'error'"
      label="用户筛选"
    >
      <el-input
        v-model="searchText"
        placeholder="搜索用户名、手机号或电脑"
        aria-label="搜索用户名、手机号或电脑"
        :maxlength="200"
        clearable
        style="min-width: 240px"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <template #summary>共 {{ total }} 个用户 · 本页 {{ users.length }} 个</template>
    </DataToolbar>

    <el-card
      v-if="loadState !== 'loading' && loadState !== 'error'"
      class="table-card"
      shadow="never"
    >
      <el-table :data="users" stripe style="width: 100%">
        <el-table-column label="用户 / 联系方式" min-width="150">
          <template #default="{ row }">
            <div class="user-context-cell">
              <strong :title="row.name || `用户 #${row.id}`">{{ row.name || `用户 #${row.id}` }}</strong>
              <small>{{ row.phone || '未填写手机号' }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="客户 / 项目" min-width="160">
          <template #default="{ row }">
            <div class="user-context-cell">
              <strong :title="row.customer_name || row.name || ''">{{ row.customer_name || row.name || '未登记客户' }}</strong>
              <small :title="row.project_id || row.plan_name || ''">{{ row.project_id || row.plan_name || '未关联项目' }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="授权状态 / 到期" min-width="145">
          <template #default="{ row }">
            <div class="user-context-cell">
              <el-tag size="small" :type="row.status === 'active' ? 'success' : row.status === 'expired' ? 'danger' : 'info'">{{ statusText(row.status) }}</el-tag>
              <small :title="formatTime(row.expires_at)">{{ row.expires_at ? formatTime(row.expires_at).slice(0, 10) : '未设置到期日' }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="使用电脑" min-width="145">
          <template #default="{ row }">
            <div class="user-context-cell">
              <strong :title="row.device_name || ''">{{ row.device_name || '未登记电脑' }}</strong>
              <small>{{ row.total_seats }} 个席位 · 额外设备 {{ row.extra_devices }} 台</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="152" fixed="right">
          <template #default="{ row }">
            <div class="user-row-actions">
              <el-button size="small" @click="openUserDrawer(row, false)">详情</el-button>
              <el-button v-if="canWrite" size="small" @click="openUserDrawer(row, true)">编辑</el-button>
              <span v-else class="readonly-label">只读</span>
            </div>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-state">
            <p>{{ searchText ? '没有找到匹配的用户，试试姓名、手机号或电脑名称。' : '暂无用户，客户激活授权并登录后会显示在这里。' }}</p>
            <el-button v-if="searchText" @click="searchText = ''">清除搜索</el-button>
          </div>
        </template>
      </el-table>
      <div class="user-pagination"><el-pagination :current-page="page" :page-size="pageSize" :total="total" :pager-count="5" layout="prev, pager, next" @current-change="changePage" /></div>
    </el-card>

    <AdminDetailDrawer
      v-model="showUserDrawer"
      class="user-profile-drawer"
      size="min(520px, 94vw)"
      :title="drawerEditing ? '编辑用户' : '用户详情'"
      @update:model-value="onDrawerVisibility"
    >
      <div v-if="detailLoading" class="empty-state">正在读取用户…</div>
      <div v-else-if="detailError" class="detail-error" role="alert">{{ detailError }}</div>
      <div v-if="detailUser" class="user-detail-list">
        <div class="user-profile-summary">
          <div><span class="user-profile-id">用户 #{{ detailUser.id }}</span><h2>{{ detailUser.name || '未填写姓名' }}</h2></div>
          <el-tag :type="detailUser.status === 'active' ? 'success' : detailUser.status === 'expired' ? 'danger' : 'info'">{{ statusText(detailUser.status) }}</el-tag>
        </div>

        <section class="user-profile-section" aria-label="基本资料">
          <h3>基本资料</h3>
          <div class="user-field-grid">
            <label><span>用户名</span><el-input v-if="drawerEditing" v-model="detailUser.name" /><span v-else class="user-field-value">{{ detailUser.name || '未填写' }}</span></label>
            <label><span>手机号</span><el-input v-if="drawerEditing" v-model="detailUser.phone" /><span v-else class="user-field-value">{{ detailUser.phone || '未填写' }}</span></label>
          </div>
        </section>

        <section class="user-profile-section" aria-label="使用额度">
          <h3>使用额度</h3>
          <div class="user-field-grid">
            <label><span>席位数</span><el-input-number v-if="drawerEditing" v-model="detailUser.total_seats" :min="1" /><span v-else class="user-field-value">{{ detailUser.total_seats }} 个</span></label>
            <label><span>额外设备</span><el-input-number v-if="drawerEditing" v-model="detailUser.extra_devices" :min="0" /><span v-else class="user-field-value">{{ detailUser.extra_devices }} 台</span></label>
          </div>
        </section>

        <section class="user-profile-section user-related-section" aria-label="关联信息">
          <header><h3>关联信息</h3><span>仅供核对</span></header>
          <dl class="user-info-list">
            <div><dt>客户</dt><dd>{{ detailUser.customer_name || detailUser.name || '未登记' }}</dd></div>
            <div><dt>项目</dt><dd>{{ detailUser.project_id || detailUser.plan_name || '未关联项目' }}</dd></div>
            <div><dt>授权到期</dt><dd>{{ detailUser.expires_at ? formatTime(detailUser.expires_at) : '未设置到期日' }}</dd></div>
            <div><dt>使用电脑</dt><dd>{{ detailUser.device_name || '未登记电脑' }}</dd></div>
          </dl>
          <div class="context-actions">
            <el-button v-if="detailUser.auth_code_id" link type="primary" @click="openAuthorization">授权与设备</el-button>
            <el-button link type="primary" @click="openFeedback">关联工单</el-button>
            <span v-if="!detailUser.auth_code_id" class="readonly-label">未关联授权</span>
          </div>
        </section>

        <details class="user-technical-details">
          <summary>设备编号与注册信息</summary>
          <dl class="user-info-list">
            <div><dt>设备编号</dt><dd class="user-device-id">{{ detailUser.device_id || '未登记' }}</dd></div>
            <div><dt>注册时间</dt><dd>{{ formatTime(detailUser.created_at) }}</dd></div>
          </dl>
        </details>
      </div>
      <template #footer>
        <el-button v-if="returnPath" @click="router.push(returnPath)">返回来源</el-button>
        <el-button @click="closeDrawer">{{
          drawerEditing ? "取消" : "关闭"
        }}</el-button>
        <el-button
          v-if="drawerEditing && canWrite"
          type="primary"
          :loading="isSaving"
          :disabled="detailLoading || !!detailError"
          @click="saveDrawerUser"
          >保存</el-button
        >
      </template>
    </AdminDetailDrawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRouter } from "vue-router";
import { getUsersPage, getUser, updateUser } from "@/utils/api";
import { usePlatformStore } from "@/stores/platform";
import { contextId, contextText, supportReturnPath, supportSourcePath } from "@/features/admin/supportContext";
import { showToast } from "@/utils";
import { Search } from "@element-plus/icons-vue";
import DataToolbar from "@/components/DataToolbar.vue";
import PageHeader from "@/components/PageHeader.vue";
import AdminDetailDrawer from "@/components/AdminDetailDrawer.vue";
import AsyncStateNotice from "@/components/AsyncStateNotice.vue";
import {
  adminUserSchema,
  adminUsersSchema,
  type AdminUser,
} from "@/features/admin/model";
import { hasStaffPermission } from "@/features/auth/permissions";
import { authService } from "@/utils/auth";
import {
  failedDataState,
  settledDataState,
  type AsyncDataState,
} from "@/features/async/state";

const users = ref<AdminUser[]>([]);
const router = useRouter();
const platformStore = usePlatformStore();
const query = () => router?.currentRoute.value.query || {};
const searchText = ref(contextText(query().keyword));
const page = ref(contextId(query().page) || 1);
const pageSize = 20;
const total = ref(0);
let loadSequence = 0;
let detailSequence = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let restoringQuery = false;
const selectedUserId = ref<number | undefined>();
const detailLoading = ref(false);
const detailError = ref('');
const isSaving = ref(false);
const returnPath = computed(() => supportReturnPath(query().return_to, authService.getRole()));
const showUserDrawer = ref(false);
const drawerEditing = ref(false);
const detailUser = ref<AdminUser | null>(null);
const canWrite = computed(() =>
  hasStaffPermission(authService.getRole(), "users.write"),
);
const loadState = ref<AsyncDataState>("loading");
const loadError = ref("");

function scopeParams() { return platformStore.adminPlatform === 'all' ? {} : { platform_key: platformStore.adminPlatform }; }
function syncQuery(extra: Record<string, string | undefined> = {}) { if (router) void router.replace({ path: '/admin/users', query: { ...query(), page: String(page.value), keyword: searchText.value || undefined, ...extra } }); }
function changePage(value: number) { page.value = value; syncQuery(); void loadData(); }

function formatTime(timeStr?: string | null) {
  if (!timeStr) return "-";
  const d = new Date(timeStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function statusText(status?: string | null) {
  const labels: Record<string, string> = { active: '使用中', expired: '已到期', frozen: '已冻结', unused: '未使用', deleted: '已删除', disabled: '已停用', inactive: '未启用' };
  return status ? labels[status] || '待核对' : '待核对';
}

function openUserDrawer(user: unknown, editing: boolean) {
  const id = Number(adminUserSchema.parse(user).id);
  syncQuery({ user_id: String(id) });
  void openUser(id, editing);
}

async function openUser(id: number, editing = false) {
  const sequence = ++detailSequence;
  selectedUserId.value = id;
  detailUser.value = null;
  detailError.value = '';
  detailLoading.value = true;
  isSaving.value = false;
  drawerEditing.value = editing && canWrite.value;
  showUserDrawer.value = true;
  try {
    const user = adminUserSchema.parse(await getUser(id, scopeParams()));
    if (sequence !== detailSequence) return;
    if (Number(user.id) !== id) throw new Error('用户编号不匹配，请重新读取');
    detailUser.value = user;
  } catch (error) {
    if (sequence === detailSequence) detailError.value = error instanceof Error ? error.message : '无法读取用户，请核对权限与当前平台';
  } finally { if (sequence === detailSequence) detailLoading.value = false; }
}
function closeDrawer() { detailSequence += 1; showUserDrawer.value = false; detailUser.value = null; selectedUserId.value = undefined; syncQuery({ user_id: undefined }); }
function onDrawerVisibility(value: boolean) { if (!value) closeDrawer(); }
function openAuthorization() { if (detailUser.value?.auth_code_id) void router.push({ path: '/admin/authcodes', query: { auth_code_id: String(detailUser.value.auth_code_id), return_to: supportSourcePath(router.currentRoute.value.fullPath) } }); }
function openFeedback() { if (detailUser.value) void router.push({ path: '/admin/feedback', query: { user_id: String(detailUser.value.id), return_to: supportSourcePath(router.currentRoute.value.fullPath) } }); }

async function saveDrawerUser() {
  if (!canWrite.value || !detailUser.value || isSaving.value || detailLoading.value) return;
  const sequence = detailSequence;
  const id = detailUser.value.id;
  isSaving.value = true;
  try {
    await updateUser(id, {
      name: detailUser.value.name,
      phone: detailUser.value.phone,
      total_seats: detailUser.value.total_seats,
      extra_devices: detailUser.value.extra_devices,
    });
    if (sequence !== detailSequence) return;
    const updated = adminUserSchema.parse(await getUser(id, scopeParams()));
    if (sequence !== detailSequence) return;
    detailUser.value = updated;
    drawerEditing.value = false;
    showToast("用户信息已更新并回读", "success");
    await loadData();
  } catch {
    if (sequence === detailSequence) showToast("保存或回读失败，请重新读取用户后核对", "error");
  } finally {
    if (sequence === detailSequence) isSaving.value = false;
  }
}

async function loadData() {
  const sequence = ++loadSequence;
  loadState.value = users.value.length ? "data" : "loading";
  loadError.value = "";
  try {
    const result = await getUsersPage({ ...scopeParams(), keyword: searchText.value || undefined, page: page.value, page_size: pageSize });
    if (sequence !== loadSequence) return;
    users.value = adminUsersSchema.parse(result.items);
    total.value = result.total;
    if (page.value > 1 && (page.value - 1) * pageSize >= total.value) {
      page.value = Math.max(1, Math.ceil(total.value / pageSize));
      syncQuery();
      await loadData();
      return;
    }
    loadState.value = settledDataState(users.value.length);
  } catch (error) {
    if (sequence !== loadSequence) return;
    loadError.value =
      error instanceof Error && error.message
        ? error.message
        : "用户数据暂时无法加载";
    loadState.value = failedDataState(users.value.length > 0);
    showToast("数据加载失败", "error");
  }
}

watch(searchText, () => { if (restoringQuery) return; if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(() => { page.value = 1; syncQuery(); void loadData(); }, 250); }, { flush: 'sync' });
watch(() => [query().page, query().keyword], () => {
  const nextPage = contextId(query().page) || 1;
  const nextKeyword = contextText(query().keyword);
  if (page.value === nextPage && searchText.value === nextKeyword) return;
  if (searchTimer) clearTimeout(searchTimer);
  restoringQuery = true;
  page.value = nextPage;
  searchText.value = nextKeyword;
  restoringQuery = false;
  void loadData();
});
watch(() => platformStore.adminPlatform, () => { loadSequence += 1; detailSequence += 1; users.value = []; detailUser.value = null; showUserDrawer.value = false; selectedUserId.value = undefined; page.value = 1; syncQuery({ user_id: undefined, return_to: undefined }); void loadData(); });
watch(() => query().user_id, value => { const id = contextId(value); if (id && id !== selectedUserId.value) void openUser(id); else if (!id && showUserDrawer.value) { detailSequence += 1; showUserDrawer.value = false; detailUser.value = null; selectedUserId.value = undefined; } });
onMounted(() => { void loadData(); const id = contextId(query().user_id); if (id) void openUser(id); });
onBeforeUnmount(() => { loadSequence += 1; detailSequence += 1; if (searchTimer) clearTimeout(searchTimer); });
</script>

<style scoped>
.data-toolbar-v6 {
  margin-bottom: 1rem;
}
.user-pagination { display: flex; justify-content: flex-end; margin-top: 16px; overflow-x: auto; }
.context-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 18px; margin-top: 16px; }
.context-actions :deep(.el-button + .el-button) { margin-left: 0; }
.context-actions :deep(.el-button.is-link) { padding: 0; min-height: 26px; background: transparent; border: 0; box-shadow: none; }
.detail-error { color: var(--color-danger, #b42318); line-height: 1.6; }

.table-card {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-secondary);
}

:deep(.el-table) {
  --el-table-border-color: var(--color-border);
  --el-table-header-bg-color: var(--color-canvas);
  --el-table-row-hover-bg-color: var(--color-surface-soft);
}

:deep(.el-input-number) {
  width: 100%;
}

.readonly-label {
  color: var(--color-text-tertiary);
  font-size: var(--type-meta);
}

.user-detail-list {
  display: grid;
  gap: 26px;
  color: var(--color-text);
}
.user-profile-summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding-bottom: 22px; border-bottom: 1px solid var(--color-border); }
.user-profile-summary > div { min-width: 0; }
.user-profile-summary h2 { margin: 6px 0 0; font-size: 20px; font-weight: 650; line-height: 1.4; overflow-wrap: anywhere; }
.user-profile-id { font-size: 12px; color: var(--color-text-secondary); }
.user-profile-summary :deep(.el-tag) { flex-shrink: 0; margin-top: 2px; }
.user-profile-section h3 { margin: 0 0 14px; font-size: 14px; font-weight: 650; line-height: 1.5; }
.user-field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.user-field-grid label { display: grid; min-width: 0; gap: 8px; align-content: start; }
.user-field-grid label > span:first-child { color: var(--color-text-secondary); font-size: 13px; line-height: 1.5; }
.user-field-value { font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
.user-detail-list :deep(.el-input), .user-detail-list :deep(.el-input-number) { min-width: 0; width: 100%; height: 40px; }
.user-related-section { padding: 18px; background: var(--color-canvas, #f7f8fb); border: 1px solid var(--color-border); border-radius: 10px; }
.user-related-section header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.user-related-section header > span { font-size: 12px; color: var(--color-text-tertiary); }
.user-info-list { display: grid; gap: 12px; margin: 0; font-size: 13px; line-height: 1.65; }
.user-info-list > div { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: baseline; gap: 14px; }
.user-info-list dt { color: var(--color-text-secondary); }
.user-info-list dd { min-width: 0; margin: 0; font-weight: 400; color: var(--color-text); overflow-wrap: anywhere; }
.user-technical-details { color: var(--color-text-secondary); font-size: 13px; }
.user-technical-details summary { cursor: pointer; line-height: 1.6; }
.user-technical-details[open] summary { margin-bottom: 16px; }
.user-technical-details .user-device-id { font-family: ui-monospace, "Cascadia Code", monospace; font-size: 12px; color: var(--color-text-secondary); }
.user-technical-details summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 4px; }
:global(.user-profile-drawer .el-drawer__header) { padding: 22px 26px 18px; margin-bottom: 0; }
:global(.user-profile-drawer .el-drawer__title) { font-size: 17px; font-weight: 650; }
:global(.user-profile-drawer .el-drawer__body) { padding: 24px 26px; }
:global(.user-profile-drawer .el-drawer__footer) { padding: 16px 26px; border-top: 1px solid var(--color-border); }
:global(.user-profile-drawer .el-drawer__footer .el-button) { min-width: 80px; }
.user-context-cell { display: grid; gap: 4px; min-width: 0; }
.user-row-actions { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.user-row-actions :deep(.el-button + .el-button) { margin-left: 0; }
.user-context-cell :deep(.el-tag) { justify-self: start; }
.user-context-cell strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-context-cell small { color: var(--color-text-secondary); font-size: var(--type-micro); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 480px) { .user-field-grid { grid-template-columns: 1fr; } }
</style>
