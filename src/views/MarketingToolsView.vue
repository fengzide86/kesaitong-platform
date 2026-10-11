<script setup lang="ts">
import MarketingShell from '@/components/landing/MarketingShell.vue'
import MarketingToolsOverview from '@/components/landing/MarketingToolsOverview.vue'
</script>

<template>
  <MarketingShell :show-download="true">
    <main class="tools-page" data-route-focus>
      <MarketingToolsOverview />
    </main>
  </MarketingShell>
</template>

<style scoped>
.tools-page {
  min-height: 100vh;
  color: #1d2d46;
  background: linear-gradient(180deg, #f7faff 0, #fff 38%);
}
</style>
