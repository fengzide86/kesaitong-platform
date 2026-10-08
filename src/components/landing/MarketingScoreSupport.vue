<script setup lang="ts">
import { computed, getCurrentInstance } from 'vue'
import { ArrowRight } from '@lucide/vue'
import { RouterLink } from 'vue-router'

const props = defineProps<{ kind?: 'course' | 'competition' }>()
const headingId = `score-support-${getCurrentInstance()?.uid ?? 0}`

const copy = computed(() => {
  if (props.kind === 'competition') {
    return {
      title: '时间有限，得分细节还在反复试？',
      intro: '隐性得分点要摸清，配置还要反复试。比赛时间，就这样一点点被占掉。',
    }
  }
  if (props.kind === 'course') {
    return {
      title: '按要求交完作业，评分细节还是漏了？',
      intro: '页面要求之外的评分细节容易漏。改一遍、再试一遍，又把练习时间花在相同配置上。',
    }
  }
  return {
    title: '把得分细节，放进一键配置。',
    intro: '页面要求之外的评分细节，工具也帮你照顾到。少靠反复试，把时间留给选品和策略。',
  }
})

const manualSteps = ['看页面要求', '逐项填写', '修改重试']
const assistedSteps = ['已整理的得分细节', '对应工具一键配置', '继续完善选品与策略']
</script>

<template>
  <section class="marketing-score-support" :class="{ 'is-scenario': kind }" data-testid="marketing-score-support" :data-scenario="kind || 'all'" :aria-labelledby="headingId">
    <header class="score-support-heading">
      <p class="score-support-eyebrow">不只是省时间</p>
      <h2 :id="headingId"><template v-if="!kind"><span>把得分细节，</span><span>放进一键配置。</span></template><template v-else>{{ copy.title }}</template></h2>
      <p class="score-support-intro">{{ copy.intro }}</p>
    </header>

    <div class="score-support-comparison">
      <article class="score-support-panel score-support-manual">
        <p class="score-support-panel-label">自己反复试配置</p>
        <h3>对着要求改一遍，再试一遍</h3>
        <ol class="score-support-steps">
          <li v-for="(step, index) in manualSteps" :key="step">
            <span class="score-support-step-number" aria-hidden="true">{{ index + 1 }}</span>
            <span>{{ step }}</span>
          </li>
        </ol>
      </article>

      <article class="score-support-panel score-support-assisted">
        <p class="score-support-panel-label">课赛通辅助</p>
        <h3>一键套用已整理的得分配置</h3>
        <ol class="score-support-steps">
          <li v-for="(step, index) in assistedSteps" :key="step">
            <span class="score-support-step-number" aria-hidden="true">{{ index + 1 }}</span>
            <span>{{ step }}</span>
          </li>
        </ol>
      </article>
    </div>

    <div class="score-support-footer">
      <p>把摸索过的得分细节，<br class="score-support-mobile-break">放进对应任务的一键配置里。</p>
      <RouterLink to="/tools">看看哪些任务支持一键处理 <ArrowRight :size="18" aria-hidden="true" /></RouterLink>
    </div>
  </section>
</template>

<style scoped>
.marketing-score-support {
  width: min(var(--m-width, 1160px), calc(100% - var(--m-gutter, 32px) * 2));
  box-sizing: border-box;
  margin: var(--m-section, 88px) auto 0;
  color: var(--m-ink, #142b47);
}
.marketing-score-support.is-scenario { width: 100%; }
.score-support-heading { max-width: 820px; }
.score-support-eyebrow { margin: 0 0 12px; color: var(--m-blue, #245eea); font-size: 14px; font-weight: 750; }
.score-support-heading h2 { margin: 0; font-size: var(--m-h2, 40px); line-height: 1.3; letter-spacing: 0; text-wrap: balance; }
.score-support-heading h2 > span { display: inline-block; }
.score-support-intro { max-width: 720px; margin: 16px 0 0; color: var(--m-text, #46556a); font-size: var(--m-body, 16px); line-height: 1.8; }
.score-support-comparison { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; margin-top: 32px; }
.score-support-panel { min-width: 0; padding: 30px 32px; border-radius: var(--m-radius, 16px); }
.score-support-manual { background: var(--m-surface, #f5f7fa); }
.score-support-assisted { background: var(--m-blue-soft, #eff4ff); }
.score-support-panel-label { margin: 0; color: var(--m-muted, #627084); font-size: 14px; font-weight: 650; }
.score-support-assisted .score-support-panel-label { color: var(--m-blue, #245eea); }
.score-support-panel h3 { margin: 12px 0 0; font-size: 23px; line-height: 1.45; letter-spacing: 0; text-wrap: balance; }
.score-support-manual h3 { color: var(--m-orange, #a65316); }
.score-support-steps { display: grid; gap: 16px; padding: 0; margin: 28px 0 0; list-style: none; }
.score-support-steps li { display: flex; align-items: center; gap: 14px; min-height: 40px; color: var(--m-text, #46556a); font-size: var(--m-body, 16px); line-height: 1.5; }
.score-support-step-number { display: inline-flex; flex: 0 0 32px; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; color: var(--m-muted, #627084); background: #e7ebf1; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
.score-support-assisted .score-support-step-number { color: #fff; background: var(--m-blue, #245eea); }
.score-support-assisted .score-support-steps li:nth-child(2) { color: var(--m-ink, #142b47); font-weight: 750; }
.score-support-footer { display: flex; align-items: center; justify-content: space-between; gap: 28px; margin-top: 24px; }
.score-support-footer p { margin: 0; font-size: var(--m-body, 16px); font-weight: 650; line-height: 1.75; }
.score-support-footer a { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 10px; min-height: 44px; color: var(--m-blue, #245eea); font-size: 15px; font-weight: 650; text-decoration: none; transition: color var(--m-duration, 180ms); }
.score-support-footer a:hover { color: var(--m-blue-hover, #164ac4); }
.score-support-footer a:focus-visible { outline: 3px solid var(--m-blue, #245eea); outline-offset: 4px; }
.score-support-mobile-break { display: none; }
@media (max-width: 900px) {
  .score-support-comparison { gap: 18px; }
  .score-support-panel { padding: 26px 24px; }
  .score-support-panel h3 { font-size: 21px; }
  .score-support-footer { align-items: flex-start; flex-direction: column; gap: 10px; }
}
@media (max-width: 600px) {
  .marketing-score-support { width: min(var(--m-width, 1160px), calc(100% - var(--m-gutter, 20px) * 2)); }
  .marketing-score-support.is-scenario { width: 100%; }
  .score-support-comparison { grid-template-columns: 1fr; gap: 14px; margin-top: 26px; }
  .score-support-panel { padding: 24px; }
  .score-support-steps { gap: 12px; margin-top: 20px; }
  .score-support-panel h3 { font-size: 21px; }
  .score-support-steps li { min-height: 36px; font-size: 15px; }
  .score-support-footer { margin-top: 20px; }
  .score-support-footer p { font-size: 15px; }
  .score-support-mobile-break { display: initial; }
}
@media (prefers-reduced-motion: reduce) { .score-support-footer a { transition: none; } }
</style>
