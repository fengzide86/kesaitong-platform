<script setup lang="ts">
import { computed } from 'vue'
import { isSafeImage } from './model'
const props = defineProps<{ title?: string; image?: string; color?: string }>()
const safeImage = computed(() => isSafeImage(props.image || '') ? props.image : '')
const kind = computed(() => /杯|瓶|mug/i.test(props.title || '') ? 'cup' : /灯|lamp/i.test(props.title || '') ? 'lamp' : /衣|shirt/i.test(props.title || '') ? 'shirt' : /耳|head/i.test(props.title || '') ? 'headphone' : /盒|收纳|basket/i.test(props.title || '') ? 'basket' : 'bag')
const tone = computed(() => /红|粉/.test(props.color || '') ? '#a8756c' : /绿/.test(props.color || '') ? '#657e65' : /白|米/.test(props.color || '') ? '#c6c1b3' : /黑/.test(props.color || '') ? '#464a4d' : '#6c8297')
</script>

<template>
  <img v-if="safeImage" :src="safeImage" :alt="title || '商品图片'" class="v2-product-image" />
  <svg v-else viewBox="0 0 96 96" class="v2-product-image" role="img" :aria-label="`${title || '商品'} · 自绘样例图片`">
    <rect width="96" height="96" fill="white" />
    <ellipse cx="48" cy="82" rx="30" ry="5" fill="#e8e8e6" />
    <g v-if="kind === 'cup'">
      <path d="M67 31h8c16 0 15 28-1 29h-7" fill="none" :stroke="tone" stroke-width="8" />
      <path d="M24 24h44v49q-20 15-44 0z" :fill="tone" />
      <ellipse cx="46" cy="24" rx="22" ry="7" fill="#ecebe6" /><ellipse cx="46" cy="24" rx="17" ry="4" fill="#a6a49c" />
      <path d="M30 31v37" stroke="white" stroke-opacity=".32" stroke-width="3" />
    </g>
    <g v-else-if="kind === 'lamp'">
      <ellipse cx="48" cy="78" rx="23" ry="5" fill="#747777" /><path d="M48 76V43" stroke="#a0a2a3" stroke-width="5" />
      <path d="M30 13h36l13 30H17z" :fill="tone" /><ellipse cx="48" cy="43" rx="31" ry="5" fill="#c2b79a" />
      <path d="M34 15l-6 24" stroke="white" stroke-opacity=".22" stroke-width="3" />
    </g>
    <g v-else-if="kind === 'shirt'">
      <path d="M30 18l9-4q9 10 18 0l9 4 21 18-13 16-9-8v39H31V44l-9 8-13-16z" :fill="tone" />
      <path d="M39 14q8 20 18 0M33 46v34M63 46v34" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="2" />
    </g>
    <g v-else-if="kind === 'headphone'">
      <path d="M23 60V39a25 25 0 0 1 50 0v21" fill="none" stroke="#363e44" stroke-width="11" />
      <rect x="15" y="43" width="17" height="33" rx="8" :fill="tone" /><rect x="64" y="43" width="17" height="33" rx="8" :fill="tone" />
      <path d="M28 32q20-23 40 0" stroke="#95999c" stroke-width="3" fill="none" />
    </g>
    <g v-else-if="kind === 'basket'">
      <path d="M17 31h62l-5 46H22z" :fill="tone" /><path d="M17 31l13-15h39l10 15" fill="#c9c7bc" />
      <path d="M27 43h43M26 54h45M25 65h47M33 38v35M46 38v35M59 38v35" stroke="white" stroke-opacity=".28" stroke-width="2" />
      <rect x="37" y="39" width="22" height="8" rx="3" fill="#565b59" />
    </g>
    <g v-else>
      <path d="M32 32V23q16-13 32 0v9" fill="none" :stroke="tone" stroke-width="5" />
      <path d="M21 30h54l7 49q-30 12-67 0z" :fill="tone" />
      <path d="M31 31v40M64 31v40" stroke="#d9d7ce" stroke-width="5" /><path d="M22 47h54" stroke="#24394b" stroke-opacity=".18" stroke-width="2" />
      <rect x="34" y="53" width="29" height="20" rx="2" fill="#fff" fill-opacity=".14" />
    </g>
  </svg>
</template>

<style scoped>
.v2-product-image{display:block;width:72px;height:72px;object-fit:contain;background:#fff;flex-shrink:0}
</style>
