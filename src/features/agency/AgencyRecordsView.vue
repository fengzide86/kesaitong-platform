<template>
  <section class="records-page">
    <div class="records-heading">
      <div><h1>{{ sectionLabels[section] }}</h1><p>{{ description }}</p></div><div class="heading-actions">
        <el-button
          v-if="section === 'orders'"
          :loading="exporting"
          @click="exportCsv"
        >
          导出 CSV
        </el-button><el-button
          v-if="section !== 'licenses' && (owner || section !== 'agencies')"
          type="primary"
          @click="openCreate"
        >
          {{ createLabel }}
        </el-button>
      </div>
    </div>
    <div v-if="customerFilter" class="customer-context" data-testid="agency-customer-context">
      <span>当前客户：{{ contextCustomer?.name || `客户档案 #${customerFilter}` }}</span>
      <el-button link type="primary" @click="navigateRecord('customers', customerFilter)">查看客户档案</el-button>
      <el-button link @click="clearCustomerFilter">查看全部客户业务</el-button>
    </div>
    <el-alert v-if="contextError" :title="contextError" type="error" :closable="false" class="load-error" />
    <form
      class="filter-bar"
      @submit.prevent="applyFilters"
    >
      <el-input
        v-model="query"
        clearable
        aria-label="搜索记录"
        :placeholder="section === 'licenses' ? '搜索授权码' : '搜索名称或关键词'"
      />
      <el-select
        v-if="statusOptions.length"
        v-model="status"
        clearable
        placeholder="全部状态"
        aria-label="状态筛选"
      >
        <el-option
          v-for="option in statusOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <el-select
        v-if="owner && section !== 'agencies'"
        v-model="agencyFilter"
        filterable
        remote
        clearable
        :remote-method="searchAgencies"
        :loading="optionsLoading"
        placeholder="全部代理"
        aria-label="代理筛选"
        @visible-change="visible => visible && searchAgencies('')"
      >
        <el-option
          v-for="agency in agencyOptions"
          :key="agency.id"
          :value="agency.id"
          :label="agency.name"
        />
      </el-select>
      <el-button native-type="submit">
        查询
      </el-button><el-button
        :loading="loading"
        @click="load"
      >
        刷新
      </el-button>
    </form>
    <el-alert
      v-if="loadError"
      :title="loadError"
      type="error"
      :closable="false"
      show-icon
      class="load-error"
    />
    <div class="records-table">
      <el-table
        v-loading="loading"
        :data="rows"
        stripe
        row-key="id"
        @row-dblclick="openDetail"
      >
        <el-table-column
          v-if="section === 'agencies' || section === 'customers'"
          prop="name"
          :label="section === 'agencies' ? '代理名称' : '客户名称'"
          min-width="160"
        />
        <el-table-column
          v-if="section === 'agencies' || section === 'customers'"
          prop="contact"
          label="联系方式"
          min-width="170"
        >
          <template #default="{ row }">
            {{ row.contact || '未填写' }}
          </template>
        </el-table-column>
        <el-table-column
          v-if="section === 'orders'"
          prop="order_no"
          label="订单编号"
          min-width="180"
        />
        <el-table-column
          v-if="['orders','licenses','requests'].includes(section)"
          prop="customer_name"
          label="客户"
          min-width="120"
        >
          <template #default="{ row }">
            {{ row.customer_name || '客户档案' }}
          </template>
        </el-table-column>
        <el-table-column
          v-if="section === 'orders' || section === 'licenses'"
          prop="plan_name"
          label="套餐"
          min-width="140"
        />
        <el-table-column
          v-if="section === 'orders'"
          label="金额"
          min-width="110"
        >
          <template #default="{ row }">
            {{ money(row.amount) }}
          </template>
        </el-table-column>
        <el-table-column
          v-if="section === 'licenses'"
          prop="code"
          label="授权码"
          min-width="210"
        >
          <template #default="{ row }">
            <code>{{ row.code }}</code>
          </template>
        </el-table-column>
        <el-table-column
          v-if="section === 'licenses'"
          label="激活情况"
          width="100"
        >
          <template #default="{ row }">
            <el-tag :type="canDeliverLicense(row) && row.activated ? 'success' : 'info'">
              {{ licenseActivationLabel(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          v-if="section === 'requests'"
          label="申请类型"
          width="120"
        >
          <template #default="{ row }">
            {{ requestKindLabel(row.kind) }}
          </template>
        </el-table-column>
        <el-table-column
          v-if="section === 'requests'"
          prop="content"
          label="问题描述"
          min-width="220"
          show-overflow-tooltip
        />
        <el-table-column
          v-if="owner && section !== 'agencies'"
          label="所属代理"
          min-width="130"
        >
          <template #default="{ row }">
            {{ row.agency_name || '已归属代理' }}
          </template>
        </el-table-column>
        <el-table-column
          v-if="section !== 'customers'"
          label="状态"
          width="115"
        >
          <template #default="{ row }">
            <el-tag :type="section === 'licenses' ? licenseStatusType(row.status) : row.status === 'disabled' || row.status === 'rejected' ? 'info' : 'primary'">
              {{ orderStateLabel(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="创建时间"
          min-width="175"
        >
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="120"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              @click="openDetail(row)"
            >
              {{ section === 'agencies' || section === 'customers' ? '查看 / 编辑' : '查看详情' }}
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty-content">
            {{ loadError ? '列表加载失败，请点击刷新重试' : '暂无匹配记录' }}<small v-if="!loadError">{{ section === 'licenses' ? '平台确认收款并发放后，授权会显示在这里。' : '可调整筛选条件，或从右上角创建第一条记录。' }}</small>
          </div>
        </template>
      </el-table>
      <div class="pagination">
        <span>共 {{ total }} 条</span><el-pagination
          v-model:current-page="page"
          :page-size="20"
          :total="total"
          layout="prev, pager, next"
          @current-change="changePage"
        />
      </div>
    </div>

    <el-drawer
      v-model="formVisible"
      :title="editingId ? '编辑档案' : createLabel"
      size="min(520px, 100vw)"
      :close-on-click-modal="!submitting"
      :close-on-press-escape="!submitting"
      :show-close="!submitting"
      destroy-on-close
    >
      <form
        class="record-form"
        @submit.prevent="submitForm"
      >
        <el-alert
          v-if="formError"
          :title="formError"
          type="error"
          :closable="false"
          show-icon
        />
        <template v-if="section === 'agencies' || section === 'customers'">
          <label for="agency-record-name">{{ section === 'agencies' ? '代理名称' : '客户名称' }} <span>*</span></label><el-input
            id="agency-record-name"
            v-model="form.name"
            maxlength="100"
            placeholder="用于识别和交付的名称"
          />
          <label for="agency-record-contact">联系方式</label><el-input
            id="agency-record-contact"
            v-model="form.contact"
            maxlength="200"
            placeholder="微信、手机号或邮箱"
          />
          <label for="agency-record-notes">备注</label><el-input
            id="agency-record-notes"
            v-model="form.notes"
            type="textarea"
            :rows="4"
            maxlength="2000"
            show-word-limit
          />
          <template v-if="owner && section === 'customers'">
            <label>所属代理 <span>*</span></label><el-select
              v-model="form.agency_id"
              filterable
              remote
              :remote-method="searchAgencies"
              :loading="optionsLoading"
              placeholder="搜索并选择代理"
              @visible-change="visible => visible && searchAgencies('')"
            >
              <el-option
                v-for="agency in agencyOptions"
                :key="agency.id"
                :label="`${agency.name}${agency.status === 'disabled' ? '（已停用）' : ''}`"
                :value="agency.id"
                :disabled="agency.status === 'disabled'"
              />
            </el-select><p
              v-if="editingId"
              class="field-help"
            >
              转移客户归属会影响此客户相关订单、授权及售后的可见范围，请核对后保存。
            </p>
          </template>
        </template>
        <template v-if="section === 'orders' || section === 'requests'">
          <label>客户 <span>*</span></label><el-select
            v-model="form.customer_id"
            aria-label="选择客户"
            filterable
            remote
            :remote-method="searchCustomers"
            :loading="customersLoading"
            placeholder="输入客户名称搜索"
            @visible-change="visible => visible && searchCustomers('')"
            @change="customerChanged"
          >
            <el-option
              v-for="customer in customerOptions"
              :key="customer.id"
              :label="`${customer.name}${owner && customer.agency_name ? ` · ${customer.agency_name}` : ''}`"
              :value="customer.id"
            />
          </el-select>
          <p class="field-help">
            没有找到客户？请先在客户档案中登记；搜索只返回可访问的客户。
          </p>
        </template>
        <template v-if="section === 'orders'">
          <label>套餐 <span>*</span></label><el-select
            v-model="form.plan_id"
            aria-label="选择套餐"
            placeholder="选择有效套餐"
          >
            <el-option
              v-for="plan in planOptions"
              :key="plan.id"
              :label="`${plan.name} · ${money(plan.price)}`"
              :value="plan.id"
            />
          </el-select>
          <label>使用平台 <span>*</span></label><el-radio-group v-model="form.platform_key">
            <el-radio value="amazon">
              亚马逊赛训
            </el-radio><el-radio value="aliexpress">
              速卖通
            </el-radio>
          </el-radio-group>
          <label>交付备注</label><el-input
            v-model="form.note"
            type="textarea"
            :rows="3"
            maxlength="2000"
          />
          <el-alert
            title="提交订单不代表已收款或已开通。平台负责人确认后发放授权。"
            type="info"
            :closable="false"
          />
        </template>
        <template v-if="section === 'requests'">
          <label>申请类型 <span>*</span></label><el-select
            v-model="form.kind"
            aria-label="申请类型"
          >
            <el-option
              label="使用支持"
              value="support"
            /><el-option
              label="退款申请"
              value="refund"
            /><el-option
              label="延期申请"
              value="extension"
            />
          </el-select>
          <label>关联订单（可选）</label><el-select
            v-model="form.order_id"
            aria-label="关联订单"
            clearable
            filterable
            remote
            :remote-method="searchOrders"
            :disabled="!form.customer_id"
            placeholder="先选择客户，再搜索订单"
            @visible-change="visible => visible && searchOrders('')"
          >
            <el-option
              v-for="order in orderOptions"
              :key="order.id"
              :label="`${order.order_no} · ${order.plan_name}`"
              :value="order.id"
            />
          </el-select>
          <label>问题描述 <span>*</span></label><el-input
            v-model="form.content"
            type="textarea"
            :rows="6"
            maxlength="4000"
            show-word-limit
            placeholder="描述问题、期望的处理和必要的背景；不要填写客户密码或授权凭据。"
          />
          <p class="field-help">
            提交后等待平台回复。退款和延期不会自动执行。
          </p>
        </template>
        <div class="form-actions">
          <el-button
            :disabled="submitting"
            @click="formVisible = false"
          >
            取消
          </el-button><el-button
            type="primary"
            native-type="submit"
            :loading="submitting"
          >
            {{ editingId ? '保存修改' : section === 'orders' ? '提交待确认订单' : '保存提交' }}
          </el-button>
        </div>
      </form>
    </el-drawer>

    <el-drawer
      v-model="detailVisible"
      title="记录详情"
      size="min(560px, 100vw)"
      destroy-on-close
    >
      <p v-if="detailLoading" role="status">正在读取记录详情…</p>
      <el-alert v-if="detailError" :title="detailError" type="error" :closable="false" />
      <div
        v-if="selected"
        class="record-detail"
      >
        <el-alert
          v-if="actionError"
          :title="actionError"
          type="error"
          :closable="false"
          show-icon
        />
        <template v-if="selectedAgency">
          <h2>{{ selectedAgency.name }}</h2><el-tag>{{ statusLabel(selectedAgency.status) }}</el-tag><dl><dt>联系方式</dt><dd>{{ selectedAgency.contact || '未填写' }}</dd><dt>备注</dt><dd>{{ selectedAgency.notes || '未填写' }}</dd></dl><div class="detail-actions">
            <el-button @click="editRecord">
              编辑代理
            </el-button><el-button
              :type="selectedAgency.status === 'active' ? 'danger' : 'primary'"
              :loading="submitting"
              @click="toggleAgency"
            >
              {{ selectedAgency.status === 'active' ? '停用代理' : '恢复代理' }}
            </el-button>
          </div><p class="field-help">
            停用代理会停止其账号访问，不删除客户或历史记录。
          </p>
        </template>
        <template v-if="selectedCustomer">
          <h2>{{ selectedCustomer.name }}</h2><dl>
            <dt>联系方式</dt><dd>{{ selectedCustomer.contact || '未填写' }}</dd><dt v-if="owner">
              所属代理
            </dt><dd v-if="owner">
              {{ selectedCustomer.agency_name || '已归属代理' }}
            </dd><dt>备注</dt><dd>{{ selectedCustomer.notes || '未填写' }}</dd>
          </dl><el-button
            type="primary"
            @click="editRecord"
          >
            编辑客户档案
          </el-button>
          <AgencyCustomerJourney :customer="selectedCustomer"
            @browse="section => navigateCustomerRecords(section, selectedCustomer!.id)"
            @open="(section, id) => navigateCustomerRecords(section, selectedCustomer!.id, id)"
            @create-order="navigateCustomerRecords('orders', selectedCustomer.id, undefined, true)" />
        </template>
        <template v-if="selectedOrder">
          <span class="detail-kicker">代理订单 · {{ selectedOrder.order_no }}</span><h2>{{ selectedOrder.customer_name }}</h2><el-tag>{{ orderStateLabel(selectedOrder) }}</el-tag><dl>
            <dt>客户档案</dt><dd><el-button link type="primary" @click="navigateRecord('customers', selectedOrder.customer_id)">查看客户档案</el-button></dd>
            <dt>收款状态</dt><dd>{{ statusLabel(selectedOrder.status) }}</dd>
            <dt>授权状态</dt><dd>{{ selectedOrder.auth_code ? licenseActivationLabel(selectedOrder.auth_code) : '尚未发放' }}</dd>
            <dt>套餐</dt><dd>{{ selectedOrder.plan_name }}</dd><dt>订单金额</dt><dd class="amount">
              {{ money(selectedOrder.amount) }}
            </dd><dt>创建时间</dt><dd>{{ formatDate(selectedOrder.created_at) }}</dd><dt>收款时间</dt><dd>{{ formatDate(selectedOrder.paid_at) }}</dd>
          </dl>
          <el-alert v-if="selectedOrder.status === 'refunded'" title="金额退款不等于授权停用。请核对历史授权的当前状态，系统不会自动停权。" type="warning" :closable="false" />
          <div v-if="selectedOrder.auth_code" class="detail-actions"><el-button @click="navigateRecord('licenses', selectedOrder.auth_code.id)">核对关联授权</el-button></div>
          <div
            v-if="selectedOrder.auth_code"
            class="delivery-block"
          >
            <h3>{{ selectedOrderCanDeliver ? '授权已生成' : '历史授权记录' }}</h3><code>{{ selectedOrder.auth_code.code }}</code><el-button
              v-if="selectedOrderCanDeliver"
              @click="copyCode(selectedOrder.auth_code.code)"
            >
              复制授权码
            </el-button><p>{{ selectedOrderNotice }}</p>
          </div><div
            v-else-if="owner && !selectedOrderClosed"
            class="detail-actions"
          >
            <el-button
              v-if="selectedOrder.status === 'pending'"
              type="primary"
              :loading="submitting"
              @click="confirmPaid"
            >
              确认已收款
            </el-button><el-button
              v-if="selectedOrder.status === 'paid'"
              type="primary"
              :loading="submitting"
              @click="deliverOrder"
            >
              发放授权
            </el-button>
          </div><p
            v-else
            class="field-help"
          >
            {{ selectedOrderNotice }}
          </p>
          <div v-if="owner && !selectedOrderClosed" class="detail-actions">
            <el-button v-if="selectedOrder.status === 'pending'" :disabled="submitting" @click="transitionOrder('cancel')">取消订单</el-button>
            <el-button v-if="selectedOrder.status === 'paid'" type="danger" :disabled="submitting" @click="transitionOrder('refund')">登记线下退款</el-button>
          </div>
        </template>
        <template v-if="selectedLicense">
          <h2>{{ selectedLicense.plan_name }}</h2><el-tag :type="licenseStatusType(selectedLicense.status)">{{ licenseActivationLabel(selectedLicense) }}</el-tag><div class="delivery-block">
            <code>{{ selectedLicense.code }}</code><el-button v-if="canDeliverLicense(selectedLicense)" @click="copyCode(selectedLicense.code)">
              复制授权码
            </el-button><p v-else>授权{{ statusLabel(selectedLicense.status) }}，请联系平台核对，不要再次交付。</p>
          </div><dl><dt>客户</dt><dd>{{ selectedLicense.customer_name || '客户档案' }}</dd><dt>有效期至</dt><dd>{{ formatDate(selectedLicense.expires_at) }}</dd><dt>授权状态</dt><dd>{{ statusLabel(selectedLicense.status) }}</dd></dl>
          <div class="detail-actions"><el-button @click="navigateRecord('customers', selectedLicense.customer_id)">查看客户档案</el-button><el-button @click="navigateRecord('orders', selectedLicense.order_id)">查看关联订单</el-button></div>
        </template>
        <template v-if="selectedRequest">
          <span class="detail-kicker">代理售后 · {{ requestKindLabel(selectedRequest.kind) }}</span><h2>{{ selectedRequest.customer_name || '售后申请' }}</h2><el-tag>{{ statusLabel(selectedRequest.status) }}</el-tag>
          <div class="detail-actions"><el-button @click="navigateRecord('customers', selectedRequest.customer_id)">查看客户档案</el-button><el-button v-if="selectedRequest.order_id" @click="navigateRecord('orders', selectedRequest.order_id)">查看关联订单</el-button><el-button v-if="requestOrder?.auth_code" @click="navigateRecord('licenses', requestOrder.auth_code.id)">核对关联授权</el-button></div>
          <p class="field-help">{{ selectedRequest.order_id ? requestOrder ? `关联订单 ${requestOrder.order_no} · ${statusLabel(requestOrder.status)}；授权${requestOrder.auth_code ? statusLabel(requestOrder.auth_code.status) : '尚未发放'}` : requestOrderError || '正在核对关联订单…' : '此申请未关联订单，不能据此推断授权归属。' }}</p>
          <h3>申请内容</h3><p class="preserve-text">
            {{ selectedRequest.content }}
          </p><h3>平台回复</h3><p class="preserve-text">
            {{ selectedRequest.response || '平台尚未回复，请稍后刷新查看。' }}
          </p><template v-if="owner">
            <label>处理状态</label><el-select v-model="responseForm.status">
              <el-option
                label="待处理"
                value="open"
              /><el-option
                label="已回复处理"
                value="resolved"
              /><el-option
                label="未通过"
                value="rejected"
              />
            </el-select><label>回复说明</label><el-input
              v-model="responseForm.response"
              type="textarea"
              :rows="5"
              maxlength="4000"
              placeholder="说明实际处理情况，不把未完成的退款或延期描述为已完成。"
            /><p class="field-help">
              回复只更新售后记录，不会自动退款或延长授权。完成实际处理后再标记已处理。
            </p><el-button
              type="primary"
              :loading="submitting"
              @click="respondRequest"
            >
              保存回复
            </el-button>
          </template>
        </template>
      </div>
    </el-drawer>
  </section>
</template>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { showToast } from '@/utils'
import { agencyApi } from './api'
import AgencyCustomerJourney from './AgencyCustomerJourney.vue'
import { agencySchema, customerSchema, orderSchema, licenseSchema, serviceRequestSchema, sectionLabels, statusLabel, requestKindLabel, money, canDeliverLicense, licenseActivationLabel,
  type Section, type AgencyRecord, type Agency, type Customer, type AgencyOrder, type AgencyPlan, type ServiceRequest } from './model'

const props = withDefaults(defineProps<{ section: Section; owner?: boolean }>(), { owner: false })
const route = useRoute()
const router = useRouter()
const customerFilter = computed(() => positiveId(route.query.customer_id))
const contextCustomer = ref<Customer | null>(null), contextError = ref('')
const detailLoading = ref(false), detailError = ref('')
const requestOrder = ref<AgencyOrder | null>(null), requestOrderError = ref('')
let routeRevision = 0, contextRevision = 0
let lastListScope = ''
const rows = ref<AgencyRecord[]>([])
const page = ref(1), total = ref(0), query = ref(''), status = ref('')
const agencyFilter = ref<number>()
const loading = ref(false), exporting = ref(false), submitting = ref(false)
const loadError = ref(''), formError = ref(''), actionError = ref('')
const formVisible = ref(false), detailVisible = ref(false), editingId = ref<number>()
const selected = ref<AgencyRecord | null>(null)
const agencyOptions = ref<Agency[]>([]), customerOptions = ref<Customer[]>([]), orderOptions = ref<AgencyOrder[]>([]), planOptions = ref<AgencyPlan[]>([])
const optionsLoading = ref(false), customersLoading = ref(false)
let loadRevision = 0, agencyRevision = 0, customerRevision = 0, orderRevision = 0, formRevision = 0, detailRevision = 0
let disposed = false
const form = reactive({ name: '', contact: '', notes: '', agency_id: undefined as number | undefined, customer_id: undefined as number | undefined, plan_id: undefined as number | undefined, platform_key: 'amazon' as 'amazon' | 'aliexpress', note: '', kind: 'support' as ServiceRequest['kind'], order_id: undefined as number | undefined, content: '' })
const responseForm = reactive({ status: 'resolved' as ServiceRequest['status'], response: '' })
const selectedAgency = computed(() => props.section === 'agencies' && selected.value ? agencySchema.parse(selected.value) : null)
const selectedCustomer = computed(() => props.section === 'customers' && selected.value ? customerSchema.parse(selected.value) : null)
const selectedOrder = computed(() => props.section === 'orders' && selected.value ? orderSchema.parse(selected.value) : null)
const selectedOrderClosed = computed(() => selectedOrder.value?.status === 'refunded' || selectedOrder.value?.status === 'cancelled')
const selectedOrderCanDeliver = computed(() => selectedOrder.value?.status === 'paid' && !!selectedOrder.value.auth_code && canDeliverLicense(selectedOrder.value.auth_code))
const selectedOrderNotice = computed(() => {
  const order = selectedOrder.value
  if (!order) return ''
  if (selectedOrderClosed.value) return `此订单${statusLabel(order.status)}，仅保留历史记录，不再进行收款或授权交付。`
  if (order.auth_code && !selectedOrderCanDeliver.value) return `授权${statusLabel(order.auth_code.status)}，请联系平台核对，不要再次交付。`
  if (order.auth_code) return `发送给对应客户使用。${order.auth_code.activated ? '此授权已激活。' : '此授权尚未激活。'}`
  return order.status === 'paid' ? '平台已确认收款，等待发放授权。' : '等待平台负责人核对收款并交付授权。'
})
const selectedLicense = computed(() => props.section === 'licenses' && selected.value ? licenseSchema.parse(selected.value) : null)
const selectedRequest = computed(() => props.section === 'requests' && selected.value ? serviceRequestSchema.parse(selected.value) : null)
type RecordSection = Exclude<Section, 'commission'>
const recordSection = computed(() => props.section as RecordSection)
const descriptions: Record<RecordSection, string> = { agencies: '先建立代理主体，再到后台账号管理为代理关联登录账号。', customers: '以客户为中心管理归属、联系信息与交付备注。', orders: '提交订单 → 平台确认收款 → 发放授权 → 跟进激活。', licenses: '只展示已发放的授权，便于发送给客户并跟进激活。', requests: '集中跟进使用问题、退款和延期申请，保留处理记录。' }
const description = computed(() => descriptions[recordSection.value])
const createLabel = computed(() => ({ agencies: '新建代理', customers: '登记客户', orders: '提交订单', licenses: '', requests: '提交售后申请' } as Record<RecordSection, string>)[recordSection.value])
const statusOptions = computed(() => {
  const values = props.section === 'agencies' ? ['active', 'disabled'] : props.section === 'orders' ? ['pending', 'paid', 'delivered', 'refunded', 'cancelled'] : props.section === 'licenses' ? ['pending_activation', 'unused', 'active', 'expired', 'frozen', 'deleted'] : props.section === 'requests' ? ['open', 'resolved', 'rejected'] : []
  return values.map(value => ({ value, label: statusLabel(value) }))
})
function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}
function licenseStatusType(status: string): 'warning' | 'success' | 'info' | 'danger' {
  // Same authorization state types as the administrator authorization page.
  const types: Record<string, 'warning' | 'success' | 'info' | 'danger'> = {
    unused: 'warning', active: 'success', frozen: 'info', expired: 'danger',
  }
  return types[status] || 'info'
}
function orderStateLabel(raw: unknown): string {
  const order = orderSchema.safeParse(raw)
  if (order.success && order.data.status === 'paid' && order.data.auth_code) return '已交付'
  const status = raw && typeof raw === 'object' && 'status' in raw ? String(raw.status) : ''
  return statusLabel(status)
}
function errorText(cause: unknown): string { return cause instanceof Error ? cause.message : '操作失败，请稍后重试' }
function positiveId(value: unknown): number | undefined { return typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : undefined }
function params() { return { page: page.value, page_size: 20, q: query.value.trim() || undefined, status: status.value || undefined, agency_id: props.owner ? agencyFilter.value : undefined, customer_id: customerFilter.value } }
function navigateRecord(section: RecordSection, id: number): void {
  void router.push({ path: props.owner ? '/admin/agency' : `/agent/${section}`, query: { ...(props.owner ? { section } : {}), record_id: String(id) } })
}
function navigateCustomerRecords(section: 'orders' | 'licenses' | 'requests', customerId: number, id?: number, create = false): void {
  void router.push({ path: props.owner ? '/admin/agency' : `/agent/${section}`, query: { ...(props.owner ? { section } : {}), customer_id: String(customerId), ...(id ? { record_id: String(id) } : {}), ...(create ? { create: '1' } : {}) } })
}
function clearCustomerFilter(): void {
  const { customer_id: _customer, create: _create, record_id: _record, page: _page, ...remaining } = route.query
  void router.replace({ query: remaining })
}
function syncListQuery(): void {
  const { record_id: _record, create: _create, ...remaining } = route.query
  void router.replace({ query: { ...remaining, page: page.value > 1 ? String(page.value) : undefined, q: query.value.trim() || undefined, status: status.value || undefined, agency_id: props.owner && agencyFilter.value ? String(agencyFilter.value) : undefined } })
}
async function load(): Promise<void> {
  const revision = ++loadRevision
  lastListScope = JSON.stringify([props.section, params()])
  loading.value = true; loadError.value = ''
  if (route.query.customer_id && !customerFilter.value) { rows.value = []; total.value = 0; loading.value = false; loadError.value = '客户档案编号无效，请清除筛选后重试'; return }
  try { const result = await agencyApi[recordSection.value](params()); if (revision === loadRevision) { rows.value = result.data; total.value = result.total } }
  catch (cause) { if (revision === loadRevision) { rows.value = []; total.value = 0; loadError.value = errorText(cause) } }
  finally { if (revision === loadRevision) loading.value = false }
}
function applyFilters(): void { page.value = 1; syncListQuery(); void load() }
function changePage(value: number): void { page.value = value; syncListQuery(); void load() }
async function searchAgencies(q: string): Promise<void> {
  const revision = ++agencyRevision; optionsLoading.value = true
  try { const result = await agencyApi.agencies({ q, page_size: 50 }); if (revision === agencyRevision) agencyOptions.value = result.data }
  catch (cause) { if (revision === agencyRevision) showToast(errorText(cause), 'error') }
  finally { if (revision === agencyRevision) optionsLoading.value = false }
}
async function searchCustomers(q: string): Promise<void> {
  const revision = ++customerRevision; customersLoading.value = true
  try { const result = await agencyApi.customers({ q, page_size: 50, agency_id: props.owner ? agencyFilter.value : undefined }); if (revision === customerRevision) customerOptions.value = result.data }
  catch (cause) { if (revision === customerRevision) formError.value = errorText(cause) }
  finally { if (revision === customerRevision) customersLoading.value = false }
}
async function searchOrders(q: string): Promise<void> {
  if (!form.customer_id) return
  const revision = ++orderRevision
  try { const result = await agencyApi.orders({ q, customer_id: form.customer_id, page_size: 50 }); if (revision === orderRevision) orderOptions.value = result.data }
  catch (cause) { if (revision === orderRevision) formError.value = errorText(cause) }
}
function customerChanged(): void { orderRevision++; form.order_id = undefined; orderOptions.value = [] }
async function openCreate(): Promise<void> {
  if (route.query.customer_id && !customerFilter.value) { contextError.value = '客户档案编号无效'; return }
  if (customerFilter.value && !contextCustomer.value) { contextError.value ||= '请先读取并核对当前客户档案'; return }
  editingId.value = undefined; formError.value = ''; Object.assign(form, { name: '', contact: '', notes: '', agency_id: agencyFilter.value, customer_id: contextCustomer.value?.id, plan_id: undefined, platform_key: 'amazon', note: '', kind: 'support', order_id: undefined, content: '' }); formVisible.value = true
  if (contextCustomer.value) customerOptions.value = [contextCustomer.value]
  const revision = ++formRevision
  if (props.section === 'orders') {
    try { const plans = await agencyApi.plans(); if (revision === formRevision) planOptions.value = plans }
    catch (cause) { if (revision === formRevision) formError.value = errorText(cause) }
  }
}
function openDetail(raw: unknown): void {
  routeRevision++
  detailRevision++
  detailError.value = ''; detailLoading.value = false; requestOrder.value = null; requestOrderError.value = ''
  const schemas = { agencies: agencySchema, customers: customerSchema, orders: orderSchema, licenses: licenseSchema, requests: serviceRequestSchema }
  selected.value = schemas[recordSection.value].parse(raw); actionError.value = ''; detailVisible.value = true
  if (selectedRequest.value) {
    Object.assign(responseForm, { status: selectedRequest.value.status === 'open' ? 'resolved' : selectedRequest.value.status, response: selectedRequest.value.response || '' })
    if (selectedRequest.value.order_id) void loadRequestOrder(selectedRequest.value, detailRevision)
  }
}
async function loadRequestOrder(request: ServiceRequest, revision: number): Promise<void> {
  try {
    const order = await agencyApi.order(request.order_id!)
    if (disposed || revision !== detailRevision) return
    if (order.customer_id !== request.customer_id || order.agency_id !== request.agency_id) throw new Error('订单关联不一致，请核对客户归属')
    requestOrder.value = order
  } catch (cause) { if (!disposed && revision === detailRevision) requestOrderError.value = errorText(cause) }
}
async function readRouteDetail(): Promise<void> {
  const id = positiveId(route.query.record_id)
  detailRevision++; selected.value = null; detailError.value = ''; detailLoading.value = false; detailVisible.value = false
  const revision = ++routeRevision
  if (!id || props.section === 'agencies' || props.section === 'commission') return
  const section = props.section
  const method = { customers: agencyApi.customer, orders: agencyApi.order, licenses: agencyApi.license, requests: agencyApi.request }[section]
  detailVisible.value = true; detailLoading.value = true
  try {
    const record = await method(id)
    if (disposed || revision !== routeRevision || !detailVisible.value) return
    if (customerFilter.value && 'customer_id' in record && record.customer_id !== customerFilter.value) throw new Error('此记录不属于当前筛选客户')
    openDetail(record)
  } catch (cause) { if (!disposed && revision === routeRevision) detailError.value = errorText(cause) }
  finally { if (!disposed && revision === routeRevision) detailLoading.value = false }
}
async function readCustomerContext(): Promise<void> {
  const revision = ++contextRevision, id = customerFilter.value
  contextCustomer.value = null; contextError.value = ''
  if (route.query.customer_id && !id) { contextError.value = '客户档案编号无效'; return }
  if (!id) return
  try {
    const customer = await agencyApi.customer(id)
    if (disposed || revision !== contextRevision) return
    contextCustomer.value = customer
    if (route.query.create === '1' && ['orders', 'requests'].includes(props.section)) await openCreate()
  } catch (cause) { if (!disposed && revision === contextRevision) contextError.value = errorText(cause) }
}
function editRecord(): void {
  const record = selectedCustomer.value || selectedAgency.value
  if (!record) return
  editingId.value = record.id; formError.value = ''; Object.assign(form, { name: record.name, contact: record.contact || '', notes: record.notes || '', agency_id: 'agency_id' in record ? record.agency_id : undefined }); detailVisible.value = false; formVisible.value = true
  if (props.owner && selectedCustomer.value) void searchAgencies(selectedCustomer.value.agency_name || '')
}
async function submitForm(): Promise<void> {
  if (submitting.value) return
  formError.value = ''
  if ((props.section === 'agencies' || props.section === 'customers') && !form.name.trim()) { formError.value = '请填写名称'; return }
  if (props.section === 'customers' && props.owner && !form.agency_id) { formError.value = '请选择所属代理'; return }
  if ((props.section === 'orders' || props.section === 'requests') && !form.customer_id) { formError.value = '请选择客户'; return }
  if (props.section === 'orders' && !form.plan_id) { formError.value = '请选择套餐'; return }
  if (props.section === 'requests' && !form.content.trim()) { formError.value = '请填写问题描述'; return }
  submitting.value = true
  try {
    if (props.section === 'agencies') {
      const payload = { name: form.name.trim(), contact: form.contact.trim(), notes: form.notes.trim() }
      if (editingId.value) await agencyApi.updateAgency(editingId.value, payload); else await agencyApi.createAgency(payload)
    } else if (props.section === 'customers') {
      const payload = { name: form.name.trim(), contact: form.contact.trim(), notes: form.notes.trim(), ...(props.owner ? { agency_id: form.agency_id } : {}) }
      if (editingId.value) await agencyApi.updateCustomer(editingId.value, payload); else await agencyApi.createCustomer(payload)
    } else if (props.section === 'orders' && form.customer_id && form.plan_id) await agencyApi.createOrder({ customer_id: form.customer_id, plan_id: form.plan_id, platform_key: form.platform_key, note: form.note.trim() })
    else if (props.section === 'requests' && form.customer_id) await agencyApi.createRequest({ customer_id: form.customer_id, order_id: form.order_id, kind: form.kind, content: form.content.trim() })
    formVisible.value = false; showToast('已保存', 'success'); await load()
  } catch (cause) { formError.value = errorText(cause) }
  finally { submitting.value = false }
}
async function runAction(action: () => Promise<AgencyRecord>): Promise<void> {
  if (submitting.value) return
  const targetRevision = detailRevision, targetId = selected.value?.id, targetSection = props.section
  const isCurrentDetail = (): boolean => !disposed && detailVisible.value && detailRevision === targetRevision && selected.value?.id === targetId && props.section === targetSection
  submitting.value = true; actionError.value = ''
  try {
    const result = await action()
    if (disposed) return
    if (isCurrentDetail()) selected.value = result
    showToast(isCurrentDetail() ? '操作成功' : '上一条记录的操作已完成，列表已刷新', 'success')
    await load()
  }
  catch (cause) {
    if (isCurrentDetail()) actionError.value = errorText(cause)
    else if (!disposed) showToast(`上一条记录的操作未能确认：${errorText(cause)}`, 'error')
  }
  finally { if (!disposed) submitting.value = false }
}
async function confirmPaid(): Promise<void> {
  const order = selectedOrder.value
  if (!props.owner || !order) return
  const confirmationRevision = detailRevision
  try { await ElMessageBox.confirm(`请确认已实际收到 ${order.customer_name} 的 ${money(order.amount)}。此操作只记录收款，不会发起扣款。`, '确认收款', { confirmButtonText: '已核实，确认收款', cancelButtonText: '取消', type: 'warning' }) }
  catch { return }
  if (disposed || !detailVisible.value || detailRevision !== confirmationRevision || props.section !== 'orders' || selectedOrder.value?.id !== order.id) return
  await runAction(() => agencyApi.markPaid(order.id))
}
async function deliverOrder(): Promise<void> {
  const order = selectedOrder.value
  if (!props.owner || !order) return
  await runAction(() => agencyApi.deliver(order.id))
}
async function transitionOrder(kind: 'cancel' | 'refund'): Promise<void> {
  const order = selectedOrder.value
  if (!props.owner || !order || submitting.value || order.status !== (kind === 'refund' ? 'paid' : 'pending')) return
  const revision = detailRevision
  let reason: string
  try {
    const confirmation = await ElMessageBox.prompt(kind === 'refund'
      ? `请先确认已在线下退还 ${money(order.amount)}，再填写原因。这里只登记退款、冲正分润和返佣，不执行转账，也不会停用授权。`
      : `取消 ${order.order_no} 后不再收款或交付。请填写取消原因。`, kind === 'refund' ? '登记线下退款' : '取消代理订单', {
      confirmButtonText: kind === 'refund' ? '已核实，登记退款' : '确认取消', cancelButtonText: '返回',
      inputPlaceholder: '填写至少 2 个字的原因', inputValidator: (value: string) => value.trim().length >= 2 || '请填写至少 2 个字的原因',
      type: 'warning', closeOnClickModal: false,
    })
    reason = String(confirmation.value || '').trim()
  } catch { return }
  if (!reason || disposed || !detailVisible.value || revision !== detailRevision || selectedOrder.value?.id !== order.id) return
  await runAction(() => kind === 'refund' ? agencyApi.refundOrder(order.id, reason) : agencyApi.cancelOrder(order.id, reason))
}
async function toggleAgency(): Promise<void> {
  const agency = selectedAgency.value
  if (!props.owner || !agency) return
  const confirmationRevision = detailRevision
  const status = agency.status === 'active' ? 'disabled' : 'active'
  try { await ElMessageBox.confirm(status === 'disabled' ? '停用后该代理的账号将无法访问工作台，历史业务记录会保留。' : '恢复后该代理账号可重新访问已归属的业务。', status === 'disabled' ? '停用代理' : '恢复代理', { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning' }) }
  catch { return }
  if (disposed || !detailVisible.value || detailRevision !== confirmationRevision || props.section !== 'agencies' || selectedAgency.value?.id !== agency.id) return
  await runAction(() => agencyApi.updateAgency(agency.id, { status }))
}
async function respondRequest(): Promise<void> {
  const request = selectedRequest.value
  if (!props.owner || !request) return
  if (!responseForm.response.trim()) { actionError.value = '请填写回复说明'; return }
  await runAction(() => agencyApi.respond(request.id, { status: responseForm.status, response: responseForm.response.trim() }))
}
async function copyCode(code: string): Promise<void> {
  const license = selectedLicense.value || selectedOrder.value?.auth_code
  if (!license || license.code !== code || !canDeliverLicense(license) || (selectedOrder.value && !selectedOrderCanDeliver.value)) return
  try { await navigator.clipboard.writeText(code); showToast('授权码已复制', 'success') }
  catch { showToast('无法访问剪贴板，请选中授权码手动复制', 'warning') }
}
async function exportCsv(): Promise<void> {
  exporting.value = true
  try {
    const blob = await agencyApi.exportOrders(params())
    const url = URL.createObjectURL(blob), anchor = document.createElement('a')
    anchor.href = url; anchor.download = `KST-订单-${new Date().toISOString().slice(0,10)}.csv`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (cause) { showToast(errorText(cause), 'error') }
  finally { exporting.value = false }
}
watch(() => [props.section, route.query.status, route.query.customer_id, route.query.page, route.query.q, route.query.agency_id], () => {
  page.value = positiveId(route.query.page) || 1
  query.value = typeof route.query.q === 'string' ? route.query.q : ''
  status.value = typeof route.query.status === 'string' ? route.query.status : ''
  agencyFilter.value = props.owner ? positiveId(route.query.agency_id) : undefined
  if (JSON.stringify([props.section, params()]) === lastListScope) return
  selected.value = null; detailVisible.value = false; formVisible.value = false
  void load()
}, { immediate: true })
watch(() => [props.section, route.query.customer_id], () => { void readCustomerContext() }, { immediate: true })
watch(() => [props.section, route.query.record_id, route.query.customer_id], () => { void readRouteDetail() }, { immediate: true })
watch(detailVisible, visible => { if (!visible) { detailRevision++; routeRevision++ } }, { flush: 'sync' })
onUnmounted(() => { disposed = true; detailRevision++; routeRevision++; contextRevision++; loadRevision++; agencyRevision++; customerRevision++; orderRevision++; formRevision++ })
</script>

<style scoped>
.customer-context{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px 16px;margin-bottom:16px;background:var(--color-primary-soft);border-radius:10px;font-size:13px}.customer-context>span{overflow-wrap:anywhere;min-width:0}.customer-context :deep(.el-button+.el-button){margin-left:0}
.records-page{min-width:0}.records-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}.records-heading h1{margin:0 0 10px;font-size:25px;letter-spacing:-.025em}.records-heading p{margin:0;font-size:13px;line-height:1.7;color:var(--color-text-secondary)}.heading-actions{display:flex;gap:10px;flex-shrink:0}.heading-actions :deep(.el-button+.el-button){margin:0}.filter-bar{display:flex;gap:10px;flex-wrap:wrap;padding:16px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;margin-bottom:16px}.filter-bar>.el-input{width:min(260px,100%)}.filter-bar>.el-select{width:160px}.filter-bar>.el-button+.el-button{margin:0}.records-table{border:1px solid var(--color-border);border-radius:12px;overflow:hidden;background:var(--color-surface)}.pagination{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-top:1px solid var(--color-border)}.pagination>span{font-size:12px;color:var(--color-text-tertiary)}.empty-content{padding:34px 10px;line-height:1.8;color:var(--color-text-secondary)}.empty-content small{display:block;margin-top:6px;font-size:12px;color:var(--color-text-tertiary)}.load-error{margin-bottom:16px}.record-form{display:grid;gap:12px}.record-form>label{margin-top:10px;font-size:13px;font-weight:600}.record-form>label>span{color:var(--color-danger)}.record-form :deep(.el-select){width:100%}.form-actions{position:sticky;bottom:-20px;padding:18px 0;background:var(--color-surface);border-top:1px solid var(--color-border);margin-top:16px}.field-help{font-size:12px;line-height:1.75;color:var(--color-text-tertiary);margin:4px 0 10px}.record-detail h2{font-size:23px;margin:12px 0 18px}.record-detail h3{font-size:14px;margin-top:24px}.record-detail dl{display:grid;grid-template-columns:95px minmax(0,1fr);gap:19px;margin:26px 0}.record-detail dt{font-size:13px;color:var(--color-text-tertiary)}.record-detail dd{margin:0;font-size:14px;line-height:1.6;overflow-wrap:anywhere;white-space:pre-wrap}.record-detail .amount{font-weight:700;color:var(--color-primary)}.detail-kicker{font-size:12px;color:var(--color-text-tertiary)}.detail-actions{display:flex;gap:10px;margin:20px 0}.delivery-block{border:1px solid var(--color-border);padding:20px;border-radius:12px;background:var(--color-surface-soft);margin:24px 0}.delivery-block h3{margin:0 0 12px}.delivery-block code{display:block;font-size:18px;letter-spacing:.025em;color:var(--color-primary);overflow-wrap:anywhere;user-select:text;margin-bottom:16px}.delivery-block p{font-size:12px;line-height:1.7;color:var(--color-text-secondary)}.preserve-text{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;color:var(--color-text-secondary);font-size:14px}.record-detail>label{display:block;font-size:13px;margin:18px 0 10px}.record-detail :deep(.el-select){width:100%}code{font-family:var(--font-family);user-select:text}@media(max-width:700px){.records-heading{align-items:flex-start;flex-direction:column}.heading-actions{width:100%;justify-content:flex-end}.filter-bar{padding:12px}.filter-bar>.el-input{width:100%}.filter-bar>.el-select{flex:1;min-width:110px}.pagination{padding:12px}.records-heading h1{font-size:23px}}
</style>

<style scoped>
.records-heading>div:first-child{min-width:0}.records-heading h1,.record-detail h2{overflow-wrap:anywhere}.records-table :deep(.el-table__fixed-right .cell),.records-table :deep(.el-table-fixed-column--right .cell){white-space:nowrap}.field-help,.record-detail dt,.detail-kicker,.pagination>span,.empty-content small{color:var(--color-text-secondary)}.detail-actions,.form-actions{display:flex;flex-wrap:wrap;gap:10px}.detail-actions :deep(.el-button+.el-button),.form-actions :deep(.el-button+.el-button){margin-left:0}
</style>
