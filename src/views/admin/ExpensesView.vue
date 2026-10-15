<template>
  <div class="expenses-page">
    <PageHeader eyebrow="公账记录" title="公账支出" description="记录公司实际发生的支出，并单独管理会员与周期续费。">
      <template #actions>
        <div class="page-actions">
          <button v-if="isSuperAdmin" class="ghost-button" @click="openCategories"><Tags :size="15" />分类管理</button>
          <button class="primary-button" :disabled="categoryOptionsPending" @click="activeLedger === 'expenses' ? openExpenseForm() : openRenewalForm()">
            <Plus :size="16" />{{ activeLedger === 'expenses' ? '记一笔支出' : '新建续费项目' }}
          </button>
        </div>
      </template>
    </PageHeader>

    <p v-if="categoryError" role="alert" class="form-note">
      {{ categoryError }}<button class="compact-button" :disabled="categoriesLoading" @click="loadCategories">重新加载分类</button>
    </p>

    <section class="summary-grid" aria-label="公账支出概览">
      <article class="summary-card summary-card--primary">
        <span class="summary-card__icon"><WalletCards :size="19" /></span>
        <div><small>本月实际支出</small><strong>{{ money(summary.total) }}</strong><em :class="(summary.change_percent ?? 0) > 0 ? 'is-up' : 'is-down'">{{ changeText }}</em></div>
      </article>
      <article class="summary-card">
        <span class="summary-card__icon"><ReceiptText :size="19" /></span>
        <div><small>本月支出笔数</small><strong>{{ summary.count }}</strong><em>仅统计有效流水</em></div>
      </article>
      <article class="summary-card">
        <span class="summary-card__icon"><CalendarClock :size="19" /></span>
        <div><small>提醒期内待续费</small><strong>{{ summary.upcoming_renewals }}</strong><em>按各项目设置实时提醒</em></div>
      </article>
      <article class="summary-card" :class="{ 'has-alert': summary.overdue_renewals > 0 }">
        <span class="summary-card__icon"><CircleAlert :size="19" /></span>
        <div><small>已逾期续费</small><strong>{{ summary.overdue_renewals }}</strong><em>未确认不会计入支出</em></div>
      </article>
    </section>

    <div v-if="summaryError" class="inline-error"><CircleAlert :size="15" />{{ summaryError }}<button @click="loadSummary">重试</button></div>

    <section class="insight-grid">
      <article class="insight-card trend-card">
        <header><div><span>最近六个月</span><h3>支出趋势</h3></div><strong>{{ money(summary.total) }}</strong></header>
        <div class="trend-chart" role="img" aria-label="最近六个月支出柱状图">
          <div v-for="point in summary.trend" :key="point.month" class="trend-column">
            <div class="trend-value">{{ compactMoney(point.total) }}</div>
            <div class="trend-track"><span :style="{ height: trendHeight(point.total) }" /></div>
            <small>{{ monthLabel(point.month) }}</small>
          </div>
          <div v-if="!summary.trend.length" class="chart-empty">暂无趋势数据</div>
        </div>
      </article>
      <article class="insight-card category-card">
        <header><div><span>本月构成</span><h3>支出分类</h3></div><small>按有效支出计算</small></header>
        <div v-if="summary.categories.length" class="category-bars">
          <div v-for="item in summary.categories.slice(0, 6)" :key="item.category_id" class="category-bar">
            <div><strong>{{ item.category_name }}</strong><span>{{ money(item.total) }}</span></div>
            <div class="bar-track"><span :style="{ width: `${Math.min(item.percentage, 100)}%` }" /></div>
            <small>{{ item.percentage.toFixed(1) }}%</small>
          </div>
        </div>
        <div v-else class="chart-empty">本月还没有有效支出</div>
      </article>
    </section>

    <section class="ledger-card">
      <div class="ledger-tabs" role="tablist" aria-label="公账账本">
        <button :class="{ active: activeLedger === 'expenses' }" role="tab" :aria-selected="activeLedger === 'expenses'" @click="switchLedger('expenses')">
          <ReceiptText :size="16" />支出流水<span>{{ expenseTotal }}</span>
        </button>
        <button :class="{ active: activeLedger === 'renewals' }" role="tab" :aria-selected="activeLedger === 'renewals'" @click="switchLedger('renewals')">
          <RefreshCcw :size="16" />续费项目<span>{{ renewalTotal }}</span>
        </button>
      </div>

      <div v-if="activeLedger === 'expenses'" class="ledger-content">
        <div class="toolbar">
          <el-date-picker v-model="expenseFilters.month" type="month" value-format="YYYY-MM" format="YYYY年MM月" placeholder="月份" :clearable="false" />
          <el-select v-model="expenseFilters.category_id" clearable placeholder="全部分类">
            <el-option v-for="item in activeCategories" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
          <el-select v-model="expenseFilters.status" clearable placeholder="全部状态">
            <el-option label="有效" value="active" /><el-option label="已作废" value="voided" />
          </el-select>
          <el-input v-model="expenseFilters.q" clearable placeholder="搜索事项、收款方或备注" @keyup.enter="applyExpenseFilters"><template #prefix><Search :size="15" /></template></el-input>
          <button class="compact-button" @click="applyExpenseFilters"><Search :size="14" />筛选</button>
          <button class="compact-button" :disabled="exporting" @click="handleExport"><Download :size="14" />{{ exporting ? '导出中' : '导出 CSV' }}</button>
        </div>

        <AsyncStateNotice :state="expenseLoadState" :message="expenseError" loading-text="正在读取支出流水…" @retry="loadExpenses" />
        <div v-if="expenseLoadState !== 'loading' && expenseLoadState !== 'error'" class="table-scroll">
          <table class="ledger-table">
            <thead><tr><th>支出日期</th><th>事项 / 收款方</th><th>分类</th><th>金额</th><th>状态</th><th>记录人</th><th class="align-right">操作</th></tr></thead>
            <tbody>
              <tr v-for="item in expenses" :key="item.id" :class="{ muted: item.status === 'voided' }" @click="openExpenseDetail(item)">
                <td>{{ dateText(item.expense_date) }}</td>
                <td><strong>{{ item.title }}</strong><small>{{ item.payee || '未填写收款方' }}<template v-if="item.renewal_name"> · 来自 {{ item.renewal_name }}</template></small></td>
                <td><span class="category-pill">{{ item.category_name }}</span></td>
                <td class="money-cell">{{ money(item.amount) }}</td>
                <td><span :class="['status-pill', `is-${item.status}`]">{{ item.status === 'active' ? '有效' : '已作废' }}</span></td>
                <td>{{ item.created_by_name || '后台人员' }}</td>
                <td class="align-right"><button class="row-button" @click.stop="openExpenseDetail(item)">查看</button></td>
              </tr>
              <tr v-if="!expenses.length"><td colspan="7" class="empty-row">当前筛选条件下没有支出流水</td></tr>
            </tbody>
          </table>
        </div>
        <el-pagination v-if="expenseTotal > expensePageSize" v-model:current-page="expensePage" :page-size="expensePageSize" :total="expenseTotal" layout="prev, pager, next, total" @current-change="loadExpenses" />
      </div>

      <div v-else class="ledger-content">
        <div class="toolbar renewal-toolbar">
          <el-select v-model="renewalFilters.status" clearable placeholder="全部状态">
            <el-option label="进行中" value="active" /><el-option label="已暂停" value="paused" /><el-option label="已结束" value="ended" />
          </el-select>
          <el-select v-model="renewalFilters.due_state" clearable placeholder="全部到期状态">
            <el-option label="已逾期" value="overdue" /><el-option label="今天到期" value="due" /><el-option label="提醒期内" value="upcoming" />
          </el-select>
          <el-input v-model="renewalFilters.q" clearable placeholder="搜索项目或供应商" @keyup.enter="applyRenewalFilters"><template #prefix><Search :size="15" /></template></el-input>
          <button class="compact-button" @click="applyRenewalFilters"><Search :size="14" />筛选</button>
        </div>

        <AsyncStateNotice :state="renewalLoadState" :message="renewalError" loading-text="正在读取续费项目…" @retry="loadRenewals" />
        <div v-if="renewalLoadState !== 'loading' && renewalLoadState !== 'error'" class="table-scroll">
          <table class="ledger-table renewal-table">
            <thead><tr><th>项目 / 供应商</th><th>分类</th><th>周期</th><th>默认金额</th><th>下次到期</th><th>状态</th><th class="align-right">快捷操作</th></tr></thead>
            <tbody>
              <tr v-for="item in renewals" :key="item.id" @click="openRenewalDetail(item)">
                <td><strong>{{ item.name }}</strong><small>{{ item.vendor || '未填写供应商' }}</small></td>
                <td><span class="category-pill">{{ item.category_name }}</span></td>
                <td>{{ cycleText(item.cycle) }}</td>
                <td class="money-cell">{{ money(item.default_amount) }}</td>
                <td><strong>{{ dateText(item.next_due_on) }}</strong><small :class="['due-copy', `is-${item.due_state}`]">{{ dueText(item.due_state) }}</small></td>
                <td><span :class="['status-pill', `is-${item.status}`]">{{ renewalStatusText(item.status) }}</span></td>
                <td class="align-right">
                  <button v-if="item.status === 'active'" class="row-button row-button--primary" @click.stop="openConfirmRenewal(item)">确认续费</button>
                  <button class="row-button" @click.stop="openRenewalDetail(item)">详情</button>
                </td>
              </tr>
              <tr v-if="!renewals.length"><td colspan="7" class="empty-row">当前筛选条件下没有续费项目</td></tr>
            </tbody>
          </table>
        </div>
        <el-pagination v-if="renewalTotal > renewalPageSize" v-model:current-page="renewalPage" :page-size="renewalPageSize" :total="renewalTotal" layout="prev, pager, next, total" @current-change="loadRenewals" />
      </div>
    </section>

    <el-drawer v-model="drawerVisible" :title="drawerTitle" size="min(560px, 94vw)" destroy-on-close>
      <form v-if="drawerMode === 'expense-form'" class="drawer-form" @submit.prevent="saveExpense">
        <label><span>金额（人民币）</span><el-input-number v-model="expenseForm.amount" :min="0.01" :precision="2" :step="0.01" controls-position="right" /></label>
        <label><span>支出日期</span><el-date-picker v-model="expenseForm.expense_date" type="date" value-format="YYYY-MM-DD" format="YYYY年MM月DD日" /></label>
        <label><span>支出事项</span><el-input v-model="expenseForm.title" maxlength="200" placeholder="例如：7 月阿里云服务器" /></label>
        <label><span>分类</span><el-select v-model="expenseForm.category_id" placeholder="选择分类" :loading="categoryOptionsPending" :disabled="categoryOptionsPending"><el-option v-for="item in activeCategories" :key="item.id" :label="item.name" :value="item.id" /></el-select></label>
        <label><span>收款方 <em>可选</em></span><el-input v-model="expenseForm.payee" maxlength="200" placeholder="公司或个人名称" /></label>
        <label><span>备注 <em>可选</em></span><el-input v-model="expenseForm.note" type="textarea" :rows="4" maxlength="4000" show-word-limit /></label>
        <label><span>图片或 PDF 凭证 <em>可选，最多 5 个</em></span><input class="file-input" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" @change="selectFiles" /><small v-if="pendingFiles.length">已选择 {{ pendingFiles.length }} 个文件</small></label>
        <div class="drawer-footer"><button type="button" class="ghost-button" @click="drawerVisible = false">取消</button><button class="primary-button" :disabled="saving || categoryOptionsPending">{{ saving ? '保存中…' : editingExpenseId ? '保存修改' : '确认入账' }}</button></div>
      </form>

      <div v-else-if="drawerMode === 'expense-detail' && selectedExpense" class="detail-sheet">
        <div class="detail-amount"><span>{{ selectedExpense.category_name }}</span><strong>{{ money(selectedExpense.amount) }}</strong><small>{{ dateText(selectedExpense.expense_date) }} · {{ selectedExpense.status === 'active' ? '有效支出' : '已作废' }}</small></div>
        <dl class="detail-list"><div><dt>支出事项</dt><dd>{{ selectedExpense.title }}</dd></div><div><dt>收款方</dt><dd>{{ selectedExpense.payee || '—' }}</dd></div><div><dt>记录人</dt><dd>{{ selectedExpense.created_by_name || '后台人员' }}</dd></div><div><dt>备注</dt><dd>{{ selectedExpense.note || '—' }}</dd></div><div v-if="selectedExpense.renewal_name"><dt>续费来源</dt><dd>{{ selectedExpense.renewal_name }}</dd></div><div v-if="selectedExpense.void_reason"><dt>作废原因</dt><dd>{{ selectedExpense.void_reason }}</dd></div></dl>
        <section class="attachment-section"><header><h4>支出凭证</h4><span>{{ selectedExpense.attachments.length }}/5</span></header><div v-if="selectedExpense.attachments.length" class="attachment-list"><div v-for="file in selectedExpense.attachments" :key="file.id"><FileText :size="16" /><span><strong>{{ file.original_name }}</strong><small>{{ fileSize(file.size_bytes) }}</small></span><button @click="handleDownloadAttachment(file)">下载</button><button v-if="selectedExpense.status === 'active'" class="danger-link" @click="handleDeleteAttachment(file.id)">移除</button></div></div><p v-else>暂无上传凭证</p></section>
        <div v-if="selectedExpense.status === 'active'" class="drawer-footer"><button class="ghost-button" @click="editExpense(selectedExpense)"><Pencil :size="14" />编辑</button><button class="danger-button" @click="handleVoidExpense(selectedExpense)"><Ban :size="14" />作废</button></div>
      </div>

      <form v-else-if="drawerMode === 'renewal-form'" class="drawer-form" @submit.prevent="saveRenewal">
        <label><span>项目名称</span><el-input v-model="renewalForm.name" maxlength="200" placeholder="例如：Figma Professional" /></label>
        <label><span>供应商 <em>可选</em></span><el-input v-model="renewalForm.vendor" maxlength="200" /></label>
        <label><span>默认金额（人民币）</span><el-input-number v-model="renewalForm.default_amount" :min="0.01" :precision="2" :step="0.01" controls-position="right" /></label>
        <label><span>分类</span><el-select v-model="renewalForm.category_id" :loading="categoryOptionsPending" :disabled="categoryOptionsPending"><el-option v-for="item in activeCategories" :key="item.id" :label="item.name" :value="item.id" /></el-select></label>
        <div class="form-pair"><label><span>续费周期</span><el-select v-model="renewalForm.cycle"><el-option label="每月" value="monthly" /><el-option label="每季度" value="quarterly" /><el-option label="每半年" value="semiannual" /><el-option label="每年" value="annual" /></el-select></label><label><span>下次到期日</span><el-date-picker v-model="renewalForm.next_due_on" type="date" value-format="YYYY-MM-DD" format="YYYY年MM月DD日" /></label></div>
        <label><span>提前提醒天数</span><el-input-number v-model="renewalForm.reminder_days" :min="0" :max="90" controls-position="right" /></label>
        <label><span>备注 <em>可选</em></span><el-input v-model="renewalForm.note" type="textarea" :rows="4" maxlength="4000" /></label>
        <div class="form-note"><Info :size="15" />到期只生成提醒，确认已续费后才会进入实际支出。</div>
        <div class="drawer-footer"><button type="button" class="ghost-button" @click="drawerVisible = false">取消</button><button class="primary-button" :disabled="saving || categoryOptionsPending">{{ saving ? '保存中…' : editingRenewalId ? '保存修改' : '创建项目' }}</button></div>
      </form>

      <div v-else-if="drawerMode === 'renewal-detail' && selectedRenewal" class="detail-sheet">
        <div class="detail-amount renewal-hero"><span>{{ cycleText(selectedRenewal.cycle) }} · {{ selectedRenewal.category_name }}</span><strong>{{ selectedRenewal.name }}</strong><small>{{ selectedRenewal.vendor || '未填写供应商' }}</small></div>
        <div class="renewal-due"><span><CalendarClock :size="18" />下次到期</span><strong>{{ dateText(selectedRenewal.next_due_on) }}</strong><em :class="`is-${selectedRenewal.due_state}`">{{ dueText(selectedRenewal.due_state) }}</em></div>
        <dl class="detail-list"><div><dt>默认金额</dt><dd>{{ money(selectedRenewal.default_amount) }}</dd></div><div><dt>提醒设置</dt><dd>提前 {{ selectedRenewal.reminder_days }} 天</dd></div><div><dt>项目状态</dt><dd>{{ renewalStatusText(selectedRenewal.status) }}</dd></div><div><dt>备注</dt><dd>{{ selectedRenewal.note || '—' }}</dd></div></dl>
        <section class="occurrence-section"><header><h4>周期处理记录</h4></header><div v-if="selectedRenewal.occurrences.length" class="occurrence-list"><div v-for="item in selectedRenewal.occurrences" :key="item.id"><span :class="`is-${item.status}`">{{ occurrenceStatusText(item.status) }}</span><strong>{{ dateText(item.due_on) }}</strong><small>{{ item.note || '无备注' }}</small></div></div><p v-else>还没有处理记录</p></section>
        <div class="renewal-actions">
          <button v-if="selectedRenewal.status === 'active'" class="primary-button" @click="openConfirmRenewal(selectedRenewal)">确认已续费</button>
          <button v-if="selectedRenewal.status === 'active'" class="ghost-button" @click="handleSkipRenewal(selectedRenewal)">跳过本期</button>
          <button v-if="selectedRenewal.status !== 'ended'" class="ghost-button" @click="editRenewal(selectedRenewal)">编辑</button>
          <button v-if="selectedRenewal.status === 'active'" class="ghost-button" @click="handlePauseRenewal(selectedRenewal)">暂停</button>
          <button v-if="selectedRenewal.status === 'paused'" class="ghost-button" @click="handleResumeRenewal(selectedRenewal)">恢复</button>
          <button v-if="selectedRenewal.status !== 'ended'" class="danger-button" @click="handleEndRenewal(selectedRenewal)">结束项目</button>
        </div>
      </div>

      <form v-else-if="drawerMode === 'renewal-confirm' && selectedRenewal" class="drawer-form" @submit.prevent="submitConfirmRenewal">
        <div class="confirmation-card"><RefreshCcw :size="20" /><div><strong>确认 {{ selectedRenewal.name }} 已续费</strong><span>本次确认会立即生成一笔实际支出，并推进下次到期日。</span></div></div>
        <label><span>本次实际金额</span><el-input-number v-model="confirmForm.amount" :min="0.01" :precision="2" :step="0.01" controls-position="right" /></label>
        <label><span>实际支出日期</span><el-date-picker v-model="confirmForm.expense_date" type="date" value-format="YYYY-MM-DD" format="YYYY年MM月DD日" /></label>
        <label><span>本次备注 <em>可选</em></span><el-input v-model="confirmForm.note" type="textarea" :rows="4" maxlength="4000" /></label>
        <div class="drawer-footer"><button type="button" class="ghost-button" @click="drawerVisible = false">取消</button><button class="primary-button" :disabled="saving">{{ saving ? '入账中…' : '确认续费并入账' }}</button></div>
      </form>

      <div v-else-if="drawerMode === 'categories'" class="category-manager">
        <form class="category-create" @submit.prevent="createCategory"><el-input v-model="newCategoryName" maxlength="100" placeholder="新增分类名称" /><el-input-number v-model="newCategoryOrder" :min="0" :max="10000" controls-position="right" /><button class="primary-button" :disabled="saving">新增</button></form>
        <div class="category-manager__list"><div v-for="item in categories" :key="item.id"><span><strong>{{ item.name }}</strong><small>{{ item.is_system ? '系统预置' : '自定义' }} · {{ item.status === 'active' ? '使用中' : '已停用' }}</small></span><el-input-number v-model="item.sort_order" :min="0" :max="10000" controls-position="right" /><button class="row-button" @click="saveCategoryOrder(item)">保存排序</button><button :class="['row-button', { 'danger-link': item.status === 'active' }]" @click="toggleCategory(item)">{{ item.status === 'active' ? '停用' : '恢复' }}</button></div></div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { Ban, CalendarClock, CircleAlert, Download, FileText, Info, Pencil, Plus, ReceiptText, RefreshCcw, Search, Tags, WalletCards } from '@lucide/vue'
import PageHeader from '@/components/PageHeader.vue'
import AsyncStateNotice from '@/components/AsyncStateNotice.vue'
import { failedDataState, settledDataState, type AsyncDataState } from '@/features/async/state'
import { authService } from '@/utils/auth'
import { showToast } from '@/utils'
import {
  confirmExpenseRenewal, createExpense, createExpenseCategory, createExpenseRenewal,
  deleteExpenseAttachment, downloadExpenseAttachment, endExpenseRenewal, exportExpenses,
  getExpense, getExpenseCategories, getExpenseRenewal, getExpenseRenewals, getExpenses,
  getExpenseSummary, pauseExpenseRenewal, resumeExpenseRenewal, skipExpenseRenewal,
  updateExpense, updateExpenseCategory, updateExpenseRenewal, uploadExpenseAttachment, voidExpense,
} from '@/utils/api'
import {
  expenseCategorySchema, expensePageSchema, expenseRecordSchema, expenseRenewalSchema,
  expenseSummarySchema, renewalPageSchema, unwrapApiData,
  type ExpenseCategory, type ExpenseRecord, type ExpenseRenewal, type ExpenseSummary,
} from '@/features/admin/expenses/model'

type Ledger = 'expenses' | 'renewals'
type DrawerMode = 'expense-form' | 'expense-detail' | 'renewal-form' | 'renewal-detail' | 'renewal-confirm' | 'categories'

const route = useRoute()
const today = new Date().toISOString().slice(0, 10)
const currentMonth = today.slice(0, 7)
const activeLedger = ref<Ledger>(route.query.tab === 'renewals' ? 'renewals' : 'expenses')
const summary = ref<ExpenseSummary>(expenseSummarySchema.parse({ month: currentMonth, total: 0, previous_total: 0, change_percent: 0, count: 0, upcoming_renewals: 0, overdue_renewals: 0 }))
const summaryError = ref('')
const categories = ref<ExpenseCategory[]>([])
const categoriesLoading = ref(true)
const categoryError = ref('')
const categoryOptionsPending = computed(() => categoriesLoading.value && !categories.value.length)
const expenses = ref<ExpenseRecord[]>([])
const renewals = ref<ExpenseRenewal[]>([])
const expenseTotal = ref(0)
const renewalTotal = ref(0)
const expensePage = ref(1)
const renewalPage = ref(1)
const expensePageSize = 20
const renewalPageSize = 20
const expenseLoadState = ref<AsyncDataState>('loading')
const renewalLoadState = ref<AsyncDataState>('loading')
const expenseError = ref('')
const renewalError = ref('')
const drawerVisible = ref(false)
const drawerMode = ref<DrawerMode>('expense-form')
const selectedExpense = ref<ExpenseRecord | null>(null)
const selectedRenewal = ref<ExpenseRenewal | null>(null)
const editingExpenseId = ref<number | null>(null)
const editingRenewalId = ref<number | null>(null)
const pendingFiles = ref<File[]>([])
const saving = ref(false)
const exporting = ref(false)
const newCategoryName = ref('')
const newCategoryOrder = ref(100)
let expenseRequestId = 0
let renewalRequestId = 0
let summaryRequestId = 0
let drawerRequestId = 0

watch([drawerVisible, drawerMode], () => { drawerRequestId += 1 }, { flush: 'sync' })
onUnmounted(() => { drawerRequestId += 1; summaryRequestId += 1 })

function openDrawer(mode: DrawerMode): number {
  drawerMode.value = mode
  drawerVisible.value = true
  return ++drawerRequestId
}

function isCurrentDrawer(requestId: number): boolean {
  return drawerVisible.value && drawerRequestId === requestId
}

const expenseFilters = reactive({ month: currentMonth, category_id: undefined as number | undefined, status: '', q: '' })
const renewalFilters = reactive({ status: '', due_state: route.query.due === '1' ? 'upcoming' : '', q: '' })
const expenseForm = reactive({ amount: 0, expense_date: today, title: '', category_id: undefined as number | undefined, payee: '', note: '' })
const renewalForm = reactive({ name: '', vendor: '', default_amount: 0, category_id: undefined as number | undefined, cycle: 'monthly' as ExpenseRenewal['cycle'], next_due_on: today, reminder_days: 7, note: '' })
const confirmForm = reactive({ amount: 0, expense_date: today, note: '' })

const isSuperAdmin = computed(() => authService.getRole() === 'super_admin')
const activeCategories = computed(() => categories.value.filter(item => item.status === 'active').sort((a, b) => a.sort_order - b.sort_order))
const changeText = computed(() => {
  if (summary.value.previous_total === 0 && summary.value.total > 0) return '上月无支出，本月新增';
  if (summary.value.change_percent === null) return '暂无可比较的上月基数';
  if (!summary.value.previous_total && !summary.value.total) return '与上月持平'
  const direction = summary.value.change_percent > 0 ? '增加' : summary.value.change_percent < 0 ? '减少' : '持平'
  return direction === '持平' ? '与上月持平' : `较上月${direction} ${Math.abs(summary.value.change_percent).toFixed(1)}%`
})
const drawerTitle = computed(() => ({
  'expense-form': editingExpenseId.value ? '编辑支出' : '记一笔支出',
  'expense-detail': '支出详情',
  'renewal-form': editingRenewalId.value ? '编辑续费项目' : '新建续费项目',
  'renewal-detail': '续费项目详情',
  'renewal-confirm': '确认已续费',
  categories: '支出分类管理',
}[drawerMode.value]))
const maxTrend = computed(() => Math.max(0, ...summary.value.trend.map(item => item.total)))

function money(value: number): string { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value || 0) }
function compactMoney(value: number): string { return value >= 10000 ? `¥${(value / 10000).toFixed(1)}万` : `¥${Number(value || 0).toFixed(0)}` }
function dateText(value: string | null | undefined): string { return value ? value.slice(0, 10).replaceAll('-', '.') : '—' }
function monthLabel(value: string): string { const [, month] = value.split('-'); return `${Number(month)}月` }
function trendHeight(value: number): string { return maxTrend.value ? `${Math.max(8, value / maxTrend.value * 100)}%` : '0%' }
function fileSize(value: number): string { return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB` }
function cycleText(value: ExpenseRenewal['cycle']): string { return ({ monthly: '每月', quarterly: '每季度', semiannual: '每半年', annual: '每年' })[value] }
function renewalStatusText(value: ExpenseRenewal['status']): string { return ({ active: '进行中', paused: '已暂停', ended: '已结束' })[value] }
function occurrenceStatusText(value: ExpenseRenewal['occurrences'][number]['status']): string { return ({ paid: '已续费', skipped: '已跳过', reversed: '已冲正' })[value] }
function dueText(value: ExpenseRenewal['due_state']): string { return ({ upcoming: '即将到期', due: '今天到期', overdue: '已逾期', scheduled: '计划中', paused: '提醒已暂停', ended: '项目已结束' })[value] }
function errorText(error: unknown, fallback: string): string { return error instanceof Error && error.message ? error.message : fallback }

async function loadSummary() {
  const requestId = ++summaryRequestId
  const month = expenseFilters.month
  summaryError.value = ''
  try {
    const result = expenseSummarySchema.parse(await getExpenseSummary(month))
    if (requestId === summaryRequestId) summary.value = result
  } catch (error) {
    if (requestId === summaryRequestId) summaryError.value = errorText(error, '经营概览暂时无法加载')
  }
}

async function loadCategories() {
  categoriesLoading.value = true
  categoryError.value = ''
  try {
    categories.value = expenseCategorySchema.array().parse(await getExpenseCategories(true))
    // A drawer can open before the initial category request finishes. Only fill
    // an unselected new draft; never replace a selected or historical category.
    if (drawerVisible.value && drawerMode.value === 'expense-form' && !editingExpenseId.value && expenseForm.category_id == null) {
      expenseForm.category_id = activeCategories.value[0]?.id
    }
    if (drawerVisible.value && drawerMode.value === 'renewal-form' && !editingRenewalId.value && renewalForm.category_id == null) {
      renewalForm.category_id = activeCategories.value.find(item => item.code === 'tool_membership')?.id || activeCategories.value[0]?.id
    }
  } catch (error) {
    categoryError.value = errorText(error, '支出分类加载失败')
    showToast(categoryError.value, 'error')
  } finally { categoriesLoading.value = false }
}

async function loadExpenses() {
  const requestId = ++expenseRequestId
  expenseLoadState.value = expenses.value.length ? 'data' : 'loading'
  expenseError.value = ''
  try {
    const result = expensePageSchema.parse(await getExpenses({ page: expensePage.value, page_size: expensePageSize, ...expenseFilters }))
    if (requestId !== expenseRequestId) return
    expenses.value = result.data
    expenseTotal.value = result.total
    expenseLoadState.value = settledDataState(result.data.length)
  } catch (error) {
    if (requestId !== expenseRequestId) return
    expenseError.value = errorText(error, '支出流水暂时无法加载')
    expenseLoadState.value = failedDataState(expenses.value.length > 0)
  }
}

async function loadRenewals() {
  const requestId = ++renewalRequestId
  renewalLoadState.value = renewals.value.length ? 'data' : 'loading'
  renewalError.value = ''
  try {
    const result = renewalPageSchema.parse(await getExpenseRenewals({ page: renewalPage.value, page_size: renewalPageSize, ...renewalFilters }))
    if (requestId !== renewalRequestId) return
    renewals.value = result.data
    renewalTotal.value = result.total
    renewalLoadState.value = settledDataState(result.data.length)
  } catch (error) {
    if (requestId !== renewalRequestId) return
    renewalError.value = errorText(error, '续费项目暂时无法加载')
    renewalLoadState.value = failedDataState(renewals.value.length > 0)
  }
}

function applyExpenseFilters() { expensePage.value = 1; void Promise.all([loadExpenses(), loadSummary()]) }
function applyRenewalFilters() { renewalPage.value = 1; void loadRenewals() }
function switchLedger(value: Ledger) { activeLedger.value = value; if (value === 'renewals' && renewalLoadState.value === 'loading') void loadRenewals() }

function resetExpenseForm() { Object.assign(expenseForm, { amount: 0, expense_date: today, title: '', category_id: activeCategories.value[0]?.id, payee: '', note: '' }); pendingFiles.value = []; editingExpenseId.value = null }
function openExpenseForm() { resetExpenseForm(); openDrawer('expense-form') }
function editExpense(item: ExpenseRecord) { Object.assign(expenseForm, { amount: item.amount, expense_date: item.expense_date, title: item.title, category_id: item.category_id, payee: item.payee || '', note: item.note || '' }); pendingFiles.value = []; editingExpenseId.value = item.id; openDrawer('expense-form') }
function selectFiles(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files || [])
  if (files.length > 5) { showToast('每笔支出最多上传 5 个凭证', 'warning'); pendingFiles.value = files.slice(0, 5); return }
  if (files.some(file => file.size > 10 * 1024 * 1024)) { showToast('单个凭证不能超过 10MB', 'warning'); return }
  pendingFiles.value = files
}

async function saveExpense() {
  if (saving.value || categoryOptionsPending.value) return
  if (!expenseForm.amount || !expenseForm.title.trim() || !expenseForm.category_id || !expenseForm.expense_date) { showToast('请完整填写金额、日期、事项和分类', 'warning'); return }
  const requestId = drawerRequestId
  const editingId = editingExpenseId.value
  const files = [...pendingFiles.value]
  const payload = { ...expenseForm, category_id: expenseForm.category_id, payee: expenseForm.payee || null, note: expenseForm.note || null }
  saving.value = true
  try {
    const raw = editingId ? await updateExpense(editingId, payload) : await createExpense(payload)
    const saved = expenseRecordSchema.parse(unwrapApiData(raw))
    let failedUploads = 0
    for (const file of files) {
      try { await uploadExpenseAttachment(saved.id, file) }
      catch { failedUploads += 1 }
    }
    showToast(
      failedUploads
        ? `支出已保存，${failedUploads} 个凭证上传失败，可编辑记录后重试`
        : editingId ? '支出已更新' : '支出已入账',
      failedUploads ? 'warning' : 'success',
    )
    if (isCurrentDrawer(requestId)) drawerVisible.value = false
    await Promise.all([loadExpenses(), loadSummary()])
  } catch (error) { showToast(errorText(error, '支出保存失败'), 'error') }
  finally { saving.value = false }
}

async function openExpenseDetail(item: ExpenseRecord) {
  const requestId = openDrawer('expense-detail')
  selectedExpense.value = item
  try {
    const detail = expenseRecordSchema.parse(await getExpense(item.id))
    if (isCurrentDrawer(requestId)) selectedExpense.value = detail
  } catch (error) {
    if (isCurrentDrawer(requestId)) showToast(errorText(error, '支出详情加载失败'), 'error')
  }
}

async function handleVoidExpense(item: ExpenseRecord) {
  const requestId = drawerRequestId
  try {
    const result = await ElMessageBox.prompt('请输入作废原因。流水会保留，但不再计入支出统计。', '作废这笔支出？', { inputPattern: /\S{2,}/, inputErrorMessage: '请至少输入 2 个字符', confirmButtonText: '确认作废', cancelButtonText: '取消', type: 'warning' })
    await voidExpense(item.id, result.value)
    if (isCurrentDrawer(requestId)) drawerVisible.value = false
    showToast('支出已作废', 'success'); await Promise.all([loadExpenses(), loadSummary()])
  } catch (error) { if (error !== 'cancel' && error !== 'close') showToast(errorText(error, '作废失败'), 'error') }
}

async function handleDownloadAttachment(file: ExpenseRecord['attachments'][number]) { try { const blob = await downloadExpenseAttachment(file.expense_id, file.id); downloadBlob(blob, file.original_name) } catch (error) { showToast(errorText(error, '凭证下载失败'), 'error') } }
async function handleDeleteAttachment(attachmentId: number) {
  const expense = selectedExpense.value
  if (!expense) return
  const requestId = drawerRequestId
  try {
    await ElMessageBox.confirm('移除后无法从系统恢复这个凭证文件。', '移除凭证？', { confirmButtonText: '移除', cancelButtonText: '取消', type: 'warning' })
    await deleteExpenseAttachment(expense.id, attachmentId)
    if (isCurrentDrawer(requestId)) await openExpenseDetail(expense)
    showToast('凭证已移除', 'success')
  }
  catch (error) { if (error !== 'cancel' && error !== 'close') showToast(errorText(error, '凭证移除失败'), 'error') }
}

function resetRenewalForm() { Object.assign(renewalForm, { name: '', vendor: '', default_amount: 0, category_id: activeCategories.value.find(item => item.code === 'tool_membership')?.id || activeCategories.value[0]?.id, cycle: 'monthly', next_due_on: today, reminder_days: 7, note: '' }); editingRenewalId.value = null }
function openRenewalForm() { resetRenewalForm(); openDrawer('renewal-form') }
function editRenewal(item: ExpenseRenewal) { Object.assign(renewalForm, { name: item.name, vendor: item.vendor || '', default_amount: item.default_amount, category_id: item.category_id, cycle: item.cycle, next_due_on: item.next_due_on, reminder_days: item.reminder_days, note: item.note || '' }); editingRenewalId.value = item.id; openDrawer('renewal-form') }

async function saveRenewal() {
  if (saving.value || categoryOptionsPending.value) return
  if (!renewalForm.name.trim() || !renewalForm.default_amount || !renewalForm.category_id || !renewalForm.next_due_on) { showToast('请完整填写名称、金额、分类和到期日', 'warning'); return }
  const requestId = drawerRequestId
  const editingId = editingRenewalId.value
  const payload = { ...renewalForm, category_id: renewalForm.category_id, vendor: renewalForm.vendor || null, note: renewalForm.note || null }
  saving.value = true
  try {
    if (editingId) await updateExpenseRenewal(editingId, payload); else await createExpenseRenewal(payload)
    showToast(editingId ? '续费项目已更新' : '续费项目已创建', 'success')
    if (isCurrentDrawer(requestId)) drawerVisible.value = false
    await Promise.all([loadRenewals(), loadSummary()])
  } catch (error) { showToast(errorText(error, '续费项目保存失败'), 'error') }
  finally { saving.value = false }
}

async function openRenewalDetail(item: ExpenseRenewal) {
  const requestId = openDrawer('renewal-detail')
  selectedRenewal.value = item
  try {
    const detail = expenseRenewalSchema.parse(await getExpenseRenewal(item.id))
    if (isCurrentDrawer(requestId)) selectedRenewal.value = detail
  } catch (error) {
    if (isCurrentDrawer(requestId)) showToast(errorText(error, '续费详情加载失败'), 'error')
  }
}
function openConfirmRenewal(item: ExpenseRenewal) { selectedRenewal.value = item; Object.assign(confirmForm, { amount: item.default_amount, expense_date: today, note: '' }); openDrawer('renewal-confirm') }
async function submitConfirmRenewal() {
  if (saving.value) return
  if (!selectedRenewal.value || !confirmForm.amount || !confirmForm.expense_date) return
  const requestId = drawerRequestId
  const renewalId = selectedRenewal.value.id
  const payload = { due_on: selectedRenewal.value.next_due_on, ...confirmForm, note: confirmForm.note || null }
  saving.value = true
  try {
    await confirmExpenseRenewal(renewalId, payload)
    if (isCurrentDrawer(requestId)) drawerVisible.value = false
    showToast('续费已确认并计入支出', 'success')
    await Promise.all([loadRenewals(), loadExpenses(), loadSummary()])
  }
  catch (error) { showToast(errorText(error, '续费确认失败'), 'error') }
  finally { saving.value = false }
}
async function handleSkipRenewal(item: ExpenseRenewal) { try { const result = await ElMessageBox.prompt('可选填写跳过说明。本期不会产生支出，下一到期日仍会推进。', '跳过本期续费？', { confirmButtonText: '确认跳过', cancelButtonText: '取消' }); await skipExpenseRenewal(item.id, item.next_due_on, result.value); drawerVisible.value = false; showToast('本期已跳过', 'success'); await Promise.all([loadRenewals(), loadSummary()]) } catch (error) { if (error !== 'cancel' && error !== 'close') showToast(errorText(error, '跳过失败'), 'error') } }
async function handlePauseRenewal(item: ExpenseRenewal) { try { await ElMessageBox.confirm('暂停后不再提醒，恢复时需要重新选择到期日。', '暂停续费项目？', { confirmButtonText: '暂停', cancelButtonText: '取消', type: 'warning' }); await pauseExpenseRenewal(item.id); drawerVisible.value = false; await Promise.all([loadRenewals(), loadSummary()]); showToast('续费项目已暂停', 'success') } catch (error) { if (error !== 'cancel' && error !== 'close') showToast(errorText(error, '暂停失败'), 'error') } }
async function handleResumeRenewal(item: ExpenseRenewal) { try { const result = await ElMessageBox.prompt('请输入新的下次到期日（YYYY-MM-DD）。', '恢复续费项目', { inputValue: item.next_due_on, inputPattern: /^\d{4}-\d{2}-\d{2}$/, inputErrorMessage: '请输入 YYYY-MM-DD 格式日期', confirmButtonText: '恢复', cancelButtonText: '取消' }); await resumeExpenseRenewal(item.id, result.value); drawerVisible.value = false; await Promise.all([loadRenewals(), loadSummary()]); showToast('续费项目已恢复', 'success') } catch (error) { if (error !== 'cancel' && error !== 'close') showToast(errorText(error, '恢复失败'), 'error') } }
async function handleEndRenewal(item: ExpenseRenewal) { try { await ElMessageBox.confirm('结束后将永久停止未来提醒，已有支出不会改变。', '结束续费项目？', { confirmButtonText: '确认结束', cancelButtonText: '取消', type: 'warning' }); await endExpenseRenewal(item.id); drawerVisible.value = false; await Promise.all([loadRenewals(), loadSummary()]); showToast('续费项目已结束', 'success') } catch (error) { if (error !== 'cancel' && error !== 'close') showToast(errorText(error, '结束失败'), 'error') } }

function openCategories() { openDrawer('categories') }
async function createCategory() { if (!newCategoryName.value.trim()) return; saving.value = true; try { await createExpenseCategory({ name: newCategoryName.value.trim(), sort_order: newCategoryOrder.value }); newCategoryName.value = ''; await loadCategories(); showToast('分类已新增', 'success') } catch (error) { showToast(errorText(error, '分类新增失败'), 'error') } finally { saving.value = false } }
async function saveCategoryOrder(item: ExpenseCategory) { try { await updateExpenseCategory(item.id, { sort_order: item.sort_order }); await loadCategories(); showToast('分类排序已保存', 'success') } catch (error) { showToast(errorText(error, '排序保存失败'), 'error') } }
async function toggleCategory(item: ExpenseCategory) { try { await updateExpenseCategory(item.id, { status: item.status === 'active' ? 'archived' : 'active' }); await loadCategories(); showToast(item.status === 'active' ? '分类已停用' : '分类已恢复', 'success') } catch (error) { showToast(errorText(error, '分类状态更新失败'), 'error') } }
function downloadBlob(blob: Blob, filename: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url) }
async function handleExport() { exporting.value = true; try { const blob = await exportExpenses(expenseFilters); downloadBlob(blob, `公账支出_${expenseFilters.month}.csv`); showToast('支出流水已导出', 'success') } catch (error) { showToast(errorText(error, '导出失败'), 'error') } finally { exporting.value = false } }

onMounted(async () => {
  await loadCategories()
  await Promise.all([loadSummary(), loadExpenses(), loadRenewals()])
})
</script>

<style scoped>
.expenses-page { display: grid; gap: 18px; min-width: 0; }
.page-actions { display: flex; align-items: center; gap: 10px; }
.primary-button,.ghost-button,.danger-button,.compact-button,.row-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border-radius: 9px; font: inherit; font-size: var(--type-control); font-weight: 700; cursor: pointer; transition: var(--transition); }
.primary-button { min-height: 38px; padding: 0 16px; border: 1px solid var(--color-primary); color: white; background: var(--color-primary); }
.primary-button:hover { background: var(--color-primary-hover); }
.ghost-button,.compact-button { min-height: 38px; padding: 0 14px; border: 1px solid var(--color-border); color: var(--color-text-secondary); background: var(--color-surface); }
.ghost-button:hover,.compact-button:hover { color: var(--color-text); border-color: var(--color-border-strong); }
.danger-button { min-height: 38px; padding: 0 14px; border: 1px solid rgba(195,61,73,.25); color: var(--color-danger); background: var(--color-danger-soft); }
button:disabled { opacity: .55; cursor: wait; }
.summary-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; }
.summary-card { min-width: 0; min-height: 116px; display: flex; align-items: flex-start; gap: 13px; padding: 18px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-low); }
.summary-card--primary { border-color: rgba(45,95,202,.24); background: linear-gradient(145deg,rgba(45,95,202,.09),rgba(252,252,253,.96) 62%); }
.summary-card.has-alert { border-color: rgba(195,61,73,.22); }
.summary-card__icon { width: 38px; height: 38px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 11px; color: var(--color-primary); background: var(--color-primary-soft); }
.summary-card.has-alert .summary-card__icon { color: var(--color-danger); background: var(--color-danger-soft); }
.summary-card>div { min-width: 0; display: grid; gap: 5px; }
.summary-card small { color: var(--color-text-secondary); font-size: 12px; font-weight: 650; }
.summary-card strong { color: var(--color-text); font-size: 23px; line-height: 1.15; letter-spacing: -.035em; overflow-wrap: anywhere; }
.summary-card em { color: var(--color-text-tertiary); font-size: 11px; font-style: normal; }
.summary-card em.is-up { color: var(--color-warning); }.summary-card em.is-down { color: var(--color-success); }
.inline-error { display: flex; align-items: center; gap: 8px; margin-top: -8px; padding: 10px 12px; border-radius: 9px; color: var(--color-danger); background: var(--color-danger-soft); font-size: 12px; }
.inline-error button { margin-left: auto; border: 0; color: inherit; background: none; font-size: var(--type-control); font-weight: 700; cursor: pointer; }
.insight-grid { display: grid; grid-template-columns: minmax(0,1.35fr) minmax(340px,.85fr); gap: 12px; }
.insight-card { min-width: 0; padding: 18px 20px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-low); }
.insight-card>header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.insight-card header div { display: grid; gap: 3px; }.insight-card header span,.insight-card header small { color: var(--color-text-tertiary); font-size: 11px; }.insight-card h3 { margin: 0; font-size: 15px; }.insight-card header>strong { font-size: 16px; }
.trend-chart { height: 156px; display: flex; align-items: stretch; gap: clamp(8px,2vw,20px); margin-top: 16px; padding-top: 20px; border-bottom: 1px solid var(--color-border); }
.trend-column { min-width: 0; flex: 1; display: grid; grid-template-rows: 16px 1fr 24px; gap: 5px; text-align: center; }.trend-value { color: var(--color-text-tertiary); font-size: 10px; white-space: nowrap; }.trend-track { display: flex; align-items: flex-end; justify-content: center; min-height: 72px; }.trend-track span { width: min(36px,72%); border-radius: 6px 6px 2px 2px; background: linear-gradient(180deg,var(--color-primary-muted),var(--color-primary)); }.trend-column small { color: var(--color-text-secondary); font-size: 11px; }
.chart-empty { width: 100%; display: grid; place-items: center; min-height: 90px; color: var(--color-text-tertiary); font-size: 12px; }
.category-bars { display: grid; gap: 12px; margin-top: 18px; }.category-bar { display: grid; grid-template-columns: 1fr 38px; gap: 5px 10px; align-items: center; }.category-bar>div:first-child { grid-column: 1/3; display: flex; justify-content: space-between; gap: 16px; font-size: 12px; }.category-bar>div:first-child span { color: var(--color-text-secondary); }.bar-track { height: 6px; overflow: hidden; border-radius: 99px; background: var(--color-canvas); }.bar-track span { display: block; height: 100%; border-radius: inherit; background: var(--color-primary); }.category-bar>small { color: var(--color-text-tertiary); font-size: 10px; text-align: right; }
.ledger-card { min-width: 0; overflow: hidden; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); box-shadow: var(--shadow-low); }
.ledger-tabs { display: flex; align-items: center; gap: 4px; padding: 8px 12px 0; border-bottom: 1px solid var(--color-border); background: var(--color-surface-soft); }.ledger-tabs button { position: relative; display: inline-flex; align-items: center; gap: 8px; min-height: 46px; padding: 0 14px; border: 0; color: var(--color-text-secondary); background: transparent; font: inherit; font-size: var(--type-control); font-weight: 700; cursor: pointer; }.ledger-tabs button span { min-width: 22px; padding: 2px 6px; border-radius: 99px; color: var(--color-text-tertiary); background: var(--color-canvas); font-size: 10px; }.ledger-tabs button.active { color: var(--color-primary); }.ledger-tabs button.active::after { content:''; position:absolute; left:12px; right:12px; bottom:-1px; height:2px; background:var(--color-primary); }.ledger-tabs button.active span { color: var(--color-primary); background: var(--color-primary-soft); }
.ledger-content { min-width: 0; padding: 14px; }.toolbar { display: grid; grid-template-columns: 150px 150px 130px minmax(220px,1fr) auto auto; gap: 8px; align-items: center; margin-bottom: 12px; }.renewal-toolbar { grid-template-columns: 160px 160px minmax(240px,1fr) auto; }.toolbar :deep(.el-select),.toolbar :deep(.el-date-editor),.toolbar :deep(.el-input) { width: 100%; }
.table-scroll { overflow: auto; max-height: min(520px,calc(100vh - 330px)); border: 1px solid var(--color-border); border-radius: 10px; }.ledger-table { width: 100%; min-width: 920px; border-collapse: separate; border-spacing: 0; font-size: 12px; }.ledger-table th { position: sticky; top: 0; z-index: 1; height: 40px; padding: 0 12px; border-bottom: 1px solid var(--color-border); color: var(--color-text-tertiary); background: var(--color-surface-soft); text-align: left; font-weight: 700; white-space: nowrap; }.ledger-table td { height: 54px; padding: 8px 12px; border-bottom: 1px solid #edf0f3; color: var(--color-text-secondary); vertical-align: middle; }.ledger-table tbody tr { cursor: pointer; transition: background var(--motion-fast); }.ledger-table tbody tr:hover { background: rgba(45,95,202,.035); }.ledger-table tbody tr:last-child td { border-bottom: 0; }.ledger-table tr.muted { opacity:.58; }.ledger-table td>strong,.ledger-table td>small { display:block; }.ledger-table td>strong { color:var(--color-text); font-size:12px; }.ledger-table td>small { margin-top:3px; color:var(--color-text-tertiary); font-size:10px; }.money-cell { color:var(--color-text)!important; font-weight:750; font-variant-numeric:tabular-nums; }.align-right { text-align:right!important; }.category-pill,.status-pill { display:inline-flex; align-items:center; min-height:23px; padding:0 8px; border-radius:99px; font-size:10px; font-weight:700; white-space:nowrap; }.category-pill { color:var(--color-primary); background:var(--color-primary-soft); }.status-pill.is-active { color:var(--color-success); background:var(--color-success-soft); }.status-pill.is-voided,.status-pill.is-ended { color:var(--color-text-tertiary); background:var(--color-canvas); }.status-pill.is-paused { color:var(--color-warning); background:var(--color-warning-soft); }.row-button { min-height:29px; padding:0 9px; margin-left:5px; border:1px solid var(--color-border); color:var(--color-text-secondary); background:var(--color-surface); font-size:11px; }.row-button--primary { color:var(--color-primary); border-color:rgba(45,95,202,.22); background:var(--color-primary-soft); }.danger-link { color:var(--color-danger)!important; }.empty-row { height:112px!important; color:var(--color-text-tertiary)!important; text-align:center; }.due-copy.is-overdue,.due-copy.is-due { color:var(--color-danger)!important; }.due-copy.is-upcoming { color:var(--color-warning)!important; }.ledger-content :deep(.el-pagination) { justify-content:flex-end; margin-top:14px; }
.drawer-form { display:grid; gap:17px; }.drawer-form label { display:grid; gap:7px; color:var(--color-text); font-size:12px; font-weight:700; }.drawer-form label span { display:flex; justify-content:space-between; }.drawer-form label em { color:var(--color-text-tertiary); font-size:10px; font-style:normal; font-weight:500; }.drawer-form :deep(.el-input-number),.drawer-form :deep(.el-select),.drawer-form :deep(.el-date-editor) { width:100%; }.file-input { width:100%; padding:10px; border:1px dashed var(--color-border-strong); border-radius:10px; color:var(--color-text-secondary); background:var(--color-surface-soft); font-size:var(--type-control); }.form-pair { display:grid; grid-template-columns:1fr 1fr; gap:12px; }.form-note { display:flex; gap:8px; padding:11px 12px; border-radius:9px; color:var(--color-text-secondary); background:var(--color-primary-soft); font-size:11px; line-height:1.5; }.drawer-footer { position:sticky; bottom:0; display:flex; justify-content:flex-end; gap:9px; margin:10px -20px -20px; padding:14px 20px; border-top:1px solid var(--color-border); background:rgba(252,252,253,.96); backdrop-filter:blur(12px); }
.detail-sheet { display:grid; gap:17px; }.detail-amount { display:grid; gap:6px; padding:20px; border:1px solid rgba(45,95,202,.18); border-radius:14px; background:linear-gradient(145deg,var(--color-primary-soft),var(--color-surface)); }.detail-amount span { color:var(--color-primary); font-size:11px; font-weight:750; }.detail-amount strong { color:var(--color-text); font-size:30px; letter-spacing:-.04em; }.detail-amount small { color:var(--color-text-secondary); font-size:11px; }.renewal-hero strong { font-size:22px; }.detail-list { display:grid; margin:0; border-top:1px solid var(--color-border); }.detail-list div { display:grid; grid-template-columns:110px 1fr; gap:14px; padding:12px 4px; border-bottom:1px solid var(--color-border); font-size:12px; }.detail-list dt { color:var(--color-text-tertiary); }.detail-list dd { margin:0; color:var(--color-text); line-height:1.6; overflow-wrap:anywhere; }.attachment-section,.occurrence-section { padding:15px; border:1px solid var(--color-border); border-radius:11px; background:var(--color-surface-soft); }.attachment-section header,.occurrence-section header { display:flex; justify-content:space-between; align-items:center; }.attachment-section h4,.occurrence-section h4 { margin:0; font-size:13px; }.attachment-section header span { color:var(--color-text-tertiary); font-size:10px; }.attachment-section>p,.occurrence-section>p { margin:18px 0 3px; color:var(--color-text-tertiary); font-size:11px; text-align:center; }.attachment-list { display:grid; gap:7px; margin-top:12px; }.attachment-list>div { display:grid; grid-template-columns:auto 1fr auto auto; gap:8px; align-items:center; padding:8px; border-radius:8px; background:var(--color-surface); }.attachment-list span { min-width:0; }.attachment-list strong,.attachment-list small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; }.attachment-list small { color:var(--color-text-tertiary); }.attachment-list button { border:0; color:var(--color-primary); background:none; font-size:10px; cursor:pointer; }.renewal-due { display:grid; grid-template-columns:1fr auto; gap:6px 12px; padding:14px; border-radius:11px; background:var(--color-surface-soft); }.renewal-due span { display:flex; align-items:center; gap:7px; color:var(--color-text-secondary); font-size:12px; }.renewal-due strong { font-size:16px; }.renewal-due em { grid-column:1/3; color:var(--color-warning); font-size:10px; font-style:normal; }.renewal-due em.is-overdue,.renewal-due em.is-due { color:var(--color-danger); }.occurrence-list { display:grid; gap:7px; margin-top:11px; }.occurrence-list div { display:grid; grid-template-columns:55px 90px 1fr; gap:8px; align-items:center; padding:8px; border-radius:7px; background:var(--color-surface); font-size:10px; }.occurrence-list span { color:var(--color-success); font-weight:700; }.occurrence-list span.is-skipped { color:var(--color-text-tertiary); }.occurrence-list span.is-reversed { color:var(--color-warning); }.occurrence-list small { color:var(--color-text-tertiary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.renewal-actions { display:flex; flex-wrap:wrap; gap:8px; }.confirmation-card { display:flex; gap:11px; padding:14px; border-radius:11px; color:var(--color-primary); background:var(--color-primary-soft); }.confirmation-card div { display:grid; gap:4px; }.confirmation-card strong { color:var(--color-text); font-size:13px; }.confirmation-card span { color:var(--color-text-secondary); font-size:11px; line-height:1.5; }
.category-create { display:grid; grid-template-columns:1fr 120px auto; gap:8px; margin-bottom:16px; }.category-manager__list { display:grid; border-top:1px solid var(--color-border); }.category-manager__list>div { display:grid; grid-template-columns:1fr 105px auto auto; gap:7px; align-items:center; padding:11px 2px; border-bottom:1px solid var(--color-border); }.category-manager__list span { min-width:0; }.category-manager__list strong,.category-manager__list small { display:block; }.category-manager__list strong { font-size:12px; }.category-manager__list small { margin-top:3px; color:var(--color-text-tertiary); font-size:10px; }
.row-button { min-height:30px; font-size:var(--type-control); }
.attachment-list button { font-size:var(--type-control); }
@media (max-width:1180px) { .summary-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }.toolbar { grid-template-columns:repeat(3,minmax(0,1fr)); }.renewal-toolbar { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media (max-width:820px) { .insight-grid { grid-template-columns:1fr; }.page-actions { flex-wrap:wrap; }.category-manager__list>div { grid-template-columns:1fr auto auto; }.category-manager__list :deep(.el-input-number) { grid-row:2; grid-column:1; } }
@media (max-width:560px) { .summary-grid { grid-template-columns:1fr; }.toolbar,.renewal-toolbar { grid-template-columns:1fr; }.form-pair,.category-create { grid-template-columns:1fr; }.trend-chart { gap:4px; }.trend-value { transform:rotate(-35deg); }.category-manager__list>div { grid-template-columns:1fr auto; }.category-manager__list :deep(.el-input-number) { grid-column:1/3; }.drawer-footer { position:static; }.detail-list div { grid-template-columns:90px 1fr; } }
</style>
