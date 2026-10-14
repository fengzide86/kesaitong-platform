<template>
  <div class="marketing-shell" data-route-focus>
    <a class="marketing-skip-link" href="#marketing-main-content" @click.prevent="skipToContent">跳到正文</a>
    <header ref="menuHeader" class="marketing-shell-nav">
      <div class="marketing-shell-inner">
        <RouterLink class="marketing-shell-brand" to="/" aria-label="返回课赛通首页" @click="closeMenu">
          <BrandLockup audience="login" decorative />
        </RouterLink>
        <nav ref="menuNavigation" id="marketing-main-navigation" class="marketing-shell-links" :class="{ 'is-open': menuOpen }" aria-label="官网导航">
          <RouterLink to="/competition" :class="{ active: currentPath === '/competition' }" @click="closeMenu">比赛备赛</RouterLink>
          <RouterLink to="/course" :class="{ active: currentPath === '/course' }" @click="closeMenu">课程实训</RouterLink>
          <RouterLink to="/tools" :class="{ active: currentPath === '/tools' }" @click="closeMenu">工具介绍</RouterLink>
          <button class="marketing-shell-desktop-start" type="button" aria-haspopup="dialog" @click="consultation?.openConsultation('', $event)">申请使用</button>
          <RouterLink class="marketing-shell-mobile-start" to="/tools#start" @click="closeMenu">怎么开始使用</RouterLink>
        </nav>
        <div class="marketing-shell-actions">
          <RouterLink class="marketing-shell-experience" data-testid="navigation-experience" to="/tools#experience" @click="closeMenu"><Play :size="16" aria-hidden="true" />在线体验</RouterLink>
          <MarketingDownloadAction v-if="showDownload" class="marketing-shell-download" compact variant="secondary" />
          <button
            ref="menuToggle"
            class="marketing-shell-toggle"
            type="button"
            :aria-expanded="menuOpen"
            aria-controls="marketing-main-navigation"
            :aria-label="menuOpen ? '关闭导航' : '打开导航'"
            @click="menuOpen = !menuOpen"
          >
            <X v-if="menuOpen" :size="23" aria-hidden="true" />
            <Menu v-else :size="23" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
    <slot />
    <MarketingConsultationDialog ref="consultation" wechat="Moweiiong" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { Menu, Play, X } from '@lucide/vue'
import BrandLockup from '@/components/brand/BrandLockup.vue'
import MarketingDownloadAction from '@/components/landing/MarketingDownloadAction.vue'
import MarketingConsultationDialog from '@/components/landing/MarketingConsultationDialog.vue'

withDefaults(defineProps<{ showDownload?: boolean }>(), { showDownload: false })
const route = useRoute()
// GitHub Pages serves direct route files with a trailing slash. Normalize it
// so the active state remains visible for both /tools and /tools/.
const currentPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const menuOpen = ref(false)
const menuToggle = ref<HTMLButtonElement | null>(null)
const menuHeader = ref<HTMLElement | null>(null)
const menuNavigation = ref<HTMLElement | null>(null)
const consultation = ref<InstanceType<typeof MarketingConsultationDialog> | null>(null)

function skipToContent(): void {
  closeMenu()
  const main = menuHeader.value?.parentElement?.querySelector<HTMLElement>('main')
  if (!main) return
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1')
  main.focus({ preventScroll: true })
  main.scrollIntoView({ behavior: 'instant', block: 'start' })
}

function closeMenu(): void {
  menuOpen.value = false
}

function handleMenuKey(event: KeyboardEvent): void {
  if (!menuOpen.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeMenu()
    menuToggle.value?.focus()
    return
  }
  if (event.key !== 'Tab' || !menuToggle.value || !menuNavigation.value) return
  // The desktop navigation precedes the toggle in the DOM. Bridge that order
  // only while the mobile menu is visible, so opening it never skips its links.
  if (getComputedStyle(menuToggle.value).display === 'none') return
  const links = Array.from(menuNavigation.value.querySelectorAll<HTMLAnchorElement>('a'))
  const first = links[0]
  const last = links[links.length - 1]
  if (document.activeElement === menuToggle.value) {
    event.preventDefault()
    ;(event.shiftKey ? last : first)?.focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    menuToggle.value.focus()
  }
}

function handleOutsideClick(event: PointerEvent): void {
  if (menuOpen.value && event.target instanceof Node && !menuHeader.value?.contains(event.target)) closeMenu()
}

onMounted(() => {
  document.addEventListener('keydown', handleMenuKey)
  document.addEventListener('pointerdown', handleOutsideClick)
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleMenuKey)
  document.removeEventListener('pointerdown', handleOutsideClick)
})
watch(() => route.fullPath, closeMenu)
</script>

<style scoped>
.marketing-shell { min-height: 100vh; color: var(--m-ink); background: #fff; }
.marketing-skip-link { position: fixed; top: 8px; left: var(--m-gutter); z-index: 100; padding: 12px 18px; border-radius: 8px; color: #fff; background: var(--m-blue); font-size: 15px; font-weight: 650; text-decoration: none; transform: translateY(calc(-100% - 12px)); }
.marketing-skip-link:focus { transform: translateY(0); }
.marketing-shell-nav { position: sticky; top: 0; z-index: 20; border-bottom: 1px solid var(--m-border); background: rgba(255, 255, 255, .96); backdrop-filter: blur(14px); }
.marketing-shell-inner { display: flex; align-items: center; gap: 20px; width: min(var(--m-width), calc(100% - var(--m-gutter) * 2)); min-height: 76px; margin: 0 auto; }
.marketing-shell-brand { display: inline-flex; flex: 0 0 auto; align-items: center; min-height: 44px; text-decoration: none; }
.marketing-shell-brand :deep(.kst-lockup-logo) { width: 118px; height: 40px; }
.marketing-shell-brand :deep(.kst-lockup-subtitle) { color: var(--m-muted); font-size: 13px; font-weight: 600; }
.marketing-shell-links { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.marketing-shell-links a, .marketing-shell-desktop-start, .marketing-shell-login { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 12px; border-radius: 8px; color: var(--m-text); font-size: 14px; font-weight: 600; text-decoration: none; white-space: nowrap; transition: color var(--m-duration), background var(--m-duration); }
.marketing-shell-desktop-start { border: 0; font-family: inherit; background: transparent; cursor: pointer; }
.marketing-shell-links a.active { color: var(--m-blue-hover); background: var(--m-blue-soft); }
.marketing-shell-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 10px; }
.marketing-shell-experience { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 44px; padding: 0 16px; border-radius: 8px; color: #fff; background: var(--m-blue); font-size: 15px; font-weight: 700; text-decoration: none; white-space: nowrap; transition: background var(--m-duration); }
.marketing-shell-experience:focus-visible { outline: 3px solid var(--m-blue); outline-offset: 3px; }
.marketing-shell-links .marketing-shell-mobile-start { display: none; }
.marketing-shell-toggle { display: none; flex: 0 0 auto; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 8px; color: var(--m-ink); background: transparent; cursor: pointer; transition: background var(--m-duration); }
.marketing-shell-brand:focus-visible, .marketing-shell-toggle:focus-visible, .marketing-shell-links a:focus-visible, .marketing-shell-desktop-start:focus-visible, .marketing-shell-login:focus-visible { outline: 3px solid var(--m-blue); outline-offset: 3px; border-radius: 6px; }
@media (hover: hover) {
  .marketing-shell-experience:hover { background: var(--m-blue-hover); }
  .marketing-shell-links a:hover, .marketing-shell-desktop-start:hover, .marketing-shell-login:hover { color: var(--m-blue-hover); background: var(--m-blue-soft); }
  .marketing-shell-toggle:hover { background: var(--m-surface); }
}
@media (max-width: 1100px) { .marketing-shell-brand :deep(.kst-lockup-subtitle) { display: none; } }
@media (max-width: 960px) {
  .marketing-shell-inner { min-height: 68px; gap: 12px; }
  .marketing-shell-brand :deep(.kst-lockup-logo) { width: 106px; height: 36px; }
  .marketing-shell-actions { margin-left: auto; gap: 8px; }
  .marketing-shell-links { display: none; position: absolute; top: 68px; left: 0; right: 0; flex-direction: column; align-items: stretch; gap: 4px; margin: 0; padding: 12px var(--m-gutter) 20px; border-bottom: 1px solid var(--m-border); background: #fff; box-shadow: 0 12px 22px #142b470a; }
  .marketing-shell-links.is-open { display: flex; animation: marketing-menu-enter var(--m-duration) var(--m-ease); }
  .marketing-shell-links a { justify-content: flex-start; min-height: 48px; padding: 0 14px; font-size: 15px; }
  .marketing-shell-links .marketing-shell-mobile-start { display: flex; }
  .marketing-shell-desktop-start { display: none; }
  .marketing-shell-login { display: none; }
  .marketing-shell-download { display: none; }
  .marketing-shell-toggle { display: inline-flex; }
}
@media (max-width: 400px) {
  .marketing-shell-inner { gap: 8px; }
  .marketing-shell-brand :deep(.kst-lockup-logo) { width: 96px; }
  .marketing-shell-actions { gap: 4px; }
}
@keyframes marketing-menu-enter { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .marketing-shell-links.is-open { animation: none; } .marketing-shell-links a, .marketing-shell-login, .marketing-shell-toggle, .marketing-shell-experience { transition: none; } }
</style>
