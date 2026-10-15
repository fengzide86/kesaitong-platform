<script setup lang="ts">
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref } from 'vue'
import type { EvidenceMetric } from '@/marketing/metric-evidence'

const props = defineProps<{
  metrics: EvidenceMetric[]
  title?: string
  intro?: string
}>()

const componentId = `metric-comparison-${getCurrentInstance()?.uid ?? 0}`
const resultGrid = ref<HTMLElement | null>(null)
const animatedMetrics = ref(new Set<number>())
let visibilityObserver: IntersectionObserver | undefined

function isValue(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isDate(value: string | null): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || month > 12 || !day) return false
  const leapYear = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0)
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= (days[month - 1] ?? 0)
}

function hasSampleSize(metric: EvidenceMetric): boolean {
  return typeof metric.sampleSize === 'number' && Number.isSafeInteger(metric.sampleSize) && metric.sampleSize > 0
}

function taskScope(metric: EvidenceMetric): string {
  return typeof metric.taskScope === 'string' ? metric.taskScope.trim() : ''
}

const visibleMetrics = computed(() => props.metrics.flatMap(metric => {
  // Pending figures are not evidence. An unpaired record can only expose its
  // valid manual baseline, never an unverified assisted value or change.
  if (!['manual', 'measured', 'reported'].includes(metric.source) || !isValue(metric.before)) return []
  const paired = metric.source === 'measured'
    && isValue(metric.after)
    && hasSampleSize(metric)
    && isDate(metric.measuredAt)
    && taskScope(metric).length > 0
  // A reported case is visible with its explicit source, but never acquires
  // measured status or fabricated sample/date metadata.
  const reported = metric.source === 'reported' && isValue(metric.after) && taskScope(metric).length > 0
  return [{ ...metric, after: paired || reported ? metric.after : null, paired, reported }]
}))

const hasReportedMetrics = computed(() => visibleMetrics.value.some(metric => metric.source === 'reported'))
const provenanceMetrics = computed(() => visibleMetrics.value.filter(metric => metric.source !== 'reported'))

function maxValue(metric: EvidenceMetric): number {
  // A shared scale makes different tasks comparable. Only gated, visible
  // values may influence the scale, never an unpublished assisted figure.
  return Math.max(1, ...visibleMetrics.value
    .filter(candidate => candidate.metric === metric.metric && candidate.unit === metric.unit)
    .flatMap(candidate => [candidate.before ?? 0, candidate.after ?? 0]))
}

function width(metric: EvidenceMetric, value: number | null): string {
  if (value === null) return '0%'
  return `${Math.round((value / maxValue(metric)) * 100)}%`
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1)
}

function delta(metric: EvidenceMetric & { paired: boolean; reported: boolean }): string | null {
  if ((!metric.paired && !metric.reported) || metric.before === null || metric.after === null) return null
  const change = metric.after - metric.before
  return `${change > 0 ? '+' : ''}${formatNumber(change)}${metric.unit}`
}

function savedTime(metric: EvidenceMetric & { paired: boolean; reported: boolean }): number | null {
  if (metric.metric !== 'time' || (!metric.paired && !metric.reported) || metric.before === null || metric.after === null || metric.after >= metric.before) return null
  return metric.before - metric.after
}

onMounted(() => {
  // The bars are fully visible by default. Unsupported browsers and reduced
  // motion users receive the complete result without waiting for JavaScript.
  if (!resultGrid.value || typeof IntersectionObserver !== 'function') return
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  visibilityObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue
      const index = Number((entry.target as HTMLElement).dataset.metricIndex)
      if (!Number.isInteger(index) || animatedMetrics.value.has(index)) continue
      animatedMetrics.value.add(index)
      visibilityObserver?.unobserve(entry.target)
    }
  }, { threshold: 0.5 })
  // Observe each chart rather than the whole grid. On a stacked mobile layout,
  // later cards must not finish animating before their bars reach the viewport.
  resultGrid.value.querySelectorAll<HTMLElement>('[data-metric-index]').forEach(chart => {
    visibilityObserver?.observe(chart)
  })
})

onBeforeUnmount(() => visibilityObserver?.disconnect())
</script>

<template>
  <section v-if="visibleMetrics.length" class="metric-comparison" data-testid="metric-comparison" :aria-labelledby="`${componentId}-title`">
    <header class="metric-comparison-heading">
      <div>
        <p class="metric-eyebrow">操作时间对比</p>
        <h2 :id="`${componentId}-title`">{{ title || '同样的任务，少花多少时间？' }}</h2>
        <p>{{ intro || '看看自己操作与课赛通辅助的用时差别。' }}</p>
      </div>
      <span v-if="hasReportedMetrics" class="metric-badge">用户提供案例</span>
    </header>

    <div ref="resultGrid" class="metric-grid">
      <article v-for="(metric, index) in visibleMetrics" :key="`${metric.metric}-${index}`" class="metric-card" :class="{ 'metric-bars-animate': animatedMetrics.has(index) }" :data-metric="metric.metric" data-testid="metric-result" :aria-labelledby="`${componentId}-task-${index}`">
        <div class="metric-card-head"><strong :id="`${componentId}-task-${index}`">{{ taskScope(metric) || (metric.metric === 'time' ? '操作用时' : '任务得分') }}</strong><span v-if="metric.source !== 'reported'">{{ metric.paired ? '已实测' : '人工基线' }}</span></div>
        <div class="metric-value-row">
          <div class="metric-before"><small>{{ metric.metric === 'time' ? '自己操作' : '使用前' }}</small><b data-testid="before-number">{{ formatNumber(metric.before!) }}<span>{{ metric.unit }}</span></b></div>
          <div class="metric-arrow" aria-hidden="true">→</div>
          <div class="metric-after"><small>课赛通辅助{{ metric.metric === 'score' ? '后' : '' }}</small><b v-if="metric.after !== null" data-testid="after-number">{{ formatNumber(metric.after) }}<span>{{ metric.unit }}</span></b><b v-else class="metric-awaiting">辅助数据暂未公开</b></div>
        </div>
        <div class="metric-bars" :data-metric-index="index" aria-hidden="true"><div class="metric-bar-row"><span>{{ metric.metric === 'time' ? '自己操作' : '使用前' }}</span><i><em :style="{ width: width(metric, metric.before) }" /></i></div><div class="metric-bar-row metric-bar-row-after"><span>课赛通辅助</span><i><em :style="{ width: width(metric, metric.after) }" /></i></div></div>
        <div v-if="savedTime(metric) !== null" class="metric-saving"><span>少花</span><strong data-testid="delta-number">{{ formatNumber(savedTime(metric)!) }}</strong><span>分钟</span></div>
        <p v-if="delta(metric) && !metric.reported" class="metric-delta">变化 {{ delta(metric) }}</p>
        <p v-else-if="delta(metric) && savedTime(metric) === null" class="metric-delta">本案例变化 {{ delta(metric) }}</p>
        <p v-else-if="!delta(metric)" class="metric-delta metric-pending">仅展示人工基线</p>
      </article>
    </div>

    <footer class="metric-provenance">
      <p v-if="hasReportedMetrics" class="metric-source">来源：用户提供案例。实际用时因任务和操作方式而异。</p>
      <details v-if="provenanceMetrics.length" class="metric-source-details">
        <summary>查看计时来源</summary>
        <p v-for="(metric, index) in provenanceMetrics" :key="`${metric.metric}-${index}`" class="metric-source" data-testid="metric-provenance">
          <template v-if="taskScope(metric) && hasSampleSize(metric) && isDate(metric.measuredAt)">
            {{ taskScope(metric) }} · 样本 {{ metric.sampleSize }} · {{ metric.measuredAt }} ·
          </template>
          {{ metric.paired ? '数据来自配对实测' : '仅展示人工基线，尚无完整配对实测' }}
        </p>
      </details>
    </footer>
  </section>
</template>

<style scoped>
.metric-comparison { margin-top: 52px; padding: 36px 32px; border-radius: var(--m-radius, 16px); background: var(--m-blue-soft, #eff4ff); color: var(--m-ink, #142b47); }
.metric-comparison-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.metric-eyebrow { margin: 0; color: var(--m-blue, #245eea); font-size: 14px; font-weight: 750; }
.metric-comparison h2 { margin: 10px 0 0; font-size: clamp(28px, 3.4vw, 40px); line-height: 1.3; letter-spacing: 0; text-wrap: balance; }
.metric-comparison-heading p:not(.metric-eyebrow) { max-width: 620px; margin: 12px 0 0; color: var(--m-ink, #142b47); font-size: 16px; line-height: 1.7; }
.metric-badge { flex-shrink: 0; padding: 8px 12px; border-radius: 99px; color: var(--m-muted, #627084); background: #fff; font-size: 13px; }
.metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 28px; }
.metric-card { min-width: 0; padding: 24px 20px; border-radius: 14px; background: #fff; }
.metric-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; color: var(--m-ink, #142b47); font-size: 16px; line-height: 1.5; }
.metric-card-head span { color: var(--m-muted, #627084); font-size: 13px; font-weight: 500; }
.metric-value-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: end; gap: 8px; margin-top: 20px; }
.metric-value-row small { display: block; color: var(--m-ink, #142b47); font-size: 16px; line-height: 1.5; }
.metric-value-row b { display: flex; align-items: baseline; gap: 3px; margin-top: 6px; color: var(--m-ink, #142b47); font-size: clamp(44px, 4.2vw, 58px); line-height: 1.05; font-weight: 750; font-variant-numeric: tabular-nums; letter-spacing: -0.035em; }
.metric-value-row b span { font-size: 15px; font-weight: 600; letter-spacing: 0; }
.metric-before b { color: var(--m-muted, #627084); }
.metric-after b { color: var(--m-blue, #245eea); }
.metric-value-row .metric-awaiting { font-size: 25px; letter-spacing: 0; }
.metric-arrow { padding-bottom: 13px; color: var(--m-muted, #627084); font-size: 23px; }
.metric-bars { display: grid; gap: 9px; margin-top: 22px; }
.metric-bar-row { display: grid; grid-template-columns: 78px minmax(0, 1fr); align-items: center; gap: 8px; color: var(--m-ink, #142b47); font-size: 13px; line-height: 1.5; }
.metric-bar-row i { display: block; height: 8px; overflow: hidden; border-radius: 99px; background: var(--m-surface, #f5f7fa); }
.metric-bar-row em { display: block; height: 100%; border-radius: 99px; background: var(--m-data-before, #66758a); transform-origin: left center; }
.metric-bar-row-after em { background: var(--m-blue, #245eea); }
.metric-bars-animate .metric-bar-row em { animation: metric-bar-enter 1400ms cubic-bezier(.2, .7, .2, 1) both; }
.metric-bars-animate .metric-bar-row-after em { animation-delay: 180ms; }
.metric-saving { display: flex; align-items: baseline; gap: 6px; margin-top: 22px; color: var(--m-orange, #a65316); font-size: 16px; font-weight: 650; }
.metric-saving strong { font-size: 34px; line-height: 1; font-variant-numeric: tabular-nums; font-weight: 750; }
.metric-delta { margin: 14px 0 0; color: var(--m-orange, #a65316); font-size: 14px; }
.metric-pending { color: var(--m-muted, #627084); }
.metric-provenance { margin-top: 20px; }
.metric-source { margin: 0; color: var(--m-muted, #627084); font-size: 14px; line-height: 1.7; }
.metric-source-details { margin-top: 12px; color: var(--m-ink, #142b47); font-size: 15px; }
.metric-source-details summary { width: fit-content; padding-block: 6px; cursor: pointer; }
.metric-source-details summary:focus-visible { outline: 3px solid var(--m-blue, #245eea); outline-offset: 4px; }
.metric-source-details .metric-source { margin-top: 8px; }
@keyframes metric-bar-enter { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@media (max-width: 900px) {
  .metric-comparison { padding: 28px 24px; }
  .metric-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .metric-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 20px; padding: 20px 24px; }
  .metric-card-head, .metric-value-row, .metric-delta { grid-column: 1 / -1; }
  .metric-value-row { margin-top: 12px; gap: 20px; }
  .metric-value-row b { font-size: 52px; }
  .metric-bars { grid-column: 1; align-self: center; margin-top: 16px; }
  .metric-saving { grid-column: 2; grid-row: 3; align-self: center; margin-top: 16px; }
  .metric-bar-row { grid-template-columns: 78px minmax(0, 1fr); }
}
@media (max-width: 600px) {
  .metric-comparison { margin-top: 32px; padding: 22px 18px; }
  .metric-comparison-heading { display: block; }
  .metric-comparison-heading p:not(.metric-eyebrow) { font-size: 15px; }
  .metric-badge { display: inline-block; margin-top: 12px; }
  .metric-grid { margin-top: 18px; }
  .metric-card { column-gap: 16px; padding: 16px; }
  .metric-card-head { font-size: 15px; gap: 8px; }
  .metric-card-head span { flex-shrink: 0; }
  .metric-value-row { gap: 12px; }
  .metric-value-row small { font-size: 15px; }
  .metric-value-row b { font-size: 44px; }
  .metric-value-row .metric-awaiting { font-size: 24px; }
  .metric-arrow { padding-bottom: 10px; font-size: 21px; }
  .metric-bars, .metric-saving { margin-top: 14px; }
  .metric-bar-row { grid-template-columns: minmax(0, 1fr); }
  .metric-bar-row > span { display: none; }
  .metric-saving { gap: 4px; font-size: 15px; }
  .metric-saving strong { font-size: 30px; }
  .metric-source { font-size: 14px; }
  .metric-provenance { margin-top: 16px; }
}
@media (prefers-reduced-motion: reduce) { .metric-bars-animate .metric-bar-row em { animation: none; } }
</style>
