<template>
  <div class="auth-artwork" :class="[`auth-artwork-${variant}`, { 'is-liquid-ready': liquidReady }]" v-bind="$attrs" aria-hidden="true">
    <svg class="auth-artwork-svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <linearGradient :id="ribbonId" x1="0" y1="1" x2="1" y2="0">
          <stop stop-color="#588cdb" stop-opacity=".055" />
          <stop offset=".5" stop-color="#8db1ea" stop-opacity=".18" />
          <stop offset="1" stop-color="#7c9bd1" stop-opacity=".04" />
        </linearGradient>
        <linearGradient :id="tributaryId" x1="0" y1="1" x2=".8" y2="0">
          <stop stop-color="#56759e" stop-opacity="0" />
          <stop offset=".42" stop-color="#7894b9" stop-opacity=".11" />
          <stop offset=".7" stop-color="#6484ad" stop-opacity=".065" />
          <stop offset="1" stop-color="#5c7ca9" stop-opacity="0" />
        </linearGradient>
        <linearGradient :id="edgeId" x1=".2" y1="1" x2=".8" y2="0">
          <stop stop-color="#608fda" stop-opacity="0" />
          <stop offset=".5" stop-color="#608fda" stop-opacity=".17" />
          <stop offset="1" stop-color="#608fda" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path class="brand-ribbon" :fill="`url(#${ribbonId})`" d="M340 990 C680 860 919 694 907 535 C897 424 676 407 683 285 C690 165 865 109 1114 70 C929 149 792 203 800 281 C810 351 1026 398 1046 513 C1087 733 754 946 340 990Z" />
      <!-- Approved tributaries stay static; only the main S carries the liquid material. -->
      <g class="brand-tributaries" :fill="`url(#${tributaryId})`">
        <path d="M526 313 C530 254 572 209 628 183 C653 171 679 162 706 156 C658 177 615 202 584 236 C558 263 539 291 526 313Z" />
        <path d="M798 611 C824 694 722 767 588 794 C696 780 816 728 827 666 C829 644 818 623 798 611Z" />
        <path d="M1332 709 C1384 797 1278 872 1127 921 C1270 890 1387 829 1374 763 C1369 742 1354 724 1332 709Z" />
      </g>
      <path class="brand-ribbon-edge" fill="none" :stroke="`url(#${edgeId})`" stroke-width="1" d="M340 990 C680 860 919 694 907 535 C897 424 676 407 683 285 C690 165 865 109 1114 70" />
    </svg>
    <canvas ref="canvas" class="auth-liquid-canvas" aria-hidden="true"></canvas>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { createLiquidRibbon } from './liquidRibbon'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  variant?: 'consumer' | 'admin'
}>(), { variant: 'consumer' })

const artworkId = useId()
const ribbonId = `${artworkId}-ribbon`
const tributaryId = `${artworkId}-tributary`
const edgeId = `${artworkId}-edge`
const canvas = ref<HTMLCanvasElement | null>(null)
const liquidReady = ref(false)
let renderer: ReturnType<typeof createLiquidRibbon> | undefined

onMounted(() => {
  if (canvas.value) {
    renderer = createLiquidRibbon(canvas.value, props.variant, ready => { liquidReady.value = ready })
  }
})
watch(() => props.variant, variant => renderer?.setVariant(variant))
onBeforeUnmount(() => renderer?.dispose())
</script>

<style scoped>
.auth-artwork { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.auth-artwork-svg, .auth-liquid-canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.auth-liquid-canvas { opacity: 0; }
.is-liquid-ready .auth-liquid-canvas { opacity: 1; }
.is-liquid-ready .brand-ribbon { opacity: .25; }
@media (prefers-reduced-motion: reduce) {
  .auth-artwork, .auth-artwork * { animation: none !important; transition: none !important; }
}
</style>
