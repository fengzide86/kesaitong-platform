import type { TargetControl, V2TemplateUiBinding } from './contracts.cjs'
import { createAuditedV2TemplateBinding, isAuditedV2TemplateControl, V2_TEMPLATE_OBSERVED_FORM } from './v2-template-binding.cjs'

/**
 * Audited selectors live in signed, compiled desktop code, never an IPC payload
 * or environment variable. Current R2 supports one bounded template workflow;
 * independent identity/profile/version/grant checks remain host prerequisites.
 */
export function resolveUiBinding(adapterVersion: string): V2TemplateUiBinding | undefined {
  return adapterVersion === 'bjysoft-v2-template.1' ? createAuditedV2TemplateBinding() : undefined
}

/** Exact read-only selectors audited together with the compiled recipe. */
export function resolveReadOnlyControls(_adapterVersion: string): readonly TargetControl[] {
  return []
}

/** Exact fields readable by the worker, distinct from navigation click grants. */
export function resolveReadableControls(_adapterVersion: string): readonly TargetControl[] {
  return []
}

export function isCompiledTargetControl(adapterVersion: string, control: TargetControl, action: 'read' | 'readonly-click' | 'click' | 'type' | 'select'): boolean {
  return adapterVersion === 'bjysoft-v2-template.1' && isAuditedV2TemplateControl(control, action)
}

/** A submit is identified by main-owned compiled evidence, not a worker flag. */
export function isCompiledSubmitControl(adapterVersion: string, control: TargetControl): boolean {
  return adapterVersion === 'bjysoft-v2-template.1' && sameTargetControl(control, { css: V2_TEMPLATE_OBSERVED_FORM.saveCss })
}

export function sameTargetControl(left: TargetControl, right: TargetControl): boolean {
  return left.css === right.css && left.frameCss === right.frameCss && left.framePath === right.framePath
    && left.scopeCss === right.scopeCss && left.exactText === right.exactText
    && left.scopeMatch?.css === right.scopeMatch?.css && left.scopeMatch?.exactText === right.scopeMatch?.exactText
}
