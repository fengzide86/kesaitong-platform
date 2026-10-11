import { nextTick } from 'vue'

let cancelCurrentScroll: (() => void) | undefined
let navigationGeneration = 0

export function cancelMarketingScroll(): void {
  ++navigationGeneration
  cancelCurrentScroll?.()
}

function focusTarget(target: HTMLElement): void {
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
  target.focus({ preventScroll: true })
}

export async function scrollToMarketingAnchor(hash: string, animate: boolean): Promise<void> {
  cancelMarketingScroll()
  const generation = navigationGeneration
  await nextTick()
  if (generation !== navigationGeneration) return
  let id: string
  try { id = decodeURIComponent(hash.slice(1)) } catch { return }
  const target = document.getElementById(id)
  if (!target) return
  const headerHeight = document.querySelector('.marketing-shell-nav')?.getBoundingClientRect().height || 76
  const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0
  const top = Math.max(0, Math.min(
    window.scrollY + target.getBoundingClientRect().top - Math.max(headerHeight + 20, margin),
    document.documentElement.scrollHeight - window.innerHeight,
  ))
  const start = window.scrollY, left = window.scrollX
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!animate || reducedMotion || Math.abs(top - start) < 4) {
    window.scrollTo({ left, top, behavior: 'instant' })
    focusTarget(target)
    return
  }
  await new Promise<void>(resolve => {
    const duration = Math.min(650, Math.max(420, Math.abs(top - start) * 0.12))
    let frame = 0, startedAt: number | undefined, finished = false
    const finish = (arrived: boolean) => {
      if (finished) return
      finished = true
      window.cancelAnimationFrame(frame)
      window.removeEventListener('wheel', interrupt)
      window.removeEventListener('touchstart', interrupt)
      window.removeEventListener('pointerdown', interrupt)
      window.removeEventListener('keydown', interruptKey)
      if (cancelCurrentScroll === interrupt) cancelCurrentScroll = undefined
      if (arrived && target.isConnected) focusTarget(target)
      resolve()
    }
    const interrupt = () => finish(false)
    const interruptKey = (event: KeyboardEvent) => {
      if (['Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) interrupt()
    }
    const tick = (now: number) => {
      if (finished) return
      startedAt ??= now
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
      window.scrollTo({ left, top: start + (top - start) * eased, behavior: 'instant' })
      if (progress === 1) finish(true)
      else frame = window.requestAnimationFrame(tick)
    }
    cancelCurrentScroll = interrupt
    window.addEventListener('wheel', interrupt, { passive: true })
    window.addEventListener('touchstart', interrupt, { passive: true })
    window.addEventListener('pointerdown', interrupt, { passive: true })
    window.addEventListener('keydown', interruptKey)
    frame = window.requestAnimationFrame(tick)
  })
}

export function focusMarketingPage(): void {
  const target = document.querySelector<HTMLElement>('main[data-route-focus]')
    ?? document.querySelector<HTMLElement>('[data-route-focus]')
  if (target) focusTarget(target)
}

export async function restoreMarketingPosition(position: { left: number; top: number }): Promise<void> {
  const generation = navigationGeneration
  await nextTick()
  if (generation !== navigationGeneration) return
  window.scrollTo({ ...position, behavior: 'instant' })
  if (position.top < 4) { focusMarketingPage(); return }
  const headerHeight = document.querySelector('.marketing-shell-nav')?.getBoundingClientRect().height || 76
  // History restores both the reading position and the keyboard starting point.
  // Keeping focus on BODY or a departed hash target makes the next Tab jump away.
  const visible = Array.from(document.querySelectorAll<HTMLElement>(
    '.marketing-shell h2, .marketing-shell h3, .marketing-shell h4, .marketing-shell a[href], .marketing-shell button, .marketing-shell summary',
  )).filter(element => {
    if (element.closest('.marketing-shell-nav')) return false
    const closedDetails = element.closest('details:not([open])')
    if (closedDetails && !closedDetails.querySelector(':scope > summary')?.contains(element)) return false
    if (element.checkVisibility?.() === false) return false
    const rect = element.getBoundingClientRect()
    return rect.height > 0 && rect.top >= headerHeight && rect.bottom <= window.innerHeight
  }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
  if (visible[0]) focusTarget(visible[0])
  else focusMarketingPage()
}
