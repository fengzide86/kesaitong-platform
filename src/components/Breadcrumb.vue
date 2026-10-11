<template>
  <nav class="breadcrumb" aria-label="面包屑导航">
    <router-link :to="homePath" class="breadcrumb-item" aria-label="返回首页">
      <Home :size="13" />
      首页
    </router-link>
    <span class="breadcrumb-separator">/</span>
    <template v-if="selection && selection.area.id !== 'action'">
      <span class="breadcrumb-area">{{ selection.area.label }}</span>
      <span class="breadcrumb-separator">/</span>
    </template>
    <span class="breadcrumb-item active" aria-current="page">{{ currentTitle }}</span>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Home } from '@lucide/vue'
import { useAdminNavigation } from '@/features/admin/useAdminNavigation'

const route = useRoute()
const { selection } = useAdminNavigation()

const homePath = computed(() => {
  return route.path?.startsWith('/admin') ? '/admin/dashboard' : '/user/tools'
})

const currentTitle = computed(() => {
  return selection.value?.item.label || route.meta?.title || '未知页面'
})
</script>

<style scoped>
.breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  min-height: 30px;
  padding: 0;
  margin-bottom: 14px;
  font-size: var(--type-control);
  color: var(--color-text-secondary);
}

.breadcrumb-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--color-text-secondary);
  text-decoration: none;
  transition: color 0.2s;
  padding: 4px 6px;
  border-radius: 7px;
}

.breadcrumb-item:hover {
  color: var(--color-primary);
  background: var(--color-primary-soft);
}

.breadcrumb-item.active {
  color: var(--color-primary);
  font-weight: 700;
}

.breadcrumb-item svg {
  opacity: 0.7;
}

.breadcrumb-separator {
  color: var(--color-text-tertiary);
  font-size: var(--type-meta);
}
.breadcrumb-area { color: var(--color-text-secondary); }
</style>
