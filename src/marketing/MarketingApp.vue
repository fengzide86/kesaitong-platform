<template>
  <RouterView />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import { cancelMarketingScroll } from './navigation-scroll'

const router = useRouter()
function handleAnchor(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
  const hash = anchor?.getAttribute('href')
  if (!anchor || !hash?.startsWith('#') || hash === '#' || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return
  event.preventDefault()
  void router.push({ path: router.currentRoute.value.path, query: router.currentRoute.value.query, hash })
}
onMounted(() => document.addEventListener('click', handleAnchor))
onBeforeUnmount(() => {
  document.removeEventListener('click', handleAnchor)
  cancelMarketingScroll()
})
</script>
