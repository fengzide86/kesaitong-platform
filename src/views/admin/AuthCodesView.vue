<template>
  <div class="auth-codes-page">
    <PageHeader
      eyebrow="LICENSE OPERATIONS"
      title="授权码管理"
      description="为普通工具箱和专业工作台生成独立授权"
    >
      <template #actions>
        <router-link v-if="canWrite" class="business-center-link" to="/admin/business-access">专业工作台</router-link>
      </template>
    </PageHeader>

    <AsyncStateNotice :state="loadState" :message="loadError" loading-text="正在加载授权码…" @retry="loadData" />

    <el-card v-if="canWrite" :class="['table-card', 'generator-card', { 'is-business': generatorProductType === 'business' }]">
      <template #header>
        <div class="card-header">
          <div>
            <h3>生成新授权码</h3>
            <p>先选择客户进入的产品，再配置授权范围。</p>
          </div>
          <div class="product-switch" role="tablist" aria-label="授权产品类型">
            <button
              type="button"
              :class="{ active: generatorProductType === 'consumer' }"
              role="tab"
              :aria-selected="generatorProductType === 'consumer'"
              @click="generatorProductType = 'consumer'"
            >普通授权 C 端</button>
            <button
              type="button"
              :class="{ active: generatorProductType === 'business' }"
              role="tab"
              :aria-selected="generatorProductType === 'business'"
              @click="generatorProductType = 'business'"
            >专业授权 B 端</button>
          </div>
        </div>
      </template>
      <div v-if="generatorProductType === 'business'" class="business-value-strip">
        <div>
          <span class="business-kicker">BUSINESS ACCESS</span>
          <strong>专业工作台授权</strong>
          <p>用于教师、运营及批量操作人员。当前处于内部验证阶段。</p>
        </div>
        <ul>
          <li>专业工作台</li>
          <li>本地批量导入</li>
          <li>多账号任务管理</li>
        </ul>
      </div>
      <div class="generate-form">
        <label class="generate-field generate-field--wide">
          <span>套餐</span>
          <el-select v-model="selectedPlanId" placeholder="选择套餐">
            <el-option
              v-for="plan in availablePlans"
              :key="plan.id"
              :label="`${plan.name} · ¥${plan.price}`"
              :value="plan.id"
            />
          </el-select>
        </label>
        <label class="generate-field">
          <span>平台权限</span>
          <el-select v-model="selectedPlatformScope" placeholder="平台权限">
            <el-option label="亚马逊" value="amazon" />
            <el-option label="速卖通" value="aliexpress" />
            <el-option label="双平台" value="amazon,aliexpress" />
          </el-select>
        </label>
        <label v-if="generatorProductType === 'consumer'" class="generate-field">
          <span>场景类型</span>
          <el-select v-model="selectedSceneType" placeholder="场景类型">
            <el-option label="比赛" value="competition" />
            <el-option label="课程" value="course" />
          </el-select>
        </label>
        <label class="generate-field">
          <span>生成数量</span>
          <el-input-number v-model="generateCount" :min="1" :max="100" />
        </label>
        <label class="generate-field">
          <span>席位数</span>
          <el-input-number v-model="seatLimit" :min="1" :max="10" />
        </label>
        <label class="generate-field">
          <span>设备数</span>
          <el-input-number v-model="maxDevices" :min="1" :max="10" />
        </label>
        <div class="generate-actions">
          <el-button type="primary" @click="handleGenerate" :loading="isLoading">
            {{ isLoading ? '生成中...' : '生成授权码' }}
          </el-button>
        </div>
      </div>
    </el-card>

    <el-card v-if="loadState !== 'loading' && loadState !== 'error'" class="table-card">
      <template #header>
        <div class="card-header">
          <h3>授权码列表</h3>
        </div>
      </template>
      <DataToolbar label="授权码筛选">
        <el-input v-model="searchText" placeholder="搜索全部授权码/设备..." :maxlength="200" style="width: 220px;" clearable @keyup.enter="applyKeyword" />
        <el-select v-model="filterProductType" placeholder="全部产品" clearable style="width: 150px;">
          <el-option label="普通 C 端" value="consumer" />
          <el-option label="专业 B 端" value="business" />
        </el-select>
        <el-select v-model="filterStatus" placeholder="全部状态" clearable style="width: 150px;">
          <el-option label="未使用" value="unused" />
          <el-option label="已激活" value="active" />
          <el-option label="已冻结" value="frozen" />
          <el-option label="已过期" value="expired" />
        </el-select>
        <template #summary>共 {{ total }} 个授权 · 本页 {{ authCodes.length }} 个</template>
      </DataToolbar>
      <el-table :data="filteredCodes" style="width: 100%" v-loading="isLoading">
        <el-table-column label="授权码" min-width="180">
          <template #default="{ row }">
            <a href="#" @click.prevent="openDetail(row)" class="code-link">{{ row.code }}</a>
          </template>
        </el-table-column>
        <el-table-column label="产品类型" width="120">
          <template #default="{ row }">
            <span :class="['product-type-badge', `is-${row.product_type}`]">
              {{ row.product_type === 'business' ? '专业 B 端' : '普通 C 端' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="套餐" min-width="120">
          <template #default="{ row }">
            {{ row.plan_name || getPlanName(row.plan_id) }}
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="平台权限" min-width="140">
          <template #default="{ row }">
            <el-tag v-for="p in (row.platform_scope || ['amazon'])" :key="p" 
                    :type="p === 'amazon' ? 'warning' : 'danger'" size="small" class="platform-tag">
              {{ p === 'amazon' ? '亚马逊' : '速卖通' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)" size="small">
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="席位" width="80">
          <template #default="{ row }">
            <span v-if="row.seat_limit" class="seat-badge">
              {{ row.seat_used || 0 }}/{{ row.seat_limit }}
            </span>
            <span v-else class="text-muted">-</span>
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="设备数" width="100">
          <template #default="{ row }">
            <el-tag :type="getDeviceType(row)" size="small" class="device-badge" 
                    @click="canWrite && editMaxDevices(row)" :style="{ cursor: canWrite ? 'pointer' : 'default' }">
              {{ row.device_used || getDeviceCount(row) }}/{{ row.max_devices || 1 }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="过期时间" width="120">
          <template #default="{ row }">
            <span class="text-small">{{ formatDate(row.expires_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="isCompact ? 136 : 280" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openDetail(row)">详情</el-button>
            <el-dropdown v-if="isCompact && canWrite" trigger="click" @command="command => handleCodeCommand(command, row)">
              <el-button size="small">更多</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="freeze" :disabled="row.status === 'expired'">{{ row.status === 'frozen' ? '解冻' : '冻结' }}</el-dropdown-item>
                  <el-dropdown-item command="extend" :disabled="row.status === 'deleted'">延期</el-dropdown-item>
                  <el-dropdown-item v-if="canDelete" command="delete" :disabled="row.status === 'deleted'" divided>删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <template v-else-if="canWrite">
              <el-button size="small" @click="toggleFreeze(row)" :disabled="row.status === 'expired'">{{ row.status === 'frozen' ? '解冻' : '冻结' }}</el-button>
              <el-button size="small" @click="openExtend(row)" :disabled="row.status === 'deleted'">延期</el-button>
              <el-button v-if="canDelete" size="small" type="danger" @click="deleteCode(row.id)" :disabled="row.status === 'deleted'">删除</el-button>
            </template>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-state">暂无数据</div>
        </template>
      </el-table>
      <div class="authorization-pagination">
        <el-pagination :current-page="page" :page-size="pageSize" :total="total" :pager-count="5" layout="prev, pager, next" @current-change="changePage" />
      </div>
    </el-card>

    <AdminDetailDrawer
      v-model="showGeneratedDrawer"
      :title="generatorProductType === 'business' ? '专业授权已生成' : '授权码已生成'"
      size="min(520px, 94vw)"
    >
      <div class="generated-success">
        <span :class="['success-mark', { business: generatorProductType === 'business' }]">
          <Check :size="25" />
        </span>
        <span class="success-eyebrow">{{ generatorProductType === 'business' ? 'BUSINESS LICENSE' : 'CUSTOMER LICENSE' }}</span>
        <h3>{{ generatorProductType === 'business' ? '专业工作台授权' : '普通工具箱授权' }}</h3>
        <p>{{ selectedPlan?.name || '当前套餐' }} · {{ generatedCodes.length }} 个授权码</p>
        <div class="generated-code-list">
          <button v-for="code in generatedCodes" :key="code" type="button" @click="copyText(code)">
            <span>{{ code }}</span><Copy :size="15" />
          </button>
        </div>
        <div class="generated-meta">
          <span><small>设备</small><strong>{{ maxDevices }} 台</strong></span>
          <span><small>席位</small><strong>{{ seatLimit }} 个</strong></span>
          <span><small>状态</small><strong>可以登录</strong></span>
        </div>
      </div>
      <template #footer>
        <el-button @click="showGeneratedDrawer = false">继续生成</el-button>
        <el-button @click="copyCodes">复制全部</el-button>
        <el-button
          v-if="generatedCodes[0]"
          type="primary"
          @click="loginWithGeneratedCode"
        >{{ generatorProductType === 'business' ? '用此码登录专业工作台' : '用此码登录普通工具箱' }}</el-button>
      </template>
    </AdminDetailDrawer>

    <!-- 修改最大设备数弹窗 -->
    <el-dialog v-model="showDeviceModal" title="修改最大设备数" width="400px">
      <p class="dialog-info">授权码：{{ editingCode?.code }}</p>
      <div class="dialog-form-row">
        <label>最大设备数：</label>
        <el-input-number v-model="newMaxDevices" :min="1" :max="20" />
      </div>
      <template #footer>
        <el-button @click="showDeviceModal = false">取消</el-button>
        <el-button type="primary" @click="saveMaxDevices">确认</el-button>
      </template>
    </el-dialog>

    <!-- 延期弹窗 -->
    <el-dialog v-model="showExtendModal" title="授权码延期" width="400px">
      <p class="dialog-info">授权码：{{ extendingCode?.code }}</p>
      <p class="dialog-subtitle">当前过期时间：{{ formatDate(extendingCode?.expires_at) }}</p>
      <div class="dialog-form-row">
        <label>延期天数：</label>
        <el-input-number v-model="extendDays" :min="1" :max="365" />
      </div>
      <template #footer>
        <el-button @click="showExtendModal = false">取消</el-button>
        <el-button type="primary" @click="confirmExtend">确认延期</el-button>
      </template>
    </el-dialog>

    <!-- 授权码详情 -->
    <AdminDetailDrawer v-model="showDetailModal" title="授权码详情" size="min(600px, 92vw)" @update:model-value="onDetailVisibility">
      <div v-if="detailError" class="detail-error" role="alert">{{ detailError }}</div>
      <div v-if="detailData" class="detail-grid">
        <div class="detail-section related-users">
          <h3>关联用户</h3>
          <p class="text-muted text-small">按当前用户的授权关联读取，不按姓名或代理客户编号合并。</p>
          <p v-if="relatedUsersLoading" class="text-muted">正在读取关联用户…</p>
          <div v-else-if="relatedUsersError" class="detail-error" role="alert">{{ relatedUsersError }}<el-button size="small" @click="loadRelatedUsers">重试</el-button></div>
          <template v-else>
            <div v-for="user in relatedUsers" :key="user.id" class="related-user-row">
              <span><strong>{{ user.name || '未填写姓名' }}</strong><small>用户 #{{ user.id }} · {{ user.device_name || '未填写设备名' }}</small></span>
              <div><el-button size="small" @click="openRelatedUser(user.id)">用户详情</el-button><el-button size="small" @click="openRelatedFeedback(user.id)">工单</el-button></div>
            </div>
            <p v-if="!relatedUsers.length" class="text-muted">暂无当前关联用户，授权尚未激活或用户已更换授权。</p>
            <el-pagination v-if="relatedUsersTotal > 10" :current-page="relatedUsersPage" :page-size="10" :total="relatedUsersTotal" layout="prev, pager, next" @current-change="changeRelatedUsersPage" />
          </template>
        </div>
        <div class="detail-row">
          <span class="detail-label">授权码</span>
          <span class="detail-value" style="font-family: monospace;">{{ detailData.code }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">套餐</span>
          <span class="detail-value">{{ detailData.plan_name || getPlanName(detailData.plan_id) }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">产品类型</span>
          <span class="detail-value">{{ detailData.product_type === 'business' ? '专业 B 端' : '普通 C 端' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">状态</span>
          <span class="detail-value">
            <el-tag :type="getStatusType(detailData.status)" size="small">
              {{ getStatusText(detailData.status) }}
            </el-tag>
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">平台权限</span>
          <span class="detail-value">
            <el-tag v-for="p in (detailData.platform_scope || ['amazon'])" :key="p" 
                    :type="p === 'amazon' ? 'warning' : 'danger'" size="small" class="platform-tag">
              {{ p === 'amazon' ? '亚马逊' : '速卖通' }}
            </el-tag>
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">场景类型</span>
          <span class="detail-value">{{ detailData.scene_type || '-' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">席位</span>
          <span class="detail-value"><strong>{{ detailData.seat_used || 0 }}</strong> / {{ detailData.seat_limit || '-' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">设备数</span>
          <span class="detail-value"><strong>{{ detailData.device_used || 0 }}</strong> / {{ detailData.max_devices || '-' }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">过期时间</span>
          <span class="detail-value">{{ formatDate(detailData.expires_at) }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">创建时间</span>
          <span class="detail-value">{{ formatDate(detailData.created_at) }}</span>
        </div>
        <div v-if="detailData.devices && detailData.devices.length" class="detail-section">
          <div class="detail-label" style="margin-bottom: 0.5rem;">绑定设备</div>
          <div v-for="dev in detailData.devices" :key="dev.id" class="device-item">
            <div class="device-item-info">
              <strong>{{ dev.device_name || dev.device_id }}</strong>
              <span class="text-muted text-small">{{ formatDate(dev.created_at) }}</span>
            </div>
            <el-button
              v-if="canUnbindDevice"
              :data-testid="`unbind-device-${dev.id}`"
              size="small"
              type="danger"
              plain
              :loading="String(unbindingDeviceId) === String(dev.id)"
              @click="handleUnbindDevice(dev)"
            >解绑</el-button>
          </div>
        </div>
      </div>
      <div v-else-if="detailLoading" class="empty-state">加载中...</div>
      <template #footer><el-button v-if="returnPath" @click="router.push(returnPath)">返回来源</el-button><el-button @click="closeDetail">返回列表</el-button></template>
    </AdminDetailDrawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Check, Copy } from '@lucide/vue'
import { ElMessageBox } from 'element-plus'
import { getAuthCodesPage, getAuthCode, getUsersPage, batchGenerateAuthCodes, updateAuthCode, deleteAuthCode, getPlansAdmin, unbindDevice } from '@/utils/api'
import { extendAuthCode } from '@/utils/api/auth-codes'
import { contextId, contextText, supportReturnPath, supportSourcePath } from '@/features/admin/supportContext'
import { showToast } from '@/utils'
import { authService } from '@/utils/auth'
import { hasStaffPermission } from '@/features/auth/permissions'
import { usePlatformStore } from '@/stores/platform'
import { useCompactLayout } from '@/composables/useCompactLayout'
import PageHeader from '@/components/PageHeader.vue'
import DataToolbar from '@/components/DataToolbar.vue'
import AdminDetailDrawer from '@/components/AdminDetailDrawer.vue'
import AsyncStateNotice from '@/components/AsyncStateNotice.vue'
import { confirmAction } from '@/shared/ui/confirm'
import { normalizeDeviceUnbindReason } from '@/features/admin/deviceUnbind'
import { failedDataState, settledDataState, type AsyncDataState } from '@/features/async/state'
import {
  adminAuthCodeSchema,
  adminUsersSchema,
  adminAuthCodesSchema,
  adminPlansSchema,
  generatedAuthCodesSchema,
  type AdminAuthCode,
  type AdminPlan,
  type AdminUser,
} from '@/features/admin/model'

const authCodes = ref<AdminAuthCode[]>([])
const plans = ref<AdminPlan[]>([])
const selectedPlanId = ref<string | number>(2)
const generatorProductType = ref<'consumer' | 'business'>('consumer')
const selectedPlatformScope = ref('amazon')
const selectedSceneType = ref<'competition' | 'course' | 'operations'>('competition')
const generateCount = ref(1)
const seatLimit = ref(1)
const maxDevices = ref(1)
const isLoading = ref(false)
const generatedCodes = ref<string[]>([])
const filterStatus = ref('')
const filterProductType = ref('')
const searchText = ref('')
const planNameMap = reactive<Record<string, string>>({})

const router = useRouter()
const query = () => router.currentRoute.value.query
function queryStatus() { const value = contextText(query().status); return ['unused', 'active', 'frozen', 'expired'].includes(value) ? value : '' }
function queryProduct() { const value = contextText(query().product); return ['consumer', 'business'].includes(value) ? value : '' }
filterStatus.value = queryStatus()
filterProductType.value = queryProduct()
searchText.value = contextText(query().keyword)
const page = ref(contextId(query().page) || 1)
const pageSize = 20
const total = ref(0)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let restoringQuery = false
const platformStore = usePlatformStore()
const isCompact = useCompactLayout()
const canWrite = computed(() => hasStaffPermission(authService.getRole(), 'auth_codes.write'))
const canDelete = computed(() => hasStaffPermission(authService.getRole(), 'auth_codes.delete'))
const canUnbindDevice = computed(() => hasStaffPermission(authService.getRole(), 'devices.unbind'))
const showGeneratedDrawer = ref(false)

// 设备数弹窗
const showDeviceModal = ref(false)
const editingCode = ref<AdminAuthCode | null>(null)
const newMaxDevices = ref(1)

// 延期弹窗
const showExtendModal = ref(false)
const extendingCode = ref<AdminAuthCode | null>(null)
const extendDays = ref(30)

// 详情弹窗
const showDetailModal = ref(false)
const detailData = ref<AdminAuthCode | null>(null)
const selectedCodeId = ref<number | undefined>()
const detailError = ref('')
const detailLoading = ref(false)
const relatedUsers = ref<AdminUser[]>([])
const relatedUsersPage = ref(1)
const relatedUsersTotal = ref(0)
const relatedUsersError = ref('')
const relatedUsersLoading = ref(false)
const returnPath = computed(() => supportReturnPath(query().return_to, authService.getRole()))
let loadSequence = 0
let detailSequence = 0
let relatedSequence = 0
const unbindingDeviceId = ref<string | number | null>(null)
const loadState = ref<AsyncDataState>('loading')
const loadError = ref('')

const availablePlans = computed(() =>
  plans.value.filter(plan => plan.product_type === generatorProductType.value && plan.status === 'active'),
)
const selectedPlan = computed(() => plans.value.find(plan => plan.id === selectedPlanId.value))

const filteredCodes = computed(() => authCodes.value)

function getPlanName(planId?: string | number | null) {
  return planId === null || planId === undefined ? '未关联套餐' : planNameMap[String(planId)] || '未关联套餐'
}

function getStatusType(status?: string | null): 'warning' | 'success' | 'info' | 'danger' {
  const map: Record<string, 'warning' | 'success' | 'info' | 'danger'> = { unused: 'warning', active: 'success', frozen: 'info', expired: 'danger' }
  return status ? map[status] || 'info' : 'info'
}

function getStatusText(status?: string | null) {
  const map: Record<string, string> = { unused: '未使用', active: '已激活', frozen: '已冻结', expired: '已过期' }
  return status ? map[status] || status : '-'
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('zh-CN')
}

function getDeviceCount(rawCode: unknown) {
  const code = adminAuthCodeSchema.parse(rawCode)
  return code.devices?.length || (code.device_name ? 1 : 0)
}

function getDeviceType(rawCode: unknown): 'danger' | 'success' | 'info' {
  const code = adminAuthCodeSchema.parse(rawCode)
  const count = getDeviceCount(code)
  const max = code.max_devices || 1
  if (count >= max) return 'danger'
  if (count > 0) return 'success'
  return 'info'
}

function editMaxDevices(rawCode: unknown) {
  const code = adminAuthCodeSchema.parse(rawCode)
  editingCode.value = code
  newMaxDevices.value = code.max_devices || 1
  showDeviceModal.value = true
}

async function saveMaxDevices() {
  if (!editingCode.value) return
  if (newMaxDevices.value < 1) {
    showToast('设备数不能小于1', 'error')
    return
  }
  try {
    await updateAuthCode(editingCode.value.id, { max_devices: newMaxDevices.value })
    showToast('设备数已更新', 'success')
    showDeviceModal.value = false
    await loadData()
  } catch {
    showToast('更新失败', 'error')
  }
}

async function loadData() {
  const sequence = ++loadSequence
  loadState.value = authCodes.value.length ? 'data' : 'loading'
  loadError.value = ''
  const platformKey = platformStore.adminPlatform !== 'all' ? platformStore.adminPlatform : undefined
  const params = {
    ...(platformKey ? { platform_key: platformKey } : {}),
    page: page.value,
    page_size: pageSize,
    status: filterStatus.value || undefined,
    product_type: filterProductType.value || undefined,
    keyword: searchText.value.trim() || undefined,
  }
  const [codesResult, plansResult] = await Promise.allSettled([
    getAuthCodesPage(params),
    getPlansAdmin({ page_size: 100 }),
  ])
  if (sequence !== loadSequence) return
  try {
    if (codesResult.status === 'fulfilled') {
      authCodes.value = adminAuthCodesSchema.parse(codesResult.value.items)
      total.value = codesResult.value.total
      if (page.value > 1 && (page.value - 1) * pageSize >= total.value) {
        page.value = Math.max(1, Math.ceil(total.value / pageSize))
        syncQuery()
        await loadData()
        return
      }
      loadState.value = settledDataState(authCodes.value.length)
    } else {
      loadError.value = codesResult.reason instanceof Error && codesResult.reason.message
        ? codesResult.reason.message
        : '授权码数据暂时无法加载'
      loadState.value = failedDataState(authCodes.value.length > 0)
    }
    if (plansResult.status === 'fulfilled') {
      const parsedPlans = adminPlansSchema.parse(plansResult.value)
      plans.value = parsedPlans
      const preferredPlan = parsedPlans.find(plan =>
        plan.product_type === generatorProductType.value && plan.status === 'active')
      if (preferredPlan) selectedPlanId.value = preferredPlan.id
      parsedPlans.forEach((plan) => { planNameMap[String(plan.id)] = plan.name })
    }
    if (codesResult.status === 'rejected' && plansResult.status === 'rejected') {
      showToast('数据加载失败', 'error')
    }
  } catch (error) {
    loadError.value = error instanceof Error && error.message ? error.message : '授权码数据暂时无法加载'
    loadState.value = failedDataState(authCodes.value.length > 0)
    showToast('数据加载失败', 'error')
  }
}

watch(() => platformStore.adminPlatform, () => {
  if (searchTimer) clearTimeout(searchTimer)
  detailSequence += 1
  relatedSequence += 1
  detailData.value = null
  relatedUsers.value = []
  showDetailModal.value = false
  selectedCodeId.value = undefined
  showDeviceModal.value = false
  showExtendModal.value = false
  editingCode.value = null
  extendingCode.value = null
  authCodes.value = []
  total.value = 0
  page.value = 1
  syncQuery({ auth_code_id: undefined, return_to: undefined })
  void loadData()
})
function applyKeyword() {
  if (searchTimer) clearTimeout(searchTimer)
  page.value = 1
  syncQuery()
  void loadData()
}
function changePage(value: number) {
  if (searchTimer) clearTimeout(searchTimer)
  page.value = value
  syncQuery()
  void loadData()
}
watch([filterStatus, filterProductType], () => { if (!restoringQuery) applyKeyword() }, { flush: 'sync' })
watch(searchText, () => {
  if (restoringQuery) return
  if (searchTimer) clearTimeout(searchTimer)
  // Invalidate in-flight results as soon as the search changes, not after the debounce.
  loadSequence += 1
  searchTimer = setTimeout(applyKeyword, 250)
}, { flush: 'sync' })
watch(() => [query().status, query().product, query().keyword, query().page], () => {
  const nextStatus = queryStatus()
  const nextProduct = queryProduct()
  const nextKeyword = contextText(query().keyword)
  const nextPage = contextId(query().page) || 1
  if (filterStatus.value === nextStatus && filterProductType.value === nextProduct && searchText.value === nextKeyword && page.value === nextPage) return
  if (searchTimer) clearTimeout(searchTimer)
  restoringQuery = true
  filterStatus.value = nextStatus
  filterProductType.value = nextProduct
  searchText.value = nextKeyword
  page.value = nextPage
  restoringQuery = false
  void loadData()
})
watch(generatorProductType, productType => {
  const preferredPlan = plans.value.find(plan => plan.product_type === productType && plan.status === 'active')
  if (preferredPlan) selectedPlanId.value = preferredPlan.id
  selectedSceneType.value = productType === 'business' ? 'operations' : 'competition'
  generatedCodes.value = []
})

async function handleGenerate() {
  if (!generateCount.value || generateCount.value < 1) {
    showToast('请输入生成数量', 'error')
    return
  }
  if (!selectedPlan.value || selectedPlan.value.product_type !== generatorProductType.value) {
    showToast(generatorProductType.value === 'business' ? '请先配置可用的 B 端套餐' : '请选择可用套餐', 'error')
    return
  }
  isLoading.value = true
  try {
    const res = generatedAuthCodesSchema.parse(await batchGenerateAuthCodes({
      plan_id: Number(selectedPlanId.value),
      count: generateCount.value,
      platform_scope: selectedPlatformScope.value,
      scene_type: selectedSceneType.value,
      seat_limit: seatLimit.value,
      max_devices: maxDevices.value
    }))
    if (res.success) {
      generatedCodes.value = res.codes
      showGeneratedDrawer.value = true
      showToast(`成功生成 ${res.count} 个授权码`, 'success')
      await loadData()
    }
  } catch {
    showToast('生成失败', 'error')
  }
  isLoading.value = false
}

async function toggleFreeze(rawCode: unknown) {
  const code = adminAuthCodeSchema.parse(rawCode)
  // Releasing all devices frees capacity, but does not undo first activation.
  const restoredStatus = Number(code.user_id) > 0 ? 'active' : 'unused'
  const newStatus = code.status === 'frozen' ? restoredStatus : 'frozen'
  try {
    await updateAuthCode(code.id, { status: newStatus })
    showToast(newStatus === 'frozen' ? '已冻结' : '已解冻', 'success')
    await loadData()
  } catch {
    showToast('操作失败', 'error')
  }
}

function openExtend(rawCode: unknown) {
  extendingCode.value = adminAuthCodeSchema.parse(rawCode)
  extendDays.value = 30
  showExtendModal.value = true
}

function handleCodeCommand(command: string, code: unknown) {
  const parsedCode = adminAuthCodeSchema.parse(code)
  if (command === 'freeze') toggleFreeze(parsedCode)
  if (command === 'extend') openExtend(parsedCode)
  if (command === 'delete') deleteCode(parsedCode.id)
}

async function confirmExtend() {
  if (!extendingCode.value) return
  if (!Number.isInteger(extendDays.value) || extendDays.value < 1 || extendDays.value > 3650) {
    showToast('请输入有效天数', 'error')
    return
  }
  try {
    const codeId = extendingCode.value.id
    await extendAuthCode(codeId, extendDays.value)
    showToast(`已延期 ${extendDays.value} 天`, 'success')
    showExtendModal.value = false
    await loadData()
  } catch {
    showToast('延期失败', 'error')
  }
}

async function deleteCode(id: string | number) {
  if (!await confirmAction({
    title: '删除授权码？',
    message: '删除后该授权码将无法继续使用，此操作不能撤销。',
    confirmText: '确认删除',
    danger: true,
  })) return
  try {
    await deleteAuthCode(id)
    showToast('已删除', 'success')
    await loadData()
  } catch {
    showToast('删除失败', 'error')
  }
}

function copyCodes() {
  const text = generatedCodes.value.join('\n')
  navigator.clipboard.writeText(text).then(() => {
    showToast('授权码已复制到剪贴板', 'success')
  }).catch(() => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    showToast('授权码已复制到剪贴板', 'success')
  })
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    showToast('授权码已复制', 'success')
  } catch {
    showToast('复制失败，请手动复制', 'error')
  }
}

async function loginWithGeneratedCode() {
  const code = generatedCodes.value[0]
  if (!code) return
  sessionStorage.setItem('toolbox_login_handoff_code', code)
  showGeneratedDrawer.value = false
  authService.clear()
  await router.replace('/user/login')
}

async function openDetail(rawCode: unknown) {
  const code = adminAuthCodeSchema.parse(rawCode)
  syncQuery({ auth_code_id: String(code.id) })
  await openCode(Number(code.id))
}

function scopeParams() { return platformStore.adminPlatform === 'all' ? {} : { platform_key: platformStore.adminPlatform } }
function syncQuery(extra: Record<string, string | undefined> = {}) {
  void router.replace({ path: '/admin/authcodes', query: { ...query(), page: String(page.value), status: filterStatus.value || undefined, product: filterProductType.value || undefined, keyword: searchText.value || undefined, ...extra } })
}
async function openCode(id: number) {
  const sequence = ++detailSequence
  relatedSequence += 1
  selectedCodeId.value = id
  detailData.value = null
  relatedUsers.value = []
  relatedUsersPage.value = 1
  detailError.value = ''
  showDetailModal.value = true
  detailLoading.value = true
  try {
    const detail = adminAuthCodeSchema.parse(await getAuthCode(id, scopeParams()))
    if (sequence !== detailSequence) return
    if (Number(detail.id) !== id) throw new Error('授权编号不匹配，请重新读取')
    detailData.value = detail
    void loadRelatedUsers()
  } catch (error) {
    if (sequence === detailSequence) detailError.value = error instanceof Error ? error.message : '无法读取授权，请核对权限与当前平台'
  } finally { if (sequence === detailSequence) detailLoading.value = false }
}
async function loadRelatedUsers() {
  if (!detailData.value) return
  const sequence = ++relatedSequence
  const id = detailData.value.id
  relatedUsersLoading.value = true
  relatedUsersError.value = ''
  try {
    const result = await getUsersPage({ ...scopeParams(), auth_code_id: id, page: relatedUsersPage.value, page_size: 10 })
    if (sequence !== relatedSequence || String(detailData.value?.id) !== String(id)) return
    relatedUsers.value = adminUsersSchema.parse(result.items)
    relatedUsersTotal.value = result.total
  } catch {
    if (sequence === relatedSequence) { relatedUsers.value = []; relatedUsersError.value = '关联用户读取失败，不能据此认定没有用户。' }
  } finally { if (sequence === relatedSequence) relatedUsersLoading.value = false }
}
function changeRelatedUsersPage(page: number) { relatedUsersPage.value = page; void loadRelatedUsers() }
function openRelatedUser(id: string | number) { void router.push({ path: '/admin/users', query: { user_id: String(id), return_to: supportSourcePath(router.currentRoute.value.fullPath) } }) }
function openRelatedFeedback(id: string | number) { void router.push({ path: '/admin/feedback', query: { user_id: String(id), return_to: supportSourcePath(router.currentRoute.value.fullPath) } }) }
function closeDetail() {
  detailSequence += 1
  relatedSequence += 1
  showDetailModal.value = false
  detailData.value = null
  selectedCodeId.value = undefined
  syncQuery({ auth_code_id: undefined })
}
function onDetailVisibility(value: boolean) { if (!value) closeDetail() }
async function promptDeviceUnbindReason(deviceName: string): Promise<string | null> {
  try {
    const result = await ElMessageBox.prompt(`请输入解绑“${deviceName}”的原因。该原因会写入审计记录。`, '解绑设备', {
      confirmButtonText: '确认解绑',
      cancelButtonText: '取消',
      inputPlaceholder: '请填写至少 2 个字的原因',
      inputValidator: (value: string) => {
        try {
          normalizeDeviceUnbindReason(value)
          return true
        } catch (error) {
          return error instanceof Error ? error.message : '请输入有效原因'
        }
      },
      type: 'warning',
      closeOnClickModal: false,
    })
    return normalizeDeviceUnbindReason(result.value)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return null
    throw error
  }
}

async function handleUnbindDevice(device: AdminAuthCode['devices'][number]) {
  if (!canUnbindDevice.value || unbindingDeviceId.value !== null) return
  const sequence = detailSequence
  const codeId = detailData.value?.id
  if (!codeId) return
  try {
    const reason = await promptDeviceUnbindReason(device.device_name || device.device_id)
    if (!reason || sequence !== detailSequence) return
    unbindingDeviceId.value = device.id
    await unbindDevice(device.id, reason)
    if (sequence !== detailSequence) return
    const updated = adminAuthCodeSchema.parse(await getAuthCode(codeId, scopeParams()))
    if (sequence !== detailSequence) return
    detailData.value = updated
    await loadData()
    showToast('设备已解绑', 'success')
  } catch {
    showToast('设备解绑失败', 'error')
  } finally {
    unbindingDeviceId.value = null
  }
}

onMounted(() => {
  if (router.currentRoute.value.query.product === 'business') {
    generatorProductType.value = 'business'
    filterProductType.value = 'business'
  }
  void loadData()
  const id = contextId(query().auth_code_id)
  if (id) void openCode(id)
})
watch(() => query().auth_code_id, value => { const id = contextId(value); if (id && id !== selectedCodeId.value) void openCode(id); else if (!id && showDetailModal.value) { detailSequence += 1; relatedSequence += 1; showDetailModal.value = false; detailData.value = null; selectedCodeId.value = undefined } })
onBeforeUnmount(() => { loadSequence += 1; detailSequence += 1; relatedSequence += 1; if (searchTimer) clearTimeout(searchTimer) })
</script>

<style scoped>
.authorization-pagination { display: flex; justify-content: flex-end; margin-top: 16px; overflow-x: auto; }
.detail-error { color: var(--color-danger, #b42318); line-height: 1.6; }
.related-users { padding: 16px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-surface-soft); }
.related-users h3 { margin: 0 0 8px; font-size: 15px; }
.related-user-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; }
.related-user-row > span { min-width: 0; display: grid; gap: 4px; overflow-wrap: anywhere; }
.related-user-row small { color: var(--color-text-secondary); }
.table-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-low);
}
.generator-card { margin-bottom: 24px; overflow: hidden; }
.generator-card.is-business {
  border-color: rgba(169,133,82,.3);
  background: linear-gradient(180deg, var(--color-surface), var(--color-surface-premium, #f8f7f4));
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-header > div:first-child { display: grid; gap: 4px; }
.card-header p { margin: 0; color: var(--color-text-secondary); font-size: var(--type-meta); }

.card-header h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.business-center-link {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  padding: 0 14px;
  border: 1px solid rgba(169,133,82,.34);
  border-radius: 10px;
  color: #765d38;
  background: var(--color-surface-premium, #f8f7f4);
  font-size: var(--type-control);
  font-weight: 700;
  text-decoration: none;
}

.product-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  background: var(--color-surface-soft);
}
.product-switch button {
  min-height: 34px;
  padding: 0 13px;
  border: 0;
  border-radius: 8px;
  color: var(--color-text-secondary);
  background: transparent;
  font-size: var(--type-control);
  font-weight: 700;
  cursor: pointer;
}
.product-switch button.active {
  color: var(--color-primary);
  background: var(--color-surface);
  box-shadow: var(--shadow-low);
}
.product-switch button:last-child.active { color: #765d38; }

.business-value-strip {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) auto;
  align-items: center;
  gap: 28px;
  margin: 4px 0 18px;
  padding: 18px 20px;
  border: 1px solid rgba(169,133,82,.24);
  border-radius: 14px;
  background: #f8f5ef;
}
.business-value-strip > div { display: grid; gap: 5px; }
.business-kicker { color: var(--color-premium); font-size: var(--type-micro); font-weight: 800; letter-spacing: .12em; }
.business-value-strip strong { color: var(--color-text); font-size: var(--type-card); }
.business-value-strip p { margin: 0; color: var(--color-text-secondary); font-size: var(--type-control); }
.business-value-strip ul { display: flex; gap: 8px; margin: 0; padding: 0; list-style: none; }
.business-value-strip li {
  padding: 7px 10px;
  border: 1px solid rgba(169,133,82,.2);
  border-radius: 8px;
  color: #765d38;
  background: rgba(255,255,255,.72);
  font-size: var(--type-meta);
  font-weight: 700;
  white-space: nowrap;
}

.generate-form {
  display: grid;
  grid-template-columns: minmax(180px, 1.35fr) repeat(5, minmax(112px, 1fr));
  align-items: end;
  gap: 14px;
  padding: 1rem 0;
}

.generate-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}

.generate-field > span {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.generate-field :deep(.el-select),
.generate-field :deep(.el-input-number) { width: 100%; }

.generate-actions {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-height: 34px;
}

.generated-count {
  font-size: 0.85rem;
  color: var(--color-primary);
  font-weight: 600;
}

.data-toolbar-v6 { margin-bottom: 1rem; }

.code-link {
  font-family: monospace;
  font-size: 0.85rem;
  color: var(--color-text);
  text-decoration: none;
  font-weight: 500;
}

.code-link:hover {
  color: var(--color-primary);
}

.platform-tag {
  margin-right: 0.25rem;
}

.seat-badge {
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(16, 185, 129, 0.1);
  color: var(--color-success);
}

.device-badge {
  cursor: pointer;
}

.text-muted {
  color: var(--color-text-secondary);
}

.text-small {
  font-size: 0.8rem;
}

.product-type-badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 9px;
  border-radius: 99px;
  color: var(--color-text-secondary);
  background: var(--color-surface-soft);
  font-size: var(--type-micro);
  font-weight: 800;
}
.product-type-badge.is-business { color: #765d38; background: #f3ecdf; }

.generated-success { display: grid; justify-items: center; padding: 6px 0 20px; text-align: center; }
.success-mark {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  margin-bottom: 14px;
  border-radius: 18px;
  color: white;
  background: var(--color-success);
  box-shadow: 0 12px 28px rgba(22,138,99,.16);
}
.success-mark.business { background: var(--color-primary); box-shadow: 0 12px 28px rgba(45,95,202,.17); }
.success-eyebrow { color: var(--color-premium); font-size: var(--type-micro); font-weight: 800; letter-spacing: .12em; }
.generated-success h3 { margin: 7px 0 5px; color: var(--color-text); font-size: 21px; }
.generated-success > p { margin: 0 0 18px; color: var(--color-text-secondary); font-size: var(--type-control); }
.generated-code-list { width: 100%; display: grid; gap: 8px; }
.generated-code-list button {
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 14px;
  border: 1px solid var(--color-border);
  border-radius: 11px;
  color: var(--color-text);
  background: var(--color-surface-soft);
  cursor: pointer;
}
.generated-code-list button span { overflow-wrap: anywhere; font: 700 14px/1.4 var(--font-mono, monospace); }
.generated-code-list button svg { flex: none; color: var(--color-primary); }
.generated-meta { width: 100%; display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin-top: 14px; }
.generated-meta span { display: grid; gap: 4px; padding: 11px; border-radius: 10px; background: var(--color-surface-soft); }
.generated-meta small { color: var(--color-text-tertiary); font-size: var(--type-micro); }
.generated-meta strong { color: var(--color-text); font-size: var(--type-meta); }

.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-secondary);
}

.dialog-info {
  font-family: monospace;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-bottom: 1rem;
}

.dialog-subtitle {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-bottom: 1rem;
}

.dialog-form-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 1rem 0;
}

.dialog-form-row label {
  font-size: 0.9rem;
  color: var(--color-text);
  white-space: nowrap;
}

.detail-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.detail-row {
  display: flex;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-border);
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-label {
  width: 100px;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.detail-value {
  flex: 1;
  font-size: 0.9rem;
  color: var(--color-text);
}

.detail-section {
  margin-top: 1rem;
}

.device-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem;
  background: var(--color-canvas);
  border-radius: 6px;
  margin-bottom: 0.5rem;
  font-size: 0.85rem;
}
.device-item-info { display: flex; min-width: 0; flex-direction: column; gap: .2rem; }

:deep(.el-table) {
  --el-table-border-color: var(--color-border);
  --el-table-header-bg-color: var(--color-canvas);
  --el-table-row-hover-bg-color: var(--color-canvas);
}

:deep(.el-card__header) {
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
}

:deep(.el-card__body) {
  padding: 1.25rem;
}

@media (max-width: 1180px) {
  .generate-form { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .generate-field--wide { grid-column: span 1; }
}

@media (max-width: 900px) {
  .generate-form { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .card-header { align-items: flex-start; gap: 14px; }
  .business-value-strip { grid-template-columns: 1fr; gap: 14px; }
  .business-value-strip ul { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); }
  .business-value-strip li { text-align: center; white-space: normal; }
}

@media (max-width: 768px) {
  .card-header { display: grid; }
  .product-switch { width: 100%; }
  .generate-form { grid-template-columns: 1fr; }
  .generate-actions { grid-column: auto; display: grid; grid-template-columns: 1fr; }
  .generate-actions :deep(.el-button) { width: 100%; margin-left: 0; }
  .generated-count { text-align: center; }
  .detail-row { align-items: flex-start; }
  .business-value-strip ul { grid-template-columns: 1fr; }
  .generated-meta { grid-template-columns: 1fr; }
}
</style>
