<template>
  <div>
    <PageHeader title="用户管理" description="维护用户资料与设备席位信息" />
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
        placeholder="搜索用户/设备..."
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
      <el-table :data="filteredUsers" stripe style="width: 100%">
        <el-table-column v-if="!isCompact" prop="id" label="ID" width="80" />
        <el-table-column label="用户名" min-width="140">
          <template #default="{ row }">
            <el-input
              v-if="!isCompact && editingUser?.id === row.id"
              v-model="editingUser!.name"
              size="small"
              style="width: 120px"
            />
            <span v-else>{{ row.name || "-" }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="手机号" width="140">
          <template #default="{ row }">
            <el-input
              v-if="editingUser?.id === row.id"
              v-model="editingUser!.phone"
              size="small"
              style="width: 120px"
            />
            <span v-else>{{ row.phone || "-" }}</span>
          </template>
        </el-table-column>
        <el-table-column
          prop="device_name"
          label="设备名"
          min-width="140"
          show-overflow-tooltip
        />
        <el-table-column v-if="!isCompact" label="设备ID" min-width="160">
          <template #default="{ row }">
            <span class="mono-text">{{ row.device_id || "-" }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="席位数" width="100">
          <template #default="{ row }">
            <el-input-number
              v-if="editingUser?.id === row.id"
              v-model="editingUser!.total_seats"
              size="small"
              :min="1"
              style="width: 80px"
            />
            <span v-else>{{ row.total_seats }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="额外设备" width="100">
          <template #default="{ row }">
            <el-input-number
              v-if="editingUser?.id === row.id"
              v-model="editingUser!.extra_devices"
              size="small"
              :min="0"
              style="width: 80px"
            />
            <span v-else>{{ row.extra_devices }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="注册时间" width="160">
          <template #default="{ row }">
            <span class="time-text">{{ formatTime(row.created_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          :width="isCompact ? 136 : 160"
          fixed="right"
        >
          <template #default="{ row }">
            <template v-if="isCompact">
              <el-button size="small" @click="openUserDrawer(row, false)"
                >详情</el-button
              >
              <el-button
                v-if="canWrite"
                size="small"
                @click="openUserDrawer(row, true)"
                >编辑</el-button
              >
            </template>
            <template v-else-if="editingUser?.id === row.id">
              <el-button type="primary" size="small" @click="saveUser(row)"
                >保存</el-button
              >
              <el-button size="small" @click="editingUser = null"
                >取消</el-button
              >
            </template>
            <template v-else>
              <el-button size="small" @click="openUserDrawer(row, false)">详情</el-button>
              <el-button v-if="canWrite" size="small" @click="startEdit(row)"
                >编辑</el-button
              >
              <span v-else class="readonly-label">只读</span>
            </template>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-state">暂无用户数据</div>
        </template>
      </el-table>
      <div class="user-pagination"><el-pagination :current-page="page" :page-size="pageSize" :total="total" :pager-count="5" layout="prev, pager, next" @current-change="changePage" /></div>
    </el-card>

    <AdminDetailDrawer
      v-model="showUserDrawer"
      :title="drawerEditing ? '编辑用户' : '用户详情'"
      @update:model-value="onDrawerVisibility"
    >
      <div v-if="detailLoading" class="empty-state">正在读取用户…</div>
      <div v-else-if="detailError" class="detail-error" role="alert">{{ detailError }}</div>
      <div v-if="detailUser" class="user-detail-list">
        <div class="context-actions">
          <span>用户 #{{ detailUser.id }}</span>
          <el-button v-if="detailUser.auth_code_id" size="small" @click="openAuthorization">授权与设备</el-button>
          <el-button size="small" @click="openFeedback">关联工单</el-button>
          <span v-if="!detailUser.auth_code_id" class="readonly-label">未关联授权</span>
        </div>
        <label
          ><span>用户名</span
          ><el-input v-if="drawerEditing" v-model="detailUser.name" /><strong
            v-else
            >{{ detailUser.name || "-" }}</strong
          ></label
        >
        <label
          ><span>手机号</span
          ><el-input v-if="drawerEditing" v-model="detailUser.phone" /><strong
            v-else
            >{{ detailUser.phone || "-" }}</strong
          ></label
        >
        <label
          ><span>设备名</span
          ><strong>{{ detailUser.device_name || "-" }}</strong></label
        >
        <label
          ><span>设备 ID</span
          ><strong class="mono-text">{{
            detailUser.device_id || "-"
          }}</strong></label
        >
        <label
          ><span>席位数</span
          ><el-input-number
            v-if="drawerEditing"
            v-model="detailUser.total_seats"
            :min="1"
          /><strong v-else>{{ detailUser.total_seats }}</strong></label
        >
        <label
          ><span>额外设备</span
          ><el-input-number
            v-if="drawerEditing"
            v-model="detailUser.extra_devices"
            :min="0"
          /><strong v-else>{{ detailUser.extra_devices }}</strong></label
        >
        <label
          ><span>注册时间</span
          ><strong>{{ formatTime(detailUser.created_at) }}</strong></label
        >
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
import { useCompactLayout } from "@/composables/useCompactLayout";
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
const editingUser = ref<AdminUser | null>(null);
const isCompact = useCompactLayout();
const showUserDrawer = ref(false);
const drawerEditing = ref(false);
const detailUser = ref<AdminUser | null>(null);
const canWrite = computed(() =>
  hasStaffPermission(authService.getRole(), "users.write"),
);
const loadState = ref<AsyncDataState>("loading");
const loadError = ref("");

const filteredUsers = computed(() => users.value);
function scopeParams() { return platformStore.adminPlatform === 'all' ? {} : { platform_key: platformStore.adminPlatform }; }
function syncQuery(extra: Record<string, string | undefined> = {}) { if (router) void router.replace({ path: '/admin/users', query: { ...query(), page: String(page.value), keyword: searchText.value || undefined, ...extra } }); }
function changePage(value: number) { page.value = value; syncQuery(); void loadData(); }

function formatTime(timeStr?: string | null) {
  if (!timeStr) return "-";
  const d = new Date(timeStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function startEdit(user: unknown) {
  if (!canWrite.value) return;
  openUserDrawer(user, true);
}

async function saveUser(user: unknown) {
  if (!canWrite.value || !editingUser.value) return;
  const selectedUser = adminUserSchema.parse(user);
  try {
    await updateUser(selectedUser.id, {
      name: editingUser.value.name,
      phone: editingUser.value.phone,
      total_seats: editingUser.value.total_seats,
      extra_devices: editingUser.value.extra_devices,
    });
    showToast("用户信息已更新", "success");
    editingUser.value = null;
    await loadData();
  } catch {
    showToast("更新失败", "error");
  }
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
watch(() => platformStore.adminPlatform, () => { loadSequence += 1; detailSequence += 1; users.value = []; detailUser.value = null; showUserDrawer.value = false; selectedUserId.value = undefined; editingUser.value = null; page.value = 1; syncQuery({ user_id: undefined, return_to: undefined }); void loadData(); });
watch(() => query().user_id, value => { const id = contextId(value); if (id && id !== selectedUserId.value) void openUser(id); else if (!id && showUserDrawer.value) { detailSequence += 1; showUserDrawer.value = false; detailUser.value = null; selectedUserId.value = undefined; } });
onMounted(() => { void loadData(); const id = contextId(query().user_id); if (id) void openUser(id); });
onBeforeUnmount(() => { loadSequence += 1; detailSequence += 1; if (searchTimer) clearTimeout(searchTimer); });
</script>

<style scoped>
.data-toolbar-v6 {
  margin-bottom: 1rem;
}
.user-pagination { display: flex; justify-content: flex-end; margin-top: 16px; overflow-x: auto; }
.context-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.detail-error { color: var(--color-danger, #b42318); line-height: 1.6; }

.table-card {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
}

.mono-text {
  font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
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
  gap: 14px;
}
.user-detail-list label {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border);
}
.user-detail-list label > span {
  color: var(--color-text-secondary);
  font-size: 13px;
}
.user-detail-list strong {
  min-width: 0;
  color: var(--color-text);
  overflow-wrap: anywhere;
}
</style>
