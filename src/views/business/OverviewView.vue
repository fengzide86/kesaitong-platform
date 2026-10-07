<template>
  <div class="business-overview">
    <PageHeader
      eyebrow="PROFESSIONAL OPERATIONS"
      title="专业批量工作台"
      :description="hasTools ? '查看真实工具目录和开放条件，准备自己的数据，跟进批次与待处理问题。' : '当前授权尚无开放的真实批量工具；可先查看准备项、授权与使用帮助。'"
    >
      <template #actions>
        <button class="secondary-link" type="button" @click="helpOpen = true">使用帮助</button>
        <router-link class="primary-link" to="/business/workspace"><ArrowRight :size="16" />查看工作台</router-link>
        <router-link class="secondary-link" to="/business/license">查看授权信息</router-link>
      </template>
    </PageHeader>
    <section class="attention-card" v-if="waitingCount">
      <div class="attention-icon"><BellRing :size="20" /></div>
      <div><strong>{{ waitingCount }} 个账号等待你操作</strong><p>批次仍在运行，请进入工作台查看需要处理的账号。</p></div>
      <router-link to="/business/workspace">去处理</router-link>
    </section>
    <section v-else-if="store.snapshot.recordKind === 'demo' && store.snapshot.status === 'completed'" class="completion-note" role="status">最近一次批量演示已结束。人工操作与异常案例是演示结果，不是待处理任务；可到记录中复盘。</section>
    <section class="capability-grid">
      <article><FileSpreadsheet :size="20" /><div><span>真实工具目录</span><strong>{{ customerToolCount }} 项目录能力</strong></div><small>本机当前 {{ usableToolCount }} 个可用批量工具；按脚本、授权和桌面能力判断</small></article>
      <article><PanelsTopLeft :size="20" /><div><span>批次与结果</span><strong>真实批次单独记录</strong></div><small>原表行号帮助核对；未完成不等于可直接重试</small></article>
      <article><ShieldCheck :size="20" /><div><span>随时求助</span><strong>导入前也能联系支持</strong></div><small>无工具、导入问题和执行记录均可从使用帮助提交工单</small></article>
    </section>
    <section class="surface recent">
      <header><div><span>最近真实批次</span><small>历史演示保留在记录页，不计入真实执行统计</small></div><router-link to="/business/records">全部记录</router-link></header>
      <AsyncStateNotice :state="historyState" :message="store.historyError || ''" loading-text="正在加载真实批次..." @retry="loadHistory" />
      <div v-if="(historyState === 'data' || historyState === 'stale') && store.history.length" class="batch-list">
        <article v-for="batch in store.history.slice(0, 5)" :key="batch.id">
          <div><strong>{{ batch.tool_name }}</strong><span>{{ formatDate(batch.started_at) }}</span></div>
          <span class="batch-count">{{ batch.completed_count + batch.failed_count }}/{{ batch.total_count }} 已结束</span>
          <span :class="['status', `is-${batch.status}`]">{{ batchStatus(batch.status) }}</span>
        </article>
      </div>
      <div v-else-if="historyState === 'empty'" class="empty">
        <span class="empty-icon"><Layers3 :size="24" /></span>
        <strong>还没有真实批次记录</strong>
        <p>开放工具完成真实批次后，结果会显示在这里；历史演示仍可在记录页查看。</p>
      </div>
    </section>
    <BusinessHelpDrawer v-model="helpOpen" entry-point="专业概览" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowRight, BellRing, FileSpreadsheet, Layers3, PanelsTopLeft, ShieldCheck } from '@lucide/vue'
import AsyncStateNotice from '@/components/AsyncStateNotice.vue'
import PageHeader from '@/components/PageHeader.vue'
import type { AsyncDataState } from '@/features/async/state'
import { useBusinessWorkspaceStore } from '@/stores/businessWorkspace'
import { activeInterventionCount } from '@/features/business/run-presentation'
import BusinessHelpDrawer from '@/features/business/BusinessHelpDrawer.vue'
import { isCustomerTool, isToolCurrentlyUsable } from '@/features/tools/presentation'
import { getRuntimeCapabilities } from '@/runtime/capabilities'
import { licensePlanCode, readStoredLicense } from '@/features/user/model'
const store = useBusinessWorkspaceStore()
const helpOpen = ref(false)
const runtime = getRuntimeCapabilities()
const waitingCount = computed(() => activeInterventionCount(store.snapshot))
const hasTools = computed(() => store.tools.some(isCustomerTool))
const customerToolCount = computed(() => store.tools.filter(isCustomerTool).length)
const usableToolCount = computed(() => {
  const license = readStoredLicense()
  return store.tools.filter(tool => isCustomerTool(tool) && isToolCurrentlyUsable(tool, { planCode: licensePlanCode(license), platformScope: license.platform_scope, platformKey: tool.platform_key || tool.platformKey, runtimeAvailable: runtime.batchLive, mode: 'batch' })).length
})
const historyState = computed<AsyncDataState>(() => {
  if (store.historyLoading) return 'loading'
  if (store.historyError) return store.history.length ? 'stale' : 'error'
  return store.history.length ? 'data' : 'empty'
})
const formatDate = (value: string | null | undefined): string => value
  ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '-'
const statusLabels: Record<string, string> = {
  created: '等待开始', running: '执行中', completed: '已完成', cancelled: '已结束', error: '执行异常', interrupted: '已中断',
}
const batchStatus = (value: string): string => statusLabels[value] || value
const loadHistory = (): void => { void store.loadHistory().catch(() => undefined) }
onMounted(loadHistory)
</script>

<style scoped>
.completion-note{padding:16px 18px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-success-soft);color:var(--color-success);font-size:var(--type-control);line-height:1.6}
.business-overview{display:grid;gap:20px}.page-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}.eyebrow{display:block;margin-bottom:8px;color:var(--color-primary);font-size:var(--type-micro);font-weight:800;letter-spacing:.12em}.title-line{display:flex;align-items:center;gap:12px}.title-line h1{margin:0;color:var(--color-text);font-size:var(--type-page);letter-spacing:-.04em}.title-line>span,.validation-badge{padding:6px 9px;border:1px solid rgba(169,133,82,.16);border-radius:8px;color:#765d38;background:var(--color-premium-soft);font-size:var(--type-micro);font-weight:800;white-space:nowrap}.page-header p{margin:9px 0 0;color:var(--color-text-secondary);font-size:var(--type-control);line-height:1.6}.page-actions{display:flex;align-items:center;gap:9px}.primary-link,.secondary-link{height:42px;display:flex;align-items:center;justify-content:center;gap:8px;padding:0 17px;border-radius:11px;text-decoration:none;font-size:var(--type-control);font-weight:700}.primary-link{color:#fff;background:var(--color-primary);box-shadow:0 8px 20px rgba(45,95,202,.18)}.secondary-link{border:1px solid var(--color-border);color:var(--color-text);background:var(--color-surface)}
.attention-card{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;padding:18px;border:1px solid rgba(183,121,31,.25);border-radius:15px;background:#fffaf0}.attention-icon{width:40px;height:40px;display:grid;place-items:center;border-radius:12px;color:var(--color-warning);background:#fff0d2}.attention-card strong{color:var(--color-text)}.attention-card p{margin:4px 0 0;color:var(--color-text-secondary);font-size:var(--type-meta)}.attention-card a{color:var(--color-warning);font-weight:700;text-decoration:none}
.capability-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.capability-grid article{min-height:142px;padding:19px;display:grid;grid-template-columns:auto 1fr;align-content:space-between;gap:13px;border:1px solid var(--color-border);border-radius:15px;background:var(--color-surface);box-shadow:var(--shadow-low)}.capability-grid svg{color:var(--color-primary)}.capability-grid div{display:grid;gap:5px}.capability-grid span,.capability-grid small{color:var(--color-text-tertiary);font-size:var(--type-meta)}.capability-grid strong{color:var(--color-text);font-size:15px}.capability-grid small{grid-column:1/-1;align-self:end}
.surface{border:1px solid var(--color-border);border-radius:16px;background:var(--color-surface);box-shadow:var(--shadow-low)}.recent>header{min-height:68px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;border-bottom:1px solid var(--color-border)}.recent header div{display:grid;gap:3px}.recent header span{font-size:var(--type-card);font-weight:700;color:var(--color-text)}.recent header small{font-size:var(--type-meta);color:var(--color-text-tertiary)}.recent header a{font-size:var(--type-meta);color:var(--color-primary);text-decoration:none}.batch-list article{min-height:64px;display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:18px;padding:0 20px;border-bottom:1px solid var(--color-border)}.batch-list article:last-child{border:0}.batch-list div{display:grid;gap:3px}.batch-list strong{font-size:var(--type-control);color:var(--color-text)}.batch-list div span,.batch-count{font-size:var(--type-meta);color:var(--color-text-tertiary)}.status{padding:5px 9px;border-radius:99px;font-size:var(--type-micro);font-weight:700;background:var(--color-surface-soft);color:var(--color-text-secondary)}.status.is-running{color:var(--color-primary);background:var(--color-primary-soft)}.status.is-completed{color:var(--color-success);background:#eaf8f2}.empty{min-height:190px;display:grid;place-content:center;justify-items:center;gap:8px;padding:34px 20px;text-align:center}.empty-icon{width:48px;height:48px;display:grid;place-items:center;border-radius:15px;color:var(--color-primary);background:var(--color-primary-soft)}.empty strong{color:var(--color-text);font-size:var(--type-card)}.empty p{margin:0;color:var(--color-text-secondary);font-size:var(--type-control)}
@media(max-width:760px){.page-header{display:grid}.page-actions{display:grid;grid-template-columns:1fr 1fr}.capability-grid{grid-template-columns:1fr}.batch-list article{grid-template-columns:1fr auto}.batch-count{display:none}.title-line{align-items:flex-start;flex-direction:column}}
</style>
