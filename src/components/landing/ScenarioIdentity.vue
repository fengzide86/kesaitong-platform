<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import amazonSimulationIcon from '@/assets/website/amazon-simulation-icon.png'
import contestCard from '@/assets/website/contest-crossborder-2026-4x.png'

type ScenarioKind = 'course' | 'competition'

const props = withDefaults(defineProps<{ kind: ScenarioKind; compact?: boolean }>(), { compact: false })
const imageFailed = ref(false)
watch(() => props.kind, () => { imageFailed.value = false })
const content = computed(() => props.kind === 'course'
  ? {
      label: '实训平台',
      title: '亚马逊仿真实训',
      description: '商品、物流、广告与发货练习',
      src: amazonSimulationIcon,
      alt: '亚马逊仿真实训图标',
    }
  : {
      label: '比赛赛项',
      title: '第九届全国数字贸易技能大赛',
      description: '跨境电商数字化运营',
      src: contestCard,
      alt: '第九届全国数字贸易技能大赛跨境电商数字化运营赛项官方卡片',
    })
</script>

<template>
  <div class="scenario-identity" :class="[{ compact }, `identity-${kind}`]" data-testid="scenario-identity">
    <div v-if="!imageFailed" class="scenario-identity-media" :class="`scenario-identity-${kind}`">
      <img :src="content.src" :alt="content.alt" :width="kind === 'course' ? 107 : 960" :height="kind === 'course' ? 108 : 704" :loading="compact ? 'lazy' : 'eager'" @error="imageFailed = true" />
    </div>
    <div class="scenario-identity-copy">
      <span>{{ content.label }}</span>
      <strong>{{ content.title }}</strong>
      <small>{{ content.description }}</small>
      <a v-if="kind === 'competition' && !compact" href="https://www.idtrade.cn/User/Contest" target="_blank" rel="noopener noreferrer">查看官方赛项来源 <span aria-hidden="true">↗</span></a>
    </div>
  </div>
</template>

<style scoped>
.scenario-identity { display: flex; flex-direction: column; align-items: center; gap: 24px; box-sizing: border-box; width: 100%; min-width: 0; padding: 28px; border-radius: var(--m-radius); background: var(--m-surface); text-align: center; }
.scenario-identity-media { flex: 0 0 auto; overflow: hidden; border-radius: 8px; }
.scenario-identity-media img { display: block; width: 100%; height: auto; }
.scenario-identity-course { width: 96px; aspect-ratio: 107 / 108; }
.scenario-identity-competition { width: min(100%, 288px); aspect-ratio: 960 / 704; }
.scenario-identity-copy { min-width: 0; }
.scenario-identity-copy span, .scenario-identity-copy strong, .scenario-identity-copy small { display: block; }
.scenario-identity-copy span { color: var(--m-muted); font-size: 13px; line-height: 1.5; }
.scenario-identity-copy strong { margin-top: 8px; color: var(--m-ink); font-size: 20px; line-height: 1.5; text-wrap: pretty; }
.scenario-identity-copy small { margin-top: 4px; color: var(--m-text); font-size: 15px; line-height: 1.65; }
.scenario-identity-copy a { display: inline-flex; align-items: center; min-height: 44px; gap: 6px; margin-top: 8px; color: var(--m-blue); font-size: 13px; text-underline-offset: 4px; }
.scenario-identity-copy a span { display: inline; color: inherit; }
.scenario-identity.compact { flex-direction: row; gap: 16px; padding: 0; border: 0; border-radius: 0; background: transparent; text-align: left; }
.compact .scenario-identity-course { width: 64px; }
.compact .scenario-identity-competition { width: 112px; }
.compact .scenario-identity-copy strong { margin-top: 4px; font-size: 15px; }
.compact .scenario-identity-copy small { font-size: 13px; }
@media (max-width: 480px) {
  .scenario-identity { padding: 24px 20px; gap: 20px; }
  .scenario-identity-copy strong { font-size: 19px; }
  .scenario-identity.compact { gap: 12px; }
  .compact .scenario-identity-competition { width: 104px; }
}
</style>
