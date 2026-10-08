<template>
  <div id="app">
    <ErrorBoundary>
      <router-view v-slot="{ Component }">
        <AppTransition mode="out-in">
          <component :is="Component" />
        </AppTransition>
      </router-view>
    </ErrorBoundary>
    <AppUpdateHost />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import AppUpdateHost from '@/features/updates/AppUpdateHost.vue'
import ErrorBoundary from '@/components/ErrorBoundary.vue'
import AppTransition from '@/components/AppTransition.vue'
import { useConnectionStore } from '@/stores/connection'

const connection = useConnectionStore()
let disposeConnectivity: (() => void) | undefined

onMounted(() => {
  disposeConnectivity = connection.initialize()
})

onUnmounted(() => disposeConnectivity?.())
</script>

<style>
#app {
  min-height: 100vh;
}
</style>
