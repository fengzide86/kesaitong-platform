<template>
  <div>
  <PageHeader title="订单管理" description="按来源查看订单；直营订单在此处理，代理订单只读核对并由负责人进入代理交付。">
    <template #actions><el-button v-if="canManageAgency" @click="router.push('/admin/agency?section=orders')">代理订单交付</el-button></template>
  </PageHeader>
    <AsyncStateNotice :state="loadState" :message="loadError" loading-text="正在加载订单…" @retry="loadData" />

    <section v-if="loadState !== 'loading' && loadState !== 'error'" class="order-stats" aria-label="订单统计">
      <article class="stat-card">
          <div class="stat-label">{{ filterStatus ? '匹配订单数' : '总订单数' }}</div>
          <div class="stat-value" style="color: var(--color-primary);">{{ stats.total }}</div>
      </article>
      <article class="stat-card">
          <div class="stat-label">本页已收款</div>
          <div class="stat-value">{{ stats.paid }}</div>
      </article>
      <article class="stat-card">
          <div class="stat-label">本页待收款</div>
          <div class="stat-value" style="color: var(--color-warning);">{{ stats.pending }}</div>
      </article>
      <article class="stat-card">
          <div class="stat-label">本页已退款</div>
          <div class="stat-value" style="color: var(--color-danger);">{{ stats.refunded }}</div>
      </article>
      <article class="stat-card">
          <div class="stat-label">本页已取消</div>
          <div class="stat-value">{{ stats.cancelled }}</div>
      </article>
    </section>

    <!-- 创建订单 -->
    <el-card v-if="canWrite && loadState !== 'loading' && loadState !== 'error'" class="table-card" style="margin-bottom: 1.5rem;">
      <template #header>
        <div class="card-header">
          <h3>创建新订单</h3>
        </div>
      </template>
      <div class="form-row">
        <label class="order-field order-field--wide"><span>套餐</span><el-select v-model="newOrder.plan_id" placeholder="选择启用套餐"><el-option v-for="plan in activePlans" :key="plan.id" :label="`${plan.name} - ¥${plan.price}`" :value="plan.id" /></el-select></label>
        <label class="order-field order-field--wide"><span>人工收款渠道</span><el-input v-model="newOrder.channel" placeholder="如微信转账 / 银行转账 / 线下收款" /></label>
        <label class="order-field"><span>负责人</span><el-input v-model="newOrder.responsible" placeholder="负责人" /></label>
        <div class="order-submit"><el-button type="primary" @click="createOrder" :loading="isLoading">{{ isLoading ? '创建中...' : '创建订单' }}</el-button></div>
      </div>
    </el-card>

    <el-card v-if="canReadPlans && loadState !== 'loading' && loadState !== 'error'" class="table-card plan-overview-card">
      <template #header>
        <div class="card-header">
          <div>
            <h3>套餐概览</h3>
            <small class="card-hint">三类后台角色均可查看；订单只能选择启用中的套餐</small>
          </div>
          <el-button v-if="canManageSettings" size="small" type="primary" @click="goPlanSettings">管理套餐</el-button>
        </div>
      </template>
      <el-table :data="plans" size="small" style="width:100%">
        <el-table-column prop="name" label="套餐" min-width="140" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag :type="getPlanStatusType(row.status)" size="small">{{ getPlanStatusText(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="价格" width="110"><template #default="{ row }">¥{{ row.price }}</template></el-table-column>
        <el-table-column label="时长" width="100"><template #default="{ row }">{{ row.duration_days }} 天</template></el-table-column>
        <el-table-column label="类型" width="120"><template #default="{ row }">{{ row.product_type === 'business' ? '专业 B 端' : '普通 C 端' }}</template></el-table-column>
      </el-table>
    </el-card>

    <el-card v-if="loadState !== 'loading' && loadState !== 'error'" class="table-card">
      <template #header>
        <div class="card-header">
          <h3>订单列表</h3>
        </div>
      </template>
      <DataToolbar label="订单筛选">
        <el-select v-model="filterSource" aria-label="订单来源" style="width: 170px;">
          <el-option label="直营订单" value="direct" />
          <el-option label="代理订单（只读）" value="agency" />
          <el-option label="全部来源" value="all" />
        </el-select>
        <el-select v-model="filterStatus" placeholder="全部状态" clearable style="width: 150px;">
              <el-option label="已收款" value="paid" />
              <el-option label="待收款" value="pending" />
          <el-option label="已退款" value="refunded" />
          <el-option label="已取消" value="cancelled" />
        </el-select>
        <template #summary>共 {{ total }} 笔 · 本页 {{ orders.length }} 笔</template>
        <template #actions>
          <el-button @click="exportOrdersData">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            导出 CSV
          </el-button>
        </template>
      </DataToolbar>
      <el-table :data="orders" style="width: 100%">
        <el-table-column label="来源" width="100"><template #default="{ row }">{{ row.agency_id ? '代理订单' : '直营登记' }}</template></el-table-column>
        <el-table-column label="订单号" min-width="140">
          <template #default="{ row }">
            <span style="font-family: monospace; font-size: 0.85rem;">{{ row.order_no }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="套餐" min-width="120">
          <template #default="{ row }">
            {{ getPlanName(row.plan_id) }}
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="金额" width="100">
          <template #default="{ row }">
            ¥{{ row.amount }}
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="渠道" width="120">
          <template #default="{ row }">
            {{ row.channel || '-' }}
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="负责人" width="120">
          <template #default="{ row }">
            {{ row.responsible || '-' }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="getStatusType(row.status)" size="small">
              {{ getStatusText(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="!isCompact" label="创建时间" width="140">
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" :width="isCompact ? 136 : 270" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openOrderDetail(row)">详情</el-button>
            <el-dropdown v-if="canOperateOrder(row) && isCompact && (row.status === 'pending' || row.status === 'paid')" trigger="click" @command="command => handleOrderCommand(command, row)">
              <el-button size="small">更多</el-button>
                  <template #dropdown><el-dropdown-menu><el-dropdown-item v-if="row.status === 'pending'" command="paid">标记已收款</el-dropdown-item><el-dropdown-item v-if="row.status === 'pending'" command="cancel">取消订单</el-dropdown-item><el-dropdown-item v-if="row.status === 'paid'" command="refund">登记退款</el-dropdown-item></el-dropdown-menu></template>
            </el-dropdown>
            <template v-else-if="canOperateOrder(row) && !isCompact">
              <el-button v-if="row.status === 'pending'" size="small" @click="markPaid(row)">标记已收款</el-button>
              <el-button v-if="row.status === 'pending'" size="small" type="warning" @click="cancel(row)">取消</el-button>
              <el-button v-if="row.status === 'paid'" size="small" type="danger" @click="refund(row)">登记退款</el-button>
            </template>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-state">暂无订单</div>
        </template>
      </el-table>
      <div class="orders-pagination">
        <el-pagination :current-page="page" :page-size="pageSize" :total="total" :pager-count="5" layout="prev, pager, next" @current-change="changePage" />
      </div>
    </el-card>

    <AdminDetailDrawer v-model="showDetailDrawer" title="订单详情">
      <p v-if="detailLoading" role="status">正在读取订单详情…</p>
      <el-alert v-if="detailError" type="error" :title="detailError" :closable="false" />
      <div v-if="detailOrder" class="detail-list">
        <div><span>订单号</span><strong class="mono">{{ detailOrder.order_no }}</strong></div>
        <div><span>来源</span><strong>{{ detailOrder.agency_id ? '代理客户订单' : '平台直营登记' }}</strong></div>
        <div><span>客户档案</span><strong>{{ detailOrder.customer_name || '尚无关联客户档案；不按姓名猜测归属' }}</strong></div>
        <div v-if="detailOrder.agency_id"><span>所属代理</span><strong>{{ detailOrder.agency_name || `代理 #${detailOrder.agency_id}` }}</strong></div>
        <div><span>套餐快照</span><strong>{{ detailOrder.plan_name_snapshot || getPlanName(detailOrder.plan_id) }}</strong></div>
        <div><span>金额</span><strong>¥{{ detailOrder.amount }}</strong></div>
        <div><span>渠道</span><strong>{{ detailOrder.channel || '-' }}</strong></div>
        <div><span>负责人</span><strong>{{ detailOrder.responsible || '-' }}</strong></div>
        <div><span>收款状态</span><strong>{{ getStatusText(detailOrder.status) }}</strong></div>
        <div><span>授权状态</span><strong>{{ detailOrder.auth_code_id ? licenseStateLabel(detailOrder.auth_code_status) : '尚无可核验的订单授权关联' }}</strong></div>
        <div><span>创建时间</span><strong>{{ formatTime(detailOrder.created_at) }}</strong></div>
        <div><span>收款时间</span><strong>{{ formatTime(detailOrder.paid_at) }}</strong></div>
        <div v-if="detailOrder.refunded_at"><span>退款登记</span><strong>{{ formatTime(detailOrder.refunded_at) }}</strong></div>
      </div>
      <el-alert v-if="detailOrder?.status === 'refunded'" class="refund-notice" type="warning" title="金额退款不等于授权停用。本次只登记退款并冲正分润，关联授权需要另行核对。" :closable="false" />
      <div v-if="detailOrder" class="detail-links">
        <el-button v-if="detailOrder.auth_code_id && canReadAuthorizations" @click="openRelatedAuthorization">核对关联授权</el-button>
        <el-button v-if="detailOrder.customer_id && canManageAgency" @click="router.push({ path: '/admin/agency', query: { section: 'customers', record_id: String(detailOrder.customer_id) } })">查看客户档案</el-button>
        <el-button v-if="detailOrder.agency_id && canManageAgency" @click="router.push({ path: '/admin/agency', query: { section: 'orders', record_id: String(detailOrder.id) } })">进入代理交付</el-button>
      </div>
      <template #footer><div class="detail-footer"><el-button @click="showDetailDrawer = false">关闭</el-button><template v-if="canWrite && detailOrder && !detailOrder.agency_id"><el-button v-if="detailOrder.status === 'pending'" type="primary" :loading="transitionBusy" @click="markPaid(detailOrder)">标记已收款</el-button><el-button v-if="detailOrder.status === 'pending'" :disabled="transitionBusy" @click="cancel(detailOrder)">取消订单</el-button><el-button v-if="detailOrder.status === 'paid'" type="danger" :loading="transitionBusy" @click="refund(detailOrder)">登记退款</el-button></template></div></template>
    </AdminDetailDrawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { getOrdersPage, getOrder, createOrder as apiCreateOrder, markOrderPaid, cancelOrder, refundOrder, getPlansAdmin, exportOrders } from '@/utils/api'
import { showToast } from '@/utils'
import { usePlatformStore } from '@/stores/platform'
import { useCompactLayout } from '@/composables/useCompactLayout'
import PageHeader from '@/components/PageHeader.vue'
import DataToolbar from '@/components/DataToolbar.vue'
import AdminDetailDrawer from '@/components/AdminDetailDrawer.vue'
import AsyncStateNotice from '@/components/AsyncStateNotice.vue'
import { confirmAction } from '@/shared/ui/confirm'
import { authService } from '@/utils/auth'
import { hasStaffPermission } from '@/features/auth/permissions'
import { failedDataState, settledDataState, type AsyncDataState } from '@/features/async/state'
import { buildPendingOrderPayload } from '@/features/admin/orderLifecycle'
import { supportReturnPath } from '@/features/admin/supportContext'
import {
  adminOrderSchema,
  adminOrdersSchema,
  adminPlansSchema,
  type AdminOrder,
  type AdminPlan,
} from '@/features/admin/model'

const route = useRoute()
const orders = ref<AdminOrder[]>([])
const plans = ref<AdminPlan[]>([])
const loadState = ref<AsyncDataState>('loading')
const loadError = ref('')
const isLoading = ref(false)
const filterStatus = ref(typeof route.query.status === 'string' ? route.query.status : '')
const filterSource = ref<'direct' | 'agency' | 'all'>(route.query.source === 'agency' || route.query.source === 'all' ? route.query.source : 'direct')
const page = ref(typeof route.query.page === 'string' && /^[1-9]\d*$/.test(route.query.page) && Number.isSafeInteger(Number(route.query.page)) ? Number(route.query.page) : 1)
const pageSize = 20
const total = ref(0)
let loadGeneration = 0
const planNameMap = reactive<Record<string, string>>({})

const platformStore = usePlatformStore()
const router = useRouter()
const isCompact = useCompactLayout()
const canWrite = computed(() => hasStaffPermission(authService.getRole(), 'orders.write'))
const canReadPlans = computed(() => hasStaffPermission(authService.getRole(), 'plans.read'))
const canManageSettings = computed(() => hasStaffPermission(authService.getRole(), 'settings.manage'))
const canManageAgency = computed(() => authService.getRole() === 'super_admin')
const canReadAuthorizations = computed(() => hasStaffPermission(authService.getRole(), 'backoffice.read'))
const showDetailDrawer = ref(false)
const detailOrder = ref<AdminOrder | null>(null)
const detailLoading = ref(false), detailError = ref(''), transitionBusy = ref(false)
let detailGeneration = 0, disposed = false

const newOrder = ref<{ plan_id: string | number | null; amount: number; channel: string; responsible: string }>({ plan_id: null, amount: 0, channel: '', responsible: '' })
const activePlans = computed(() => plans.value.filter((plan) => plan.status === 'active'))

const stats = computed(() => ({
  total: total.value,
  paid: orders.value.filter(o => o.status === 'paid').length,
  pending: orders.value.filter(o => o.status === 'pending').length,
  refunded: orders.value.filter(o => o.status === 'refunded').length,
  cancelled: orders.value.filter(o => o.status === 'cancelled').length,
}))

function getPlanName(planId?: string | number | null) {
  return planId === null || planId === undefined ? '未知套餐' : planNameMap[String(planId)] || '未知套餐'
}

function getStatusType(status?: string | null): 'warning' | 'success' | 'danger' | 'info' {
  const map: Record<string, 'warning' | 'success' | 'danger' | 'info'> = { pending: 'warning', paid: 'success', refunded: 'danger', cancelled: 'info' }
  return status ? map[status] || 'info' : 'info'
}

function getStatusText(status?: string | null) {
  const map: Record<string, string> = { pending: '待收款', paid: '已收款', refunded: '已退款', cancelled: '已取消' }
  return status ? map[status] || status : '-'
}
function licenseStateLabel(value?: string | null): string {
  const labels: Record<string, string> = { active: '使用中', unused: '待激活', expired: '已到期', frozen: '已冻结', deleted: '已停用' }
  return value ? labels[value] || value : '状态待核对'
}
function canOperateOrder(value: unknown): boolean {
  const order = adminOrderSchema.safeParse(value)
  return canWrite.value && order.success && !order.data.agency_id
}

function getPlanStatusText(status?: string | null) {
  return status === 'active' ? '启用' : status === 'disabled' ? '禁用' : status === 'archived' ? '已归档' : '-'
}

function getPlanStatusType(status?: string | null): 'success' | 'danger' | 'info' {
  return status === 'active' ? 'success' : status === 'disabled' ? 'danger' : 'info'
}

function goPlanSettings() {
  if (!canManageSettings.value) return
  void router.push('/admin/settings')
}

function formatTime(timeStr?: string | null) {
  if (!timeStr) return '-'
  const d = new Date(timeStr)
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

async function loadData() {
  const generation = ++loadGeneration
  loadState.value = orders.value.length || plans.value.length ? 'data' : 'loading'
  loadError.value = ''
  try {
    const platformKey = platformStore.adminPlatform !== 'all' ? platformStore.adminPlatform : undefined
    const params = { platform_key: platformKey, status: filterStatus.value || undefined, page: page.value, page_size: pageSize, source: filterSource.value === 'all' ? undefined : filterSource.value }
    const [ordersRes, plansRes] = await Promise.all([getOrdersPage(params), getPlansAdmin({ page_size: 100 })])
    if (generation !== loadGeneration) return
    const parsedOrders = adminOrdersSchema.parse(ordersRes.items)
    const parsedPlans = adminPlansSchema.parse(plansRes)
    orders.value = parsedOrders
    total.value = ordersRes.total
    plans.value = parsedPlans
    const selectedPlan = parsedPlans.find((plan) => plan.status === 'active')
    if (!parsedPlans.some((plan) => plan.id === newOrder.value.plan_id && plan.status === 'active')) {
      newOrder.value.plan_id = selectedPlan?.id ?? null
      newOrder.value.amount = selectedPlan?.price ?? 0
    }
    parsedPlans.forEach((plan) => { planNameMap[String(plan.id)] = plan.name })
    loadState.value = settledDataState(parsedOrders.length)
  } catch (error) {
    if (generation !== loadGeneration) return
    loadError.value = error instanceof Error && error.message ? error.message : '订单与套餐数据暂时无法加载'
    loadState.value = failedDataState(orders.value.length > 0 || plans.value.length > 0)
  }
}

function changePage(nextPage: number) {
  page.value = nextPage
  syncOrderListQuery()
  orders.value = []
  void loadData()
}
function syncOrderListQuery() {
  const { record_id: _record, ...remaining } = route.query
  void router.replace({ query: { ...remaining, status: filterStatus.value || undefined, page: page.value > 1 ? String(page.value) : undefined, source: filterSource.value !== 'direct' ? filterSource.value : undefined } })
}

watch([() => platformStore.adminPlatform, filterStatus, filterSource], () => {
  page.value = 1
  total.value = 0
  orders.value = []
  showDetailDrawer.value = false
  detailGeneration++
  detailOrder.value = null
  syncOrderListQuery()
  void loadData()
})

async function createOrder() {
  if (!canWrite.value || isLoading.value) return
  if (!newOrder.value.plan_id) { showToast('请选择套餐', 'error'); return }
  if (!newOrder.value.amount || newOrder.value.amount <= 0) { showToast('订单金额必须大于0', 'error'); return }
  isLoading.value = true
  try {
    await apiCreateOrder(buildPendingOrderPayload(
      { ...newOrder.value, plan_id: newOrder.value.plan_id },
      platformStore.adminPlatform === 'all' ? undefined : platformStore.adminPlatform,
    ))
    showToast('订单创建成功', 'success')
    await loadData()
  } catch {
    showToast('创建失败', 'error')
  }
  isLoading.value = false
}

async function markPaid(order: unknown) {
  if (!canOperateOrder(order) || transitionBusy.value) return
  const selectedOrder = adminOrderSchema.parse(order)
  if (selectedOrder.status !== 'pending') return
  const originPlatform = platformStore.adminPlatform
  if (!await confirmAction({
    title: '确认订单已人工收款？',
    message: `确认 ${selectedOrder.order_no} 已收款后，系统会按当前策略生成分润记录。`,
    confirmText: '确认已收款',
  })) return
  if (disposed || originPlatform !== platformStore.adminPlatform) return
  transitionBusy.value = true
  try {
    await markOrderPaid(selectedOrder.id)
    showToast('已标记为收款', 'success')
    await loadData()
    await refreshOpenDetail(selectedOrder.id)
  } catch {
    showToast('操作失败', 'error')
  }
  finally { transitionBusy.value = false }
}

async function promptTransitionReason(title: string, message: string): Promise<string | null> {
  try {
    const result = await ElMessageBox.prompt(message, title, {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      inputPlaceholder: '请填写至少 2 个字的原因',
      inputValidator: (value: string) => value.trim().length >= 2 || '原因至少需要 2 个字',
      type: 'warning',
      closeOnClickModal: false,
    })
    return String(result.value || '').trim()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return null
    throw error
  }
}

async function cancel(order: unknown) {
  if (!canOperateOrder(order) || transitionBusy.value) return
  const selectedOrder = adminOrderSchema.parse(order)
  if (selectedOrder.status !== 'pending') return
  const originPlatform = platformStore.adminPlatform
  transitionBusy.value = true
  try {
    const reason = await promptTransitionReason('取消订单', `请输入取消 ${selectedOrder.order_no} 的原因。`)
    if (!reason || disposed || originPlatform !== platformStore.adminPlatform) return
    await cancelOrder(selectedOrder.id, reason)
    showToast('订单已取消', 'success')
    await loadData()
    await refreshOpenDetail(selectedOrder.id)
  } catch {
    showToast('取消订单失败', 'error')
  }
  finally { transitionBusy.value = false }
}

async function refund(order: unknown) {
  if (!canOperateOrder(order) || transitionBusy.value) return
  const selectedOrder = adminOrderSchema.parse(order)
  if (selectedOrder.status !== 'paid') return
  const originPlatform = platformStore.adminPlatform
  transitionBusy.value = true
  try {
    const reason = await promptTransitionReason('确认退款', `请先确认已在线下退还 ¥${selectedOrder.amount}，再登记退款原因。本操作只登记退款并冲正分润，不会转账，也不会自动停用授权；关联授权需另行核对处理。`)
    if (!reason || disposed || originPlatform !== platformStore.adminPlatform) return
    await refundOrder(selectedOrder.id, reason)
    showToast('线下退款已登记，关联授权请另行核对', 'success')
    await loadData()
    await refreshOpenDetail(selectedOrder.id)
  } catch {
    showToast('退款登记失败，未执行任何转账', 'error')
  }
  finally { transitionBusy.value = false }
}

async function openOrderDetail(order: unknown): Promise<void> {
  const id = adminOrderSchema.parse(order).id
  const generation = ++detailGeneration
  detailOrder.value = null; detailError.value = ''; detailLoading.value = true
  showDetailDrawer.value = true
  try {
    const data = adminOrderSchema.parse(await getOrder(id, { platform_key: platformStore.adminPlatform === 'all' ? undefined : platformStore.adminPlatform }))
    if (disposed || generation !== detailGeneration || !showDetailDrawer.value) return
    if (platformStore.adminPlatform !== 'all' && data.platform_key && data.platform_key !== platformStore.adminPlatform) throw new Error('订单不属于当前平台')
    detailOrder.value = data
  } catch (cause) { if (!disposed && generation === detailGeneration) detailError.value = cause instanceof Error ? cause.message : '订单详情读取失败' }
  finally { if (!disposed && generation === detailGeneration) detailLoading.value = false }
}
async function refreshOpenDetail(id: string | number): Promise<void> {
  if (showDetailDrawer.value && detailOrder.value?.id === id) await openOrderDetail(detailOrder.value)
}
function openRelatedAuthorization(): void {
  const order = detailOrder.value
  if (!order?.auth_code_id || !canReadAuthorizations.value) return
  const params = new URLSearchParams({ record_id: String(order.id) })
  if (page.value > 1) params.set('page', String(page.value))
  if (filterStatus.value) params.set('status', filterStatus.value)
  if (filterSource.value !== 'direct') params.set('source', filterSource.value)
  const returnTo = supportReturnPath(`/admin/orders?${params.toString()}`, authService.getRole())
  void router.push({ path: '/admin/authcodes', query: { auth_code_id: String(order.auth_code_id), ...(returnTo ? { return_to: returnTo } : {}) } })
}

function handleOrderCommand(command: string, order: unknown) {
  if (!canWrite.value) return
  if (command === 'paid') void markPaid(order)
  if (command === 'cancel') void cancel(order)
  if (command === 'refund') void refund(order)
}

// 选择套餐时自动填充金额
watch(() => newOrder.value.plan_id, (id) => {
  const plan = plans.value.find(p => p.id === id)
  if (plan) newOrder.value.amount = plan.price
})

async function exportOrdersData() {
  try {
    const params: Record<string, string> = {}
    if (filterSource.value !== 'all') params.source = filterSource.value
    if (filterStatus.value) params.status = filterStatus.value
    if (platformStore.adminPlatform !== 'all') params.platform_key = platformStore.adminPlatform
    const blob = await exportOrders(params)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `orders_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    showToast('导出成功', 'success')
  } catch {
    showToast('导出失败', 'error')
  }
}

onMounted(loadData)
watch(() => route.query.record_id, value => {
  if (typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0) void openOrderDetail({ id: Number(value), order_no: '', amount: 0 })
  else { detailGeneration++; showDetailDrawer.value = false; detailOrder.value = null; detailLoading.value = false; detailError.value = '' }
}, { immediate: true })
watch(showDetailDrawer, visible => { if (!visible) detailGeneration++ }, { flush: 'sync' })
onBeforeUnmount(() => { disposed = true; loadGeneration += 1; detailGeneration++ })
</script>

<style scoped>
.stat-card {
  padding: 18px;
  text-align: center;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}

.order-stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; margin-bottom: 1.5rem; }

.stat-label {
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  margin-bottom: 0.5rem;
}

.stat-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--color-text);
}

.table-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-low);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-header h3 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text);
  margin: 0;
}

.form-row {
  display: grid;
  grid-template-columns: 1.35fr 1.25fr .8fr auto;
  gap: 14px;
  align-items: end;
}
.plan-overview-card { margin-bottom: 1.5rem; }
.card-hint { display: block; margin-top: .25rem; color: var(--color-text-secondary); font-size: .78rem; font-weight: 400; }

.order-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}
.order-field > span { color: var(--color-text-secondary); font-size: .85rem; }
.order-field :deep(.el-select), .order-field :deep(.el-input) { width: 100%; }
.order-submit { display: flex; justify-content: flex-end; }
.data-toolbar-v6 { margin-bottom: 1rem; }
.orders-pagination { display: flex; justify-content: flex-end; margin-top: 16px; overflow-x: auto; }

.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-secondary);
}

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

.detail-list { display: grid; gap: 12px; }
.detail-list > div { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--color-border); }
.detail-list span { color: var(--color-text-secondary); font-size: 13px; }
.detail-list strong { color: var(--color-text); font-size: 14px; overflow-wrap: anywhere; }
.mono { font-family: monospace; }
.detail-links,.detail-footer{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.detail-links :deep(.el-button+.el-button),.detail-footer :deep(.el-button+.el-button){margin-left:0}.refund-notice{margin-top:20px}

@media (max-width: 1100px) {
  .form-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .order-submit { grid-column: 1 / -1; }
}
@media (max-width: 899px) { .order-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; } }
@media (max-width: 560px) {
  .order-stats, .form-row { grid-template-columns: 1fr; }
  .order-submit { grid-column: auto; }
  .order-submit :deep(.el-button) { width: 100%; }
}
</style>
