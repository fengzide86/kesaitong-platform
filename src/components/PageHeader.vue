<template>
  <template v-if="shellContext">
    <Teleport v-if="showActionsInShell && hasActions" to="#shell-page-actions">
      <div class="page-header-v6__shell-actions" data-shell-page-actions>
        <slot name="actions"><slot /></slot>
      </div>
    </Teleport>
    <header v-else-if="hasActions" class="page-header-v6 page-header-v6--actions-only">
      <div class="page-header-v6__actions">
        <slot name="actions"><slot /></slot>
      </div>
    </header>
  </template>
  <header v-else class="page-header-v6">
    <div class="page-header-v6__content">
      <span v-if="eyebrow" class="page-header-v6__eyebrow">{{ eyebrow }}</span>
      <component :is="level">{{ title }}</component>
      <p v-if="resolvedDescription">{{ resolvedDescription }}</p>
    </div>
    <div v-if="$slots.actions || $slots.default" class="page-header-v6__actions">
      <slot name="actions"><slot /></slot>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useSlots, watch } from 'vue'
import { useShellPageHeader } from '@/features/shell/pageHeaderContext'

const props = withDefaults(defineProps<{
  title: string
  description?: string
  subtitle?: string
  eyebrow?: string
  level?: 'h1' | 'h2'
}>(), {
  description: '',
  subtitle: '',
  eyebrow: '',
  level: 'h2',
})

const slots = useSlots()
const shellContext = useShellPageHeader()
const owner = Symbol('page-header-owner')
const showActionsInShell = ref(true)
const hasActions = computed(() => Boolean(slots.actions || slots.default))
const resolvedDescription = computed(() => props.description || props.subtitle)
let mediaQuery: MediaQueryList | null = null

function syncShellHeader() {
  shellContext?.set(owner, {
    eyebrow: props.eyebrow,
    title: props.title,
    description: resolvedDescription.value,
  })
}

function updateActionPlacement(event?: MediaQueryListEvent) {
  showActionsInShell.value = event ? event.matches : Boolean(mediaQuery?.matches ?? true)
}

watch(
  () => [props.eyebrow, props.title, resolvedDescription.value],
  syncShellHeader,
  { immediate: true },
)

onMounted(() => {
  if (typeof window === 'undefined' || !window.matchMedia) return
  // With a desktop sidebar, several action buttons otherwise consume the whole
  // title at 1025–1180px. Reuse the existing in-page action row for that range.
  mediaQuery = window.matchMedia('(min-width: 1181px)')
  updateActionPlacement()
  mediaQuery.addEventListener?.('change', updateActionPlacement)
})

onUnmounted(() => {
  mediaQuery?.removeEventListener?.('change', updateActionPlacement)
  shellContext?.clear(owner)
})
</script>
