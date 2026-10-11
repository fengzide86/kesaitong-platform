<template>
  <div class="message-center">
    <button class="message-trigger" type="button" :aria-label="`消息中心，${store.unreadCount} 条未读`" @click="openDrawer">
      <Bell :size="17" />
      <span v-if="store.unreadCount" class="message-count">{{ store.unreadCount > 99 ? '99+' : store.unreadCount }}</span>
    </button>

    <Teleport to="body">
      <Transition name="drawer-fade">
        <div v-if="open" class="drawer-layer" @mousedown.self="closeDrawer">
          <aside ref="drawer" class="message-drawer" role="dialog" aria-modal="true" aria-labelledby="message-center-title" tabindex="-1">
            <header>
              <div><p>MESSAGE CENTER</p><h2 id="message-center-title">消息中心</h2></div>
              <button type="button" aria-label="关闭消息中心" @click="closeDrawer"><X :size="18" /></button>
            </header>
            <nav aria-label="消息分类">
              <button v-for="option in filters" :key="option.value" type="button" :class="{ active: filter === option.value }" @click="filter = option.value">{{ option.label }}</button>
            </nav>
            <div v-if="store.error" class="message-error" role="alert">{{ store.error }} <button type="button" :disabled="store.loading" @click="reload">重新读取</button></div>
            <div v-if="store.loading" class="message-empty">正在读取消息…</div>
            <div v-else-if="!store.error && !filteredItems.length" class="message-empty">这里暂时没有消息</div>
            <div v-else class="message-list">
              <article v-for="item in filteredItems" :key="`${item.id}-${item.revision}`" :class="{ unread: !item.is_read, expanded: expanded === item.id }">
                <div class="message-meta"><span>{{ categoryLabel(item.category) }}</span><time>{{ formatDate(item.published_at || item.created_at) }}</time></div>
                <h3>{{ item.title }}</h3>
                <p :id="`announcement-body-${item.id}`">{{ item.content }}</p>
                <button type="button" :aria-expanded="expanded === item.id" :aria-controls="`announcement-body-${item.id}`" @click="toggleItem(item)">{{ expanded === item.id ? '收起正文' : '阅读全文' }}</button>
                <button v-if="!item.is_dismissed" type="button" @click="dismissItem(item)">不再提示</button>
              </article>
            </div>
          </aside>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Bell, X } from '@lucide/vue'

import { useAnnouncementStore } from './store'
import type { Announcement } from './model'
import { useOverlayCoordinatorStore } from '@/features/shell/overlay-store'
import { useModalFocus } from '@/composables/useModalFocus'
import { showToast } from '@/utils'

type Filter = 'all' | Announcement['category']

const store = useAnnouncementStore()
const overlay = useOverlayCoordinatorStore()
const open = computed(() => overlay.activeDrawer === 'announcements')
const filter = ref<Filter>('all')
const drawer = ref<HTMLElement | null>(null)
const expanded = ref<Announcement['id'] | null>(null)
useModalFocus(open, drawer, closeDrawer)
async function reload() { await store.load(true).catch(() => undefined) }
async function toggleItem(item: Announcement) {
  expanded.value = expanded.value === item.id ? null : item.id
  if (expanded.value === item.id) await store.read(item).catch(() => showToast('已读状态未同步，请稍后重试', 'error'))
}
async function dismissItem(item: Announcement) { await store.dismiss(item).catch(() => showToast('公告状态未保存，请稍后重试', 'error')) }
const filters: Array<{ label: string; value: Filter }> = [
  { label: '全部', value: 'all' }, { label: '系统', value: 'system' },
  { label: '更新', value: 'update' }, { label: '维护', value: 'maintenance' },
]
const filteredItems = computed(() => filter.value === 'all' ? store.items : store.items.filter(item => item.category === filter.value))

async function openDrawer(): Promise<void> {
  if (!overlay.openDrawer('announcements')) return
  await reload()
}
function closeDrawer(): void { overlay.closeDrawer('announcements') }
function categoryLabel(category: Announcement['category']): string {
  return ({ system: '系统', update: '版本', activity: '活动', maintenance: '维护' })[category]
}
function formatDate(value?: string | null): string {
  return value ? new Date(value).toLocaleDateString('zh-CN') : ''
}

onMounted(() => store.load().catch(() => undefined))
</script>

<style scoped>
.message-list article.expanded p{display:block;overflow:visible;-webkit-line-clamp:unset;overflow-wrap:anywhere}.message-list article>button+button{margin-left:20px}.message-error{padding:14px;border:1px solid var(--color-border);border-radius:9px;color:var(--color-danger);line-height:1.6}.message-error button{font:inherit;color:var(--color-primary);background:transparent;border:0;cursor:pointer}.message-drawer{box-sizing:border-box}.message-list article{overflow-wrap:anywhere}
.message-trigger{position:relative;display:grid;place-items:center;width:36px;height:36px;border:1px solid var(--color-border);border-radius:10px;color:var(--color-text-secondary);background:var(--color-surface);cursor:pointer}.message-trigger:hover{color:var(--color-primary);background:var(--color-primary-soft)}
.message-count{position:absolute;top:-5px;right:-6px;min-width:18px;height:18px;padding:0 4px;border:2px solid var(--color-surface);border-radius:9px;color:#fff;background:var(--color-danger);font-size:var(--type-micro);font-weight:800;line-height:14px;text-align:center}
.drawer-layer{position:fixed;inset:0;z-index:1400;isolation:isolate;background:rgba(24,32,51,.18)}.message-drawer{position:absolute;top:0;right:0;width:min(430px,100vw);height:100vh;padding:26px;background:var(--color-surface);box-shadow:-22px 0 60px rgba(24,32,51,.14);overflow:auto}.message-drawer>header{display:flex;align-items:flex-start;justify-content:space-between}.message-drawer header p{margin:0;color:var(--color-primary);font-size:var(--type-micro);font-weight:800;letter-spacing:.15em}.message-drawer h2{margin:4px 0 0;font-size:22px}.message-drawer header button{display:grid;place-items:center;width:36px;height:36px;border:0;border-radius:9px;color:var(--color-text-secondary);background:transparent;cursor:pointer}.message-drawer nav{display:flex;gap:6px;margin:24px 0 16px;padding-bottom:14px;border-bottom:1px solid var(--color-border)}.message-drawer nav button{min-height:36px;padding:7px 12px;border:0;border-radius:8px;color:var(--color-text-secondary);background:transparent;font-size:var(--type-control);cursor:pointer}.message-drawer nav button.active{color:var(--color-primary);background:var(--color-primary-soft);font-weight:700}.message-list{display:grid;gap:10px}.message-list article{position:relative;padding:16px;border:1px solid var(--color-border);border-radius:13px;background:var(--color-surface);cursor:pointer}.message-list article.unread{border-left:3px solid var(--color-primary);background:linear-gradient(90deg,var(--color-primary-soft),var(--color-surface) 24%)}.message-meta{display:flex;justify-content:space-between;color:var(--color-text-secondary);font-size:var(--type-micro)}.message-meta span{color:var(--color-primary);font-weight:800}.message-list h3{margin:8px 0 5px;font-size:var(--type-card)}.message-list p{display:-webkit-box;margin:0;color:var(--color-text-secondary);font-size:var(--type-control);line-height:1.65;overflow:hidden;-webkit-line-clamp:3;-webkit-box-orient:vertical;white-space:pre-wrap}.message-list article>button{min-height:34px;margin-top:8px;padding:0;border:0;color:var(--color-primary);background:transparent;font-size:var(--type-control);cursor:pointer}.message-empty{padding:54px 0;color:var(--color-text-secondary);font-size:var(--type-meta);text-align:center}.drawer-fade-enter-active,.drawer-fade-leave-active{transition:opacity var(--motion-fast)}.drawer-fade-enter-active .message-drawer,.drawer-fade-leave-active .message-drawer{transition:transform var(--motion-normal)}.drawer-fade-enter-from,.drawer-fade-leave-to{opacity:0}.drawer-fade-enter-from .message-drawer,.drawer-fade-leave-to .message-drawer{transform:translateX(24px)}@media(max-width:768px){.drawer-layer{display:flex;align-items:flex-end}.message-drawer{position:relative;width:100%;height:auto;max-height:80vh;border-radius:18px 18px 0 0}}@media(prefers-reduced-motion:reduce){.drawer-fade-enter-active,.drawer-fade-leave-active,.drawer-fade-enter-active .message-drawer,.drawer-fade-leave-active .message-drawer{transition:none}}
</style>
