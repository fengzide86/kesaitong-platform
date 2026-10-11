<template>
  <nav v-if="selection && selection.area.items.length > 1" ref="navigationElement" class="admin-section-nav" :aria-label="`${selection.area.label}页面`" tabindex="0">
    <router-link
      v-for="item in selection.area.items"
      :key="item.id"
      :to="selection.item.id === item.id ? route.fullPath : item.to"
      class="admin-section-link"
      :class="{ 'is-current': selection.item.id === item.id }"
      active-class=""
      exact-active-class=""
      :aria-current="selection.item.id === item.id ? 'page' : undefined"
    >{{ item.label }}</router-link>
  </nav>
</template>

<script setup lang="ts">
import { useAdminNavigation } from '@/features/admin/useAdminNavigation'
import { nextTick, ref, watch } from 'vue'
const { route, selection } = useAdminNavigation()
const navigationElement = ref<HTMLElement>()
watch(() => route.fullPath, async () => {
  await nextTick()
  const navigation = navigationElement.value
  const current = navigation?.querySelector<HTMLElement>('[aria-current="page"]')
  if (!navigation || !current) return
  const left = current.offsetLeft - navigation.offsetLeft
  const right = left + current.offsetWidth
  if (left < navigation.scrollLeft) navigation.scrollLeft = left
  else if (right > navigation.scrollLeft + navigation.clientWidth) navigation.scrollLeft = right - navigation.clientWidth
}, { immediate: true, flush: 'post' })
</script>

<style scoped>
.admin-section-nav {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 24px;
  padding: 5px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface);
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;
  min-width: 0;
}
.admin-section-link {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 36px;
  padding: 0 15px;
  border-radius: 8px;
  color: var(--color-text-secondary);
  font-size: var(--type-control);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition: color var(--motion-fast), background var(--motion-fast);
}
.admin-section-link:hover { color: var(--color-primary); background: var(--color-surface-soft); }
.admin-section-link.is-current { color: var(--color-primary); background: var(--color-primary-soft); }
.admin-section-nav:focus-visible, .admin-section-link:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
@media (max-width: 767px) { .admin-section-nav { margin-bottom: 18px; } .admin-section-link { padding-inline: 12px; } }
@media (prefers-reduced-motion: reduce) { .admin-section-link { transition: none; } }
</style>
