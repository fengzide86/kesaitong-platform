<script setup lang="ts">
import { computed, getCurrentInstance } from 'vue'
import { ArrowRight, Trophy } from '@lucide/vue'
import { reportedOutcomeCases, type CaseOutcome } from '@/marketing/impact-data'

const props = defineProps<{ kind?: 'course' | 'competition' }>()
const cases = computed(() => reportedOutcomeCases.filter(item => !props.kind || item.id === props.kind))
const headingId = `case-results-${getCurrentInstance()?.uid ?? 0}`

function scoreChange(item: CaseOutcome): number | null {
  return typeof item.after.value === 'number' ? item.after.value - item.before.value : null
}

function scoreWidth(item: CaseOutcome, value: number): string {
  const max = Math.max(item.before.value, typeof item.after.value === 'number' ? item.after.value : 0, 1)
  return `${value / max * 100}%`
}
</script>

<template>
  <section class="case-results" data-testid="marketing-case-results" :aria-labelledby="headingId">
    <header class="case-heading">
      <p class="case-eyebrow">使用者的经历</p>
      <h2 :id="headingId">{{ kind === 'course' ? '实训成绩：从21分到90分。' : kind === 'competition' ? '从及格，到全国一等奖。' : '实训与比赛，看看这些变化。' }}</h2>
    </header>

    <div class="case-grid" :class="{ 'single-case': cases.length === 1 }">
      <article v-for="item in cases" :key="item.id" class="case-card" :class="`case-${item.id}`" :data-case-id="item.id">
        <div class="case-card-heading">
          <h3>{{ item.title }}</h3>
          <span class="case-source-label">用户提供案例</span>
        </div>
        <div class="case-value-row">
          <div class="case-before">
            <p>{{ item.before.label }}</p>
            <strong>{{ item.before.value }}<span>{{ item.before.unit }}</span></strong>
          </div>
          <ArrowRight class="case-arrow" :size="26" aria-hidden="true" />
          <div class="case-after">
            <p>{{ item.after.label }}</p>
            <strong v-if="typeof item.after.value === 'number'">{{ item.after.value }}<span>{{ item.after.unit }}</span></strong>
            <div v-else class="case-award"><span>全国</span><strong>一等奖</strong></div>
          </div>
        </div>

        <template v-if="typeof item.after.value === 'number'">
          <div class="case-score-bars" aria-hidden="true">
            <div><span>使用前</span><i><em :style="{ width: scoreWidth(item, item.before.value) }" /></i></div>
            <div><span>使用后</span><i><em :style="{ width: scoreWidth(item, item.after.value) }" /></i></div>
          </div>
          <p class="case-difference">本案例成绩变化 <strong>{{ scoreChange(item)! > 0 ? '+' : '' }}{{ scoreChange(item) }}<span>分</span></strong></p>
        </template>
        <p v-else class="case-award-caption"><Trophy :size="24" aria-hidden="true" /><span>从及格起步，到全国一等奖的比赛经历</span></p>
      </article>
    </div>
    <p class="case-note">来源：用户提供的使用前后案例。成绩变化与比赛结果受练习、策略及评分规则影响。</p>
  </section>
</template>

<style scoped>
.case-results { padding-block: var(--m-section); color: var(--m-ink); }
.case-eyebrow { margin: 0; color: var(--m-blue); font-size: 14px; font-weight: 700; }
.case-heading h2 { margin: 14px 0 0; font-size: var(--m-h2); line-height: 1.4; text-wrap: balance; }
.case-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; margin-top: 32px; }
.case-grid.single-case { grid-template-columns: 1fr; }
.case-card { display: flex; flex-direction: column; min-width: 0; padding: 32px; border-radius: var(--m-radius); background: var(--m-surface); }
.case-card-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.case-card-heading h3 { margin: 0; font-size: 18px; line-height: 1.5; }
.case-source-label { color: var(--m-muted); font-size: 13px; line-height: 1.6; }
.case-value-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1.15fr); align-items: end; gap: 14px; margin-top: 34px; }
.case-value-row p { margin: 0 0 12px; color: var(--m-text); font-size: 15px; line-height: 1.6; }
.case-value-row strong { display: flex; align-items: baseline; gap: 6px; color: var(--m-ink); font-size: clamp(56px, 5.6vw, 76px); line-height: 1.05; font-weight: 750; font-variant-numeric: tabular-nums; }
.case-value-row strong span { font-size: 18px; font-weight: 600; }
.case-after strong { color: var(--m-blue); }
.case-arrow { margin-bottom: 20px; color: var(--m-muted); }
.case-score-bars { display: grid; gap: 11px; margin-top: 28px; }
.case-score-bars > div { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: center; gap: 12px; color: var(--m-text); font-size: 13px; }
.case-score-bars i { display: block; height: 10px; border-radius: 99px; background: #e2e7ef; overflow: hidden; }
.case-score-bars em { display: block; height: 100%; border-radius: 99px; background: #8997a8; }
.case-score-bars > div:last-child em { background: var(--m-blue); }
.case-difference { display: flex; align-items: baseline; gap: 14px; margin: 26px 0 0; color: var(--m-text); font-size: 14px; }
.case-difference strong { color: var(--m-orange); font-size: 44px; font-weight: 750; line-height: 1.2; }
.case-difference strong span { margin-left: 6px; font-size: 17px; }
.case-competition { background: var(--m-ink); color: #fff; }
.case-competition .case-source-label, .case-competition .case-value-row p { color: #c2d0e2; }
.case-competition .case-before strong { color: #fff; }
.case-competition .case-arrow { color: #c2d0e2; }
.case-award > span { display: block; color: #ffd3a6; font-size: 18px; line-height: 1.5; }
.case-award strong { margin-top: 4px; color: #ffd3a6; font-size: clamp(32px, 3.4vw, 46px); white-space: nowrap; line-height: 1.25; }
.case-award-caption { display: flex; align-items: center; gap: 12px; margin: auto 0 0; padding-top: 36px; color: #d9e3f1; font-size: 15px; line-height: 1.8; }
.case-award-caption svg { flex-shrink: 0; color: #ffd3a6; }
.case-note { margin: 20px 0 0; color: var(--m-muted); font-size: 14px; line-height: 1.8; }
.single-case .case-value-row { max-width: 700px; }
.single-case .case-value-row strong { font-size: 88px; }
.single-case .case-award strong { font-size: 54px; }
.single-case .case-score-bars { max-width: 720px; }
@media (max-width: 900px) { .case-card { padding: 26px 24px; } .case-card-heading { flex-wrap: wrap; gap: 8px; } .case-value-row { gap: 10px; } .case-value-row strong { font-size: 58px; } .case-award strong { font-size: 34px; } }
@media (max-width: 700px) { .case-grid { grid-template-columns: 1fr; gap: 16px; } .case-card-heading { flex-wrap: nowrap; } .case-value-row { margin-top: 28px; } .case-award-caption { padding-top: 30px; } }
@media (max-width: 480px) { .case-grid { margin-top: 26px; } .case-card { padding: 26px 22px; } .case-value-row strong, .single-case .case-value-row strong { font-size: 58px; } .case-value-row strong span { font-size: 16px; } .case-award strong, .single-case .case-award strong { font-size: 34px; } .case-source-label { font-size: 13px; } .case-value-row p { font-size: 14px; } .case-arrow { width: 22px; margin-bottom: 14px; } .case-difference { gap: 12px; } .case-difference strong { font-size: 42px; } }
</style>
