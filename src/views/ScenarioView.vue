<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, ChevronRight } from '@lucide/vue'
import { RouterLink, useRoute } from 'vue-router'
import MarketingShell from '@/components/landing/MarketingShell.vue'
import MetricComparison from '@/components/landing/MetricComparison.vue'
import MarketingCaseResults from '@/components/landing/MarketingCaseResults.vue'
import { reportedTimeMetrics } from '@/marketing/impact-data'
import ScenarioPainComparison, { type ScenarioKind } from '@/components/landing/ScenarioPainComparison.vue'

const props = defineProps<{ kind?: ScenarioKind }>()
const route = useRoute()
const kind = computed<ScenarioKind>(() => props.kind ?? (route.path.includes('course') ? 'course' : 'competition'))
const isCompetition = computed(() => kind.value === 'competition')
</script>

<template>
  <MarketingShell :show-download="false">
    <main class="scenario-page" data-route-focus>
      <div class="scenario-context">
        <nav aria-label="当前位置"><RouterLink to="/">首页</RouterLink><ChevronRight :size="14" aria-hidden="true" /><span>{{ isCompetition ? '比赛备赛' : '课程实训' }}</span></nav>
        <RouterLink :to="isCompetition ? '/course' : '/competition'">{{ isCompetition ? '看看课程实训' : '看看比赛备赛' }}<ArrowRight :size="15" aria-hidden="true" /></RouterLink>
      </div>

      <ScenarioPainComparison :key="kind" :kind="kind">
        <template #results>
          <MetricComparison :metrics="reportedTimeMetrics" :title="isCompetition ? '这些操作，用时差多少？' : '相同的实训任务，用时差多少？'" intro="看看商品发布、物流模板与订单发货的使用前后案例。" />
          <MarketingCaseResults :kind="kind" />
        </template>
      </ScenarioPainComparison>

      <section class="scenario-next">
        <div>
          <p class="scenario-next-eyebrow">看看课赛通怎么帮</p>
          <h2>{{ isCompetition ? '少忙重复操作，多花时间判断。' : '少做重复配置，多试几种想法。' }}</h2>
          <p>{{ isCompetition ? '确定要做什么后，选择对应工具处理重复部分，把精力留给选品、策略和取舍。' : '把已经想好的商品、物流和活动方案准备好，再用对应工具减少反复填写。' }}</p>
        </div>
        <RouterLink to="/tools">查看工具介绍 <ArrowRight :size="18" aria-hidden="true" /></RouterLink>
      </section>
    </main>
  </MarketingShell>
</template>

<style scoped>
.scenario-page { color: var(--m-ink); background: #fff; }
.scenario-context, .scenario-next { width: min(var(--m-width), calc(100% - var(--m-gutter) * 2)); margin-inline: auto; box-sizing: border-box; }
.scenario-context { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-top: 20px; font-size: 14px; }
.scenario-context nav, .scenario-context > a { display: flex; align-items: center; gap: 9px; }
.scenario-context nav { color: var(--m-muted); }
.scenario-context a { display: inline-flex; align-items: center; min-height: 44px; color: var(--m-muted); text-decoration: none; transition: color var(--m-duration); }
.scenario-context > a { color: var(--m-blue); }
.scenario-context a:hover { color: var(--m-blue-hover); }
.scenario-context a:focus-visible, .scenario-next a:focus-visible { outline: 3px solid var(--m-blue); outline-offset: 5px; }
.scenario-next { display: flex; align-items: center; justify-content: space-between; gap: 32px; padding-block: 44px var(--m-section); border-top: 1px solid var(--m-border); }
.scenario-next .scenario-next-eyebrow { margin: 0 0 14px; color: var(--m-blue); font-size: 14px; font-weight: 650; }
.scenario-next h2 { max-width: 770px; margin: 0; font-size: var(--m-h2); line-height: 1.4; letter-spacing: 0; text-wrap: balance; }
.scenario-next p { max-width: 730px; margin: 18px 0 0; color: var(--m-text); font-size: var(--m-body); line-height: 1.8; }
.scenario-next > a { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 14px; min-height: 48px; padding: 14px 22px; border-radius: 10px; color: #fff; background: var(--m-blue); font-size: 15px; font-weight: 650; text-decoration: none; transition: background var(--m-duration), transform var(--m-duration); }
.scenario-next > a:hover { background: var(--m-blue-hover); transform: translateY(-2px); }
@media (max-width: 820px) {
  .scenario-next { align-items: flex-start; flex-direction: column; gap: 26px; }
}
@media (max-width: 480px) {
  .scenario-context { gap: 8px; padding-top: 12px; font-size: 13px; }
  .scenario-context nav, .scenario-context > a { gap: 5px; }
  .scenario-next { padding-top: 32px; }
  .scenario-next > a { width: 100%; box-sizing: border-box; }
}
@media (prefers-reduced-motion: reduce) { .scenario-context a, .scenario-next > a { transition: none; }.scenario-next > a:hover { transform: none; } }
</style>
