<template>
  <div class="auth-entry-backdrop" :class="`is-${variant}`" aria-hidden="true">
    <AuthArtwork class="auth-entry-flow" :variant="variant" />
    <div class="ambient-light"></div>
  </div>
</template>

<script setup lang="ts">
import AuthArtwork from './AuthArtwork.vue'

withDefaults(defineProps<{
  variant?: 'consumer' | 'admin'
}>(), { variant: 'consumer' })
</script>

<style scoped>
.auth-entry-backdrop { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.auth-entry-flow {
  mask-image: linear-gradient(90deg, transparent, rgba(0, 0, 0, .25) 27%, #000 54%);
}
.ambient-light {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 62% 34%, rgba(101, 145, 231, .085), transparent 32%),
    radial-gradient(ellipse at 18% 72%, rgba(255, 255, 255, .56), transparent 38%),
    linear-gradient(118deg, rgba(255, 255, 255, .2), transparent 48%, rgba(160, 188, 236, .07));
  opacity: .42;
}
.is-admin .ambient-light { opacity: .3; }
@media (max-width: 760px) {
  .auth-entry-flow { mask-image: linear-gradient(90deg, transparent, #000 90%); }
}
</style>
