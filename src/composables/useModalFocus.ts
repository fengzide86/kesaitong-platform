import { nextTick, onUnmounted, watch, type Ref } from 'vue'

const activeModals: symbol[] = []
const selector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Keyboard containment and focus restoration for the existing custom dialogs. */
export function useModalFocus(visible: Readonly<Ref<boolean>>, element: Ref<HTMLElement | null>, close: () => void): void {
  const identity = Symbol('modal')
  let previous: HTMLElement | null = null
  const topmost = () => activeModals.at(-1) === identity
  const focusable = () => Array.from(element.value?.querySelectorAll<HTMLElement>(selector) || []).filter(item => !item.hidden && item.getAttribute('aria-hidden') !== 'true')
  function keydown(event: KeyboardEvent) {
    if (!visible.value || !topmost()) return
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
    if (event.key !== 'Tab') return
    const items = focusable()
    const first = items[0] || element.value
    const last = items.at(-1) || element.value
    if (!element.value?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus()
    }
  }
  function release() {
    const index = activeModals.indexOf(identity)
    if (index < 0) return
    const restore = topmost()
    activeModals.splice(index, 1)
    document.removeEventListener('keydown', keydown, true)
    if (restore && previous?.isConnected) previous.focus()
    previous = null
  }
  watch(visible, async value => {
    if (!value) { release(); return }
    previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    activeModals.push(identity)
    document.addEventListener('keydown', keydown, true)
    await nextTick()
    if (visible.value && topmost()) (focusable()[0] || element.value)?.focus()
  }, { immediate: true })
  onUnmounted(release)
}
