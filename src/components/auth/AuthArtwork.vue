<template>
  <div class="auth-artwork" :class="`auth-artwork-${variant}`" v-bind="$attrs" aria-hidden="true">
    <svg class="auth-artwork-svg" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <linearGradient :id="ribbonId" x1=".2" y1="1" x2=".8" y2="0">
          <stop stop-color="#1b58d1" stop-opacity=".015" />
          <stop offset=".42" stop-color="#6d96ff" stop-opacity=".13" />
          <stop offset=".72" stop-color="#1f62e7" stop-opacity=".07" />
          <stop offset="1" stop-color="#10377f" stop-opacity=".018" />
        </linearGradient>
        <linearGradient :id="edgeId" x1=".2" y1="1" x2=".8" y2="0">
          <stop stop-color="#1565ff" stop-opacity="0" />
          <stop offset=".4" stop-color="#5f8cff" stop-opacity=".3" />
          <stop offset=".72" stop-color="#2a69e6" stop-opacity=".14" />
          <stop offset="1" stop-color="#1565ff" stop-opacity=".04" />
        </linearGradient>
        <linearGradient :id="orbitId" x1="0" y1="0" x2="1" y2="0">
          <stop stop-color="#253c55" stop-opacity=".015" />
          <stop offset=".45" stop-color="#385b86" stop-opacity=".2" />
          <stop offset=".72" stop-color="#253c55" stop-opacity=".08" />
          <stop offset="1" stop-color="#253c55" stop-opacity=".012" />
        </linearGradient>
        <radialGradient :id="haloId" cx="52%" cy="48%" r="56%">
          <stop stop-color="#8eb2ff" stop-opacity=".12" />
          <stop offset=".48" stop-color="#a8c1f4" stop-opacity=".045" />
          <stop offset="1" stop-color="#eef3ff" stop-opacity="0" />
        </radialGradient>
        <filter :id="glowId" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <filter :id="softGlowId" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
      </defs>

      <!-- The logo's rising S ribbon and open orbital arcs share one continuous canvas. -->
      <ellipse class="brand-halo" :fill="`url(#${haloId})`" cx="830" cy="495" rx="630" ry="440" />
      <g class="brand-orbit-glow" fill="none" stroke-linecap="round" :filter="`url(#${glowId})`">
        <path d="M635 316 C427 399 313 547 369 634 C423 718 609 687 739 605" />
        <path d="M881 317 C1149 329 1397 442 1413 600 C1430 762 1212 898 1006 969" />
      </g>
      <g class="brand-orbits" fill="none" :stroke="`url(#${orbitId})`" stroke-linecap="round">
        <path d="M635 316 C427 399 313 547 369 634 C423 718 609 687 739 605" />
        <path class="brand-orbit-inner" d="M596 360 C449 444 385 551 439 606 C486 653 608 636 685 605" />
        <path d="M881 317 C1149 329 1397 442 1413 600 C1430 762 1212 898 1006 969" />
        <path class="brand-orbit-inner" d="M976 366 C1198 425 1335 528 1323 646 C1314 749 1180 849 1072 906" />
      </g>
      <path class="brand-ribbon" :fill="`url(#${ribbonId})`" d="M340 990 C680 860 919 694 907 535 C897 424 676 407 683 285 C690 165 865 109 1114 70 C929 149 792 203 800 281 C810 351 1026 398 1046 513 C1087 733 754 946 340 990Z" />
      <path class="brand-ribbon-glow" :d="flowPath" pathLength="1000" fill="none" stroke="#5f8cff" stroke-width="14" stroke-linecap="round" :filter="`url(#${softGlowId})`" />
      <path class="brand-ribbon-edge" :stroke="`url(#${edgeId})`" :d="flowPath" fill="none" stroke-width="1.8" />
      <path class="brand-flow-light" :d="flowPath" pathLength="1000" fill="none" stroke="#2e70ef" stroke-width="3.2" stroke-linecap="round" />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { useId } from 'vue'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  variant?: 'consumer' | 'admin'
}>(), { variant: 'consumer' })

const artworkId = useId()
const ribbonId = `${artworkId}-ribbon`
const edgeId = `${artworkId}-edge`
const orbitId = `${artworkId}-orbit`
const haloId = `${artworkId}-halo`
const glowId = `${artworkId}-glow`
const softGlowId = `${artworkId}-soft-glow`
// Bottom to top: the moving highlight follows the logo's upward direction.
const flowPath = 'M340 990 C680 860 919 694 907 535 C897 424 676 407 683 285 C690 165 865 109 1114 70'
</script>

<style scoped>
.auth-artwork { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.auth-artwork-svg { display: block; width: 100%; height: 100%; }
.brand-halo { opacity: .75; transform-origin: 830px 495px; }
.brand-orbits { stroke-width: 1.45; }
.brand-orbit-inner { stroke-opacity: .055; stroke-width: 1; }
.brand-orbit-glow { stroke: #8db1ff; stroke-opacity: .12; stroke-width: 13; }
.brand-ribbon { mix-blend-mode: multiply; }
.brand-ribbon-glow { opacity: .14; }
.brand-flow-light { opacity: 0; stroke-dasharray: 78 1122; stroke-dashoffset: 78; }
.auth-artwork-admin { opacity: .72; }
.auth-artwork-admin .brand-orbit-glow { stroke-opacity: .1; }
.auth-artwork-admin .brand-ribbon-glow { opacity: .1; }
@media (prefers-reduced-motion: no-preference) {
  .brand-flow-light, .brand-ribbon-glow { animation: kst-logo-ascent 16s linear infinite; }
  .brand-halo { animation: kst-logo-halo 24s ease-in-out infinite; }
  .auth-artwork-admin .brand-flow-light, .auth-artwork-admin .brand-ribbon-glow { animation-duration: 24s; }
  .auth-artwork-admin .brand-halo { animation-duration: 32s; }
}
@keyframes kst-logo-ascent {
  0% { stroke-dashoffset: 65; opacity: 0; }
  10%, 76% { opacity: .3; }
  90%, 100% { stroke-dashoffset: -1000; opacity: 0; }
}
@keyframes kst-logo-halo {
  0%, 100% { opacity: .62; transform: scale(1); }
  50% { opacity: .92; transform: scale(1.035); }
}
@media (max-width: 760px) {
  /* Keep the S bend in the open space beside the mobile heading. */
  .auth-artwork-svg { position: absolute; width: 900px; height: 650px; top: 0; left: calc(50% - 620px); }
  .auth-artwork { opacity: .6; }
  .auth-artwork-admin { opacity: .45; }
}
@media (prefers-reduced-motion: reduce) {
  .brand-flow-light, .brand-ribbon-glow, .brand-halo { animation: none !important; }
}
</style>
