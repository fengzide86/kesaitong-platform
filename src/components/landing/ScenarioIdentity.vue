<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowUpRight, Box, Megaphone, Package, Truck, Warehouse } from '@lucide/vue'
import amazonSimulationIcon from '@/assets/website/amazon-simulation-icon.png'
import contestCard from '@/assets/website/contest-crossborder-2026-4x.png'

type ScenarioKind = 'course' | 'competition'

const props = withDefaults(defineProps<{ kind: ScenarioKind; compact?: boolean }>(), { compact: false })
const imageFailed = ref(false)
const taskLabels = [
  { title: '商品发布', icon: Package },
  { title: '物流配置', icon: Truck },
  { title: '广告营销', icon: Megaphone },
  { title: '订单发货', icon: Box },
]
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
    <template v-if="compact">
      <div v-if="!imageFailed" class="scenario-identity-media" :class="`scenario-identity-${kind}`">
        <img :src="content.src" :alt="content.alt" :width="kind === 'course' ? 120 : 960" :height="kind === 'course' ? 120 : 704" loading="lazy" @error="imageFailed = true" />
      </div>
      <div class="scenario-identity-copy"><span>{{ content.label }}</span><strong>{{ content.title }}</strong><small>{{ content.description }}</small></div>
    </template>

    <template v-else-if="kind === 'course'">
      <div class="identity-platform">
        <div v-if="!imageFailed" class="scenario-identity-media scenario-identity-course">
          <img :src="content.src" :alt="content.alt" width="120" height="120" loading="eager" @error="imageFailed = true" />
        </div>
        <div class="scenario-identity-copy"><span>{{ content.label }}</span><strong>{{ content.title }}</strong></div>
      </div>
      <p class="identity-headline">从商品上架，<br>到订单发货。</p>
      <p class="identity-caption">在仿真店铺里，练习跨境电商经营。</p>
      <ul class="identity-tasks" aria-label="实训练习内容">
        <li v-for="task in taskLabels" :key="task.title"><component :is="task.icon" :size="20" :stroke-width="1.7" aria-hidden="true" /><span>{{ task.title }}</span></li>
      </ul>
    </template>

    <template v-else>
      <div class="identity-event-heading scenario-identity-copy">
        <span>{{ content.label }}</span>
        <strong>{{ content.title }}</strong>
      </div>
      <p class="identity-headline">跨境电商<br><em>数字化运营</em></p>
      <div class="identity-event-topics" aria-label="比赛经营任务"><span><Package :size="16" aria-hidden="true" />商品</span><span><Truck :size="16" aria-hidden="true" />物流</span><span><Megaphone :size="16" aria-hidden="true" />营销</span><span><Warehouse :size="16" aria-hidden="true" />FBA</span></div>
      <a class="identity-source" data-testid="scenario-official-source" href="https://www.idtrade.cn/User/Contest" target="_blank" rel="noopener noreferrer">
        <div v-if="!imageFailed" class="scenario-identity-media scenario-identity-competition">
          <img :src="content.src" :alt="content.alt" width="960" height="704" loading="eager" @error="imageFailed = true" />
        </div>
        <div><span>官方赛项卡片</span><strong>查看赛事来源 <ArrowUpRight :size="17" aria-hidden="true" /></strong></div>
      </a>
    </template>
  </div>
</template>

<style scoped>
.scenario-identity { box-sizing: border-box; width: 100%; min-width: 0; padding: 32px; border: 1px solid #dce5f6; border-radius: 22px; background: linear-gradient(145deg, #f3f7ff, #fff 75%); text-align: left; }
.scenario-identity *, .scenario-identity *::before, .scenario-identity *::after { box-sizing: border-box; }
.scenario-identity-media { flex: 0 0 auto; overflow: hidden; border-radius: 8px; }
.scenario-identity-media img { display: block; width: 100%; height: auto; }
.scenario-identity-course { width: 60px; aspect-ratio: 1; }
.scenario-identity-competition { width: 132px; aspect-ratio: 960 / 704; }
.scenario-identity-copy { min-width: 0; }
.scenario-identity-copy span, .scenario-identity-copy strong, .scenario-identity-copy small { display: block; }
.scenario-identity-copy span { color: var(--m-muted); font-size: 13px; line-height: 1.5; }
.scenario-identity-copy strong { margin-top: 6px; color: var(--m-ink); font-size: 21px; line-height: 1.5; text-wrap: pretty; }
.scenario-identity-copy small { margin-top: 4px; color: var(--m-text); font-size: 15px; line-height: 1.65; }
.identity-platform { display: flex; align-items: center; gap: 16px; }
.identity-headline { margin: 30px 0 0; color: var(--m-ink); font-size: 34px; font-weight: 750; line-height: 1.35; letter-spacing: 0; }
.identity-headline em { color: var(--m-blue); font-style: normal; }
.identity-caption { margin: 12px 0 0; color: var(--m-text); font-size: 15px; line-height: 1.8; }
.identity-tasks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px; margin: 28px 0 0; padding: 24px 0 0; border-top: 1px solid #dce5f6; list-style: none; }
.identity-tasks li { display: flex; align-items: center; gap: 10px; color: var(--m-ink); font-size: 15px; line-height: 1.7; }
.identity-tasks svg, .identity-event-topics svg { flex-shrink: 0; color: var(--m-blue); }
.identity-event-heading strong { max-width: 320px; font-size: 17px; line-height: 1.65; }
.identity-event-topics { display: flex; flex-wrap: wrap; gap: 12px 18px; margin-top: 20px; }
.identity-event-topics > span { display: inline-flex; align-items: center; gap: 7px; color: var(--m-text); font-size: 14px; line-height: 1.6; }
.identity-source { display: flex; align-items: center; gap: 20px; min-height: 44px; margin-top: 28px; padding-top: 24px; border-top: 1px solid #dce5f6; color: var(--m-blue); text-decoration: none; }
.identity-source > div:last-child { min-width: 0; }
.identity-source span { display: block; color: var(--m-muted); font-size: 13px; line-height: 1.6; }
.identity-source strong { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 14px; font-weight: 650; line-height: 1.7; }
.identity-source:hover strong { text-decoration: underline; text-underline-offset: 5px; }
.identity-source:focus-visible { outline: 3px solid var(--m-blue); outline-offset: 6px; border-radius: 8px; }
.scenario-identity.compact { display: flex; align-items: center; gap: 16px; padding: 0; border: 0; border-radius: 0; background: transparent; }
.compact .scenario-identity-course { width: 60px; }
.compact .scenario-identity-competition { width: 164px; }
.compact .scenario-identity-copy strong { margin-top: 4px; font-size: 15px; }
.compact .scenario-identity-copy small { font-size: 13px; }
@media (max-width: 480px) {
  .scenario-identity { padding: 24px; border-radius: 18px; }
  .identity-platform { gap: 14px; }
  .scenario-identity-copy strong { font-size: 19px; }
  .identity-event-heading strong { font-size: 15px; }
  .identity-headline { margin-top: 22px; font-size: 28px; }
  .identity-caption { font-size: 14px; }
  .identity-tasks { margin-top: 20px; padding-top: 20px; gap: 14px 16px; }
  .identity-source { gap: 14px; margin-top: 22px; padding-top: 20px; }
  .scenario-identity-competition { width: 120px; }
  .scenario-identity.compact { gap: 12px; }
  .compact .scenario-identity-course { width: 60px; }
  .compact .scenario-identity-competition { width: 142px; }
}
</style>
