<template>
  <div>
    <PageHeader eyebrow="系统设置" title="系统设置" description="维护客服联系方式和旧版兼容配置。新套餐与成员分成使用各自的管理入口。" />

    <nav v-if="canEditProfitPolicy" class="settings-workflows" aria-label="当前业务入口">
      <span>当前业务</span>
      <el-button link type="primary" @click="router.push('/admin/commercial')">管理新套餐与服务 →</el-button>
      <el-button link type="primary" @click="router.push('/admin/team-ledger')">管理新成员分成 →</el-button>
    </nav>

    <el-card class="settings-card" shadow="never">
      <template #header><div class="card-header"><span>基本设置</span></div></template>
      <el-form label-position="top">
        <el-form-item>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">管理员密码</div>
              <div class="setting-desc">密码通过当前密码校验后单独修改，不存入通用设置。</div>
            </div>
            <div class="setting-control">
              <el-button type="primary" @click="goChangePassword">前往更改密码</el-button>
            </div>
          </div>
        </el-form-item>

        <el-form-item>
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-title">客服微信</div>
              <div class="setting-desc">显示在登录页和帮助页面</div>
            </div>
            <div class="setting-control">
              <el-input v-model="wechatId" placeholder="客服微信号" style="width: 250px;" />
              <el-button type="primary" @click="saveWechat">保存</el-button>
            </div>
          </div>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card v-if="canEditProfitPolicy" class="settings-card" shadow="never">
      <template #header>
        <div class="card-header">
          <div>
            <span>旧版分润规则</span>
            <small class="header-hint">仅用于旧版订单链路；不修改新的成员分成台账。保存后生成新版本，历史订单保留原快照。</small>
          </div>
          <el-button type="primary" size="small" @click="openProfitEdit">编辑旧版比例</el-button>
        </div>
      </template>
      <div class="profit-summary">{{ profitRatiosText }}</div>
    </el-card>

    <el-card class="settings-card" shadow="never">
      <template #header>
        <div class="card-header">
          <div>
            <span>旧版套餐（兼容）</span>
            <small class="header-hint">仅供旧版下单与授权流程使用。新套餐、项目期限和服务次数请在“套餐与服务”中管理。</small>
          </div>
          <el-button type="primary" size="small" :disabled="savingPlan" @click="showAddPlan = true">+ 新增旧版套餐</el-button>
        </div>
      </template>

      <div v-if="editingPlan?.status === 'active'" class="lifecycle-notice">
        当前旧版套餐正在启用：可保存名称、价格和功能说明；价格调整只影响通过旧版流程新建的订单，历史订单金额保持不变。有效期和产品权限需先禁用套餐再修改。
      </div>

      <el-table :data="plans" style="width: 100%">
        <el-table-column label="套餐名称" min-width="140">
          <template #default="{ row }">
            <el-input v-if="editingPlan?.id === row.id" v-model="editingPlan!.name" :disabled="savingPlan" :maxlength="100" size="small" />
            <span v-else>{{ row.name }}</span>
          </template>
        </el-table-column>

        <el-table-column label="价格" width="120">
          <template #default="{ row }">
            <el-input-number
              v-if="editingPlan?.id === row.id"
              v-model="editingPlan!.price"
              size="small"
              :min="0.01"
              :max="99999999.99"
              :disabled="savingPlan"
              :step="0.01"
              :precision="2"
              style="width: 100px;"
            />
            <span v-else>¥{{ row.price }}</span>
          </template>
        </el-table-column>

        <el-table-column label="有效期" width="120">
          <template #default="{ row }">
            <el-input-number
              v-if="editingPlan?.id === row.id"
              v-model="editingPlan!.duration_days"
              size="small"
              :min="1"
              :max="3650"
              :step="1"
              step-strictly
              :disabled="savingPlan || row.status !== 'disabled'"
              style="width: 100px;"
            />
            <span v-else>{{ row.duration_days }} 天</span>
          </template>
        </el-table-column>

        <el-table-column label="功能" min-width="180">
          <template #default="{ row }">
            <el-input v-if="editingPlan?.id === row.id" v-model="editingPlan!.features" :disabled="savingPlan" size="small" />
            <span v-else class="feature-text">{{ row.features || '-' }}</span>
          </template>
        </el-table-column>

        <el-table-column label="产品类型" width="130">
          <template #default="{ row }">
            <el-tag :type="row.product_type === 'business' ? 'warning' : 'info'" size="small">
              {{ row.product_type === 'business' ? '专业 B 端' : '普通 C 端' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="planStatusType(row.status)" size="small">{{ planStatusText(row.status) }}</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="330" fixed="right">
          <template #default="{ row }">
            <template v-if="editingPlan?.id === row.id">
              <el-button type="primary" size="small" :loading="savingPlan" @click="savePlan">保存</el-button>
              <el-button size="small" :disabled="savingPlan" @click="editingPlan = null">取消</el-button>
            </template>
            <template v-else-if="row.status !== 'archived'">
              <el-button size="small" :disabled="savingPlan" @click="startEdit(row)">编辑</el-button>
              <el-button size="small" :disabled="savingPlan || row.status !== 'disabled'" @click="openPlanPermissions(row)">产品权限</el-button>
              <el-button
                size="small"
                :type="row.status === 'active' ? 'danger' : 'success'"
                :disabled="savingPlan"
                @click="togglePlanStatus(row)"
              >
                {{ row.status === 'active' ? '禁用' : '启用' }}
              </el-button>
              <el-button size="small" type="warning" :disabled="savingPlan" @click="archivePlanStatus(row)">归档</el-button>
            </template>
            <span v-else class="terminal-state">终态，不可操作</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showAddPlan" title="新增旧版套餐" width="500px">
      <el-form label-width="80px">
        <el-form-item label="套餐名称">
          <el-input v-model="newPlan.name" placeholder="请输入套餐名称" />
        </el-form-item>
        <el-form-item label="价格">
          <el-input-number v-model="newPlan.price" :min="0.01" :step="0.01" :precision="2" style="width: 100%;" />
        </el-form-item>
        <el-form-item label="有效期">
          <el-input-number v-model="newPlan.duration_days" :min="1" :step="1" step-strictly style="width: 100%;" />
        </el-form-item>
        <el-form-item label="功能描述">
          <el-input v-model="newPlan.features" type="textarea" :rows="3" placeholder="请输入功能描述" />
        </el-form-item>
        <el-form-item label="产品类型">
          <el-select v-model="newPlan.product_type" style="width:100%">
            <el-option label="普通 C 端" value="consumer" />
            <el-option label="专业 B 端" value="business" />
          </el-select>
        </el-form-item>
        <template v-if="newPlan.product_type === 'business'">
          <div class="permission-assurance">演示最多 50 行逻辑并发；真实任务仅桌面端按顺序执行。保留现场数不代表同时运行数；原始表格、账号信息和 Cookie 不上传。</div>
          <el-form-item label="真实批次行数"><el-input-number v-model="newPlan.entitlements.max_batch_rows" :min="1" :max="1000" :step="1" step-strictly style="width:100%" /></el-form-item>
          <el-form-item label="保留现场数"><el-input-number v-model="newPlan.entitlements.max_open_sessions" :min="2" :max="10" :step="1" step-strictly style="width:100%" /></el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="showAddPlan = false">取消</el-button>
        <el-button type="primary" @click="addPlan">确认添加</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showPlanPermissions" title="旧版套餐产品与批量权限" width="520px">
      <el-form v-if="planPermissionDraft" label-position="top">
        <el-form-item label="产品类型">
          <el-radio-group v-model="planPermissionDraft.product_type">
            <el-radio-button value="consumer">普通 C 端</el-radio-button>
            <el-radio-button value="business">专业 B 端</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <template v-if="planPermissionDraft.product_type === 'business'">
          <div class="permission-assurance">演示固定最多 50 行逻辑并发。真实任务还需工具开放与桌面端支持，始终仅一个账号自动执行；等待人工操作时可保留多个现场。表格与凭据不上传。</div>
          <el-form-item label="批量工作台"><el-switch v-model="planPermissionDraft.batchEnabled" active-text="开放批次与多账号工作台" /></el-form-item>
          <div class="permission-grid">
            <el-form-item label="真实任务单批最大行数"><el-input-number v-model="planPermissionDraft.maxBatchRows" :min="1" :max="1000" :step="1" step-strictly /></el-form-item>
            <el-form-item label="真实任务保留现场数"><el-input-number v-model="planPermissionDraft.maxOpenSessions" :min="2" :max="10" :step="1" step-strictly /></el-form-item>
          </div>
          <el-form-item label="桌面通知"><el-switch v-model="planPermissionDraft.desktopNotification" active-text="批次状态变化时提醒" /></el-form-item>
        </template>
        <div v-else class="permission-assurance neutral">普通套餐不会获得批量工作台能力。</div>
      </el-form>
      <template #footer>
        <el-button @click="showPlanPermissions = false">取消</el-button>
        <el-button type="primary" @click="savePlanPermissions">保存权限</el-button>
      </template>
    </el-dialog>

    <el-dialog v-if="canEditProfitPolicy" v-model="showProfitModal" title="编辑旧版分润比例" width="500px">
      <div class="profit-total" :class="{ invalid: Math.abs(profitTotal - 100) > 0.001 }">
        当前总和：{{ profitTotal }}% {{ Math.abs(profitTotal - 100) > 0.001 ? '（必须为 100%）' : '✓' }}
      </div>
      <el-form label-width="60px">
        <el-form-item label="技术"><el-input-number v-model="profitRatios.tech" :min="0" :max="100" :step="0.01" style="width:100%" /></el-form-item>
        <el-form-item label="市场"><el-input-number v-model="profitRatios.market" :min="0" :max="100" :step="0.01" style="width:100%" /></el-form-item>
        <el-form-item label="产品"><el-input-number v-model="profitRatios.product" :min="0" :max="100" :step="0.01" style="width:100%" /></el-form-item>
        <el-form-item label="客服"><el-input-number v-model="profitRatios.service" :min="0" :max="100" :step="0.01" style="width:100%" /></el-form-item>
        <el-form-item label="统筹"><el-input-number v-model="profitRatios.coordination" :min="0" :max="100" :step="0.01" style="width:100%" /></el-form-item>
        <el-form-item label="记录"><el-input-number v-model="profitRatios.record" :min="0" :max="100" :step="0.01" style="width:100%" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showProfitModal = false">取消</el-button>
        <el-button type="primary" :disabled="Math.abs(profitTotal - 100) > 0.001" @click="saveProfitRatios">保存新版本</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAdminSettings } from '@/features/admin/useAdminSettings'
import PageHeader from '@/components/PageHeader.vue'

const router = useRouter()
const {
  plans,
  editingPlan,
  savingPlan,
  showAddPlan,
  showPlanPermissions,
  planPermissionDraft,
  wechatId,
  newPlan,
  canEditProfitPolicy,
  showProfitModal,
  profitRatios,
  profitTotal,
  profitRatiosText,
  saveWechat,
  startEdit,
  savePlan,
  openPlanPermissions,
  savePlanPermissions,
  togglePlanStatus,
  archivePlanStatus,
  addPlan,
  planStatusText,
  planStatusType,
  openProfitEdit,
  saveProfitRatios,
} = useAdminSettings()

function goChangePassword() {
  void router.push('/admin/change-password')
}
</script>

<style scoped>
.page-title { margin-bottom: 1.5rem; color: var(--color-text); font-family: var(--font-family); font-size: 26px; font-weight: 700; }
.settings-workflows { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; margin: 0 0 22px; color: var(--color-text-secondary); font-size: 14px; }
.settings-workflows :deep(.el-button + .el-button) { margin-left: 0; }
.settings-workflows :deep(.el-button) { min-height: 32px; }
.settings-card { margin-bottom: 1.5rem; border-radius: var(--radius-lg); background: var(--color-surface); }
.settings-card :deep(.el-card__header) { padding: 1rem 1.25rem; border-bottom: 1px solid var(--color-border); }
.card-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.card-header span { color: var(--color-text); font-size: 1rem; font-weight: 600; }
.header-hint { display: block; margin-top: 3px; color: var(--color-text-secondary); font-size: var(--type-meta); font-weight: 400; }
.setting-row { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 1rem; }
.setting-info { flex: 1; }
.setting-title { margin-bottom: .25rem; color: var(--color-text); font-weight: 600; }
.setting-desc, .feature-text, .terminal-state { color: var(--color-text-secondary); font-size: .85rem; }
.setting-control { display: flex; align-items: center; gap: .5rem; }
.lifecycle-notice { margin-bottom: 1rem; padding: .75rem .9rem; border-radius: 10px; color: var(--color-warning); background: var(--color-warning-soft, #fff7e6); font-size: .85rem; }
.profit-summary { color: var(--color-text-secondary); font-size: .9rem; line-height: 1.7; }
.profit-total { margin-bottom: .75rem; padding: .75rem; border-radius: 10px; color: var(--color-success); background: var(--color-canvas); font-size: .9rem; }
.profit-total.invalid { color: var(--color-danger); }
.permission-assurance { margin-bottom: 1rem; padding: .8rem .9rem; border-radius: 10px; color: var(--color-primary); background: var(--color-primary-soft); font-size: var(--type-meta); line-height: 1.6; }
.permission-assurance.neutral { color: var(--color-text-secondary); background: var(--color-canvas); }
.permission-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; }
.permission-grid :deep(.el-input-number) { width: 100%; }
:deep(.el-form-item) { margin-bottom: 0; padding: 1rem 0; border-bottom: 1px solid var(--color-border); }
:deep(.el-form-item:last-child) { border-bottom: none; }
:deep(.el-table) { --el-table-border-color: var(--color-border); --el-table-header-bg-color: var(--color-canvas); --el-table-row-hover-bg-color: var(--color-surface-soft); }
:deep(.el-dialog) { border-radius: var(--radius-lg); }
:deep(.el-dialog__header) { border-bottom: 1px solid var(--color-border); padding-bottom: 1rem; }
:deep(.el-dialog__footer) { border-top: 1px solid var(--color-border); padding-top: 1rem; }
@media (max-width: 700px) {
  .setting-row { align-items: stretch; flex-direction: column; }
  .setting-control { align-items: stretch; flex-direction: column; }
  .setting-control :deep(.el-input) { width: 100% !important; }
  .permission-grid { grid-template-columns: 1fr; }
}
</style>
