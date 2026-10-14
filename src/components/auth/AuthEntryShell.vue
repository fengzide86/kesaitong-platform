<template>
  <main
    class="auth-entry-shell"
    :class="[`auth-entry-${variant}`]"
    v-bind="$attrs"
  >
    <slot />
  </main>
</template>

<script setup lang="ts">
import './auth-entry.css'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  variant?: 'consumer' | 'admin'
}>(), {
  variant: 'consumer',
})
</script>
