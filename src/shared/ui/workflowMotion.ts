export interface WorkflowTargetOptions {
  block?: ScrollLogicalPosition
  focusSelector?: string
}

const highlights = new WeakMap<HTMLElement, Animation>()

/** Locate the next task without delaying focus or business actions for decoration. */
export function scrollToWorkflowTarget(
  element: HTMLElement | null | undefined,
  options: WorkflowTargetOptions = {},
): void {
  if (!element) return

  const view = element.ownerDocument.defaultView
  const reducedMotion = view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  highlights.get(element)?.cancel()
  highlights.delete(element)

  if (options.focusSelector) {
    const focusTarget = element.querySelector<HTMLElement>(options.focusSelector)
    focusTarget?.focus({ preventScroll: true })
  }
  element.scrollIntoView?.({ behavior: reducedMotion ? 'instant' : 'smooth', block: options.block ?? 'center' })

  if (reducedMotion || typeof element.animate !== 'function') return

  // Keep the surface's own shadow; only the temporary outer ring changes.
  const style = view?.getComputedStyle(element)
  const baseShadow = style?.boxShadow
  const prefix = baseShadow && baseShadow !== 'none' ? `${baseShadow}, ` : ''
  const ring = style?.getPropertyValue('--color-focus-ring').trim() || 'rgba(45, 95, 202, .2)'
  try {
    const animation = element.animate([
      { boxShadow: `${prefix}0 0 0 0 transparent` },
      { boxShadow: `${prefix}0 0 0 3px ${ring}`, offset: .25 },
      { boxShadow: `${prefix}0 0 0 5px transparent` },
    ], { duration: 600, easing: 'cubic-bezier(0.2, 0, 0, 1)' })
    highlights.set(element, animation)
    animation.onfinish = () => {
      if (highlights.get(element) === animation) highlights.delete(element)
    }
  } catch {
    // An unavailable decorative animation must not block the user's next step.
  }
}
