<template>
  <div class="auth-entry-backdrop" :class="`is-${variant}`" aria-hidden="true">
    <AuthArtwork class="auth-entry-flow" :variant="variant" />
  </div>
</template>

<script setup lang="ts">
import AuthArtwork from './AuthArtwork.vue'

withDefaults(defineProps<{
  variant?: 'consumer' | 'admin'
}>(), { variant: 'consumer' })
</script>

<style scoped>
.auth-entry-backdrop { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; background: #f6f8fc; }
.auth-entry-backdrop.is-admin { background: #eaf0f6; }
.auth-entry-backdrop::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 80% 32%, #fff9, transparent 60%);
}
@media (prefers-reduced-motion: reduce) {
  .auth-entry-backdrop, .auth-entry-backdrop :deep(*) { animation: none !important; transition: none !important; }
}
</style>
