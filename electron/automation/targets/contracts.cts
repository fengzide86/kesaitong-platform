/** Internal main-process contracts. None of the browser payloads are renderer IPC. */
import type { ProbeObservation, TemplateCreateInput } from '../../../src/shared/ipc/target-contract.js'
import type { VerifiedLocalContext } from './verified-context.cjs'
export type { ProbeObservation, TemplateCreateInput }

/** Allowlisted fields only: no passwords, complete URL, paras, cookie or token. */
export interface BrowserSnapshot {
  origin: string
  path: string
  v2Marker: boolean
  v3Marker: boolean
  amazonMarker: boolean
  amazonRoute: boolean
  loginVisible: boolean
  templateDom: boolean
  courseDom: boolean
  /** accountId is reserved for an independently verified identity read; current production probe does not populate it. */
  context: { courseId?: string; shopId?: string; companyId?: string; roleCode?: string; accountId?: string }
  controls: string[]
  /** Added by the owned main process only, never read from the target page. */
  verifiedContext?: VerifiedLocalContext
}

export const TEMPLATE_API_PATHS = [
  '/ECrossAmazon/GetTemplateList',
  '/ECrossAmazon/GetFeightRelationList',
  '/ECrossAmazon/SaveTemplate',
] as const
export type TemplateApiPath = typeof TEMPLATE_API_PATHS[number]
export interface TemplateExchange {
  method: 'POST'
  origin: string
  path: TemplateApiPath
  httpStatus: number
  /** Ephemeral, main-process only. Parsers discard every unrecognised field. */
  body: unknown
  requestFields: { courseId?: string; shopId?: string; ds0701?: string; templateName?: string }
}

export interface TargetControl {
  /** Only an audited, compiled-in binding may provide these selectors. */
  css: string
  frameCss?: string
  /** Actual same-origin frame pathname, not a substring of an iframe URL. */
  framePath?: string
  /** The enclosing visible container must itself match exactly once. */
  scopeCss?: string
  /** Match exactly one visible enclosing row by its own unique child text. */
  scopeMatch?: { css: string; exactText: string }
  /** Normalised visible text; never first()/nth() to resolve ambiguity. */
  exactText?: string
}
export interface TargetControlState {
  tagName: string
  text: string
  disabled: boolean
  value?: string
  checked?: boolean
  options?: Array<{ value: string; text: string; disabled: boolean }>
}
export interface TargetBrowserPort {
  readonly kind: 'owned-webcontents' | 'fixture'
  inspect(): Promise<BrowserSnapshot>
  readControl(control: TargetControl): Promise<TargetControlState>
  readControls(control: TargetControl): Promise<TargetControlState[]>
  waitForControl(control: TargetControl): Promise<TargetControlState>
  click(control: TargetControl): Promise<void>
  typeAndBlur(control: TargetControl, value: string): Promise<void>
  select(control: TargetControl, value: string): Promise<void>
  captureResponse(path: TemplateApiPath, action: () => Promise<void>, match?: { templateId: number }): Promise<TemplateExchange>
  reload(): Promise<void>
  dispose(): void
}

export interface TemplateListEntry { id: number; name: string; isDefault: boolean }
export interface TemplateRule {
  id: number
  serviceCode: string
  regionText: string
  transitTime: string
  perOrder: string
  unitRate: string
  unit: 'item' | 'lb'
}
export interface TemplateDetails {
  id: number
  name: string
  pricingMode: 'weight-item'
  rules: TemplateRule[]
}
export interface TemplateVerification {
  templateId: number
  name: string
  ruleCount: number
  verification: 'same-object-list-and-details'
  evidence: Array<{ method: 'POST'; path: TemplateApiPath; httpStatus: number; code: 0 }>
}
export type TemplateReconciliation = { status: 'verified'; receipt: TemplateVerification } | { status: 'not_found' }
export interface TemplateJournal {
  /** Durable permission to edit a draft; does not mean the business save began. */
  beforeMutation(): Promise<void>
  verified(receipt: TemplateVerification): Promise<void>
}
/** Host-only boundary; deliberately absent from the worker RPC vocabulary. */
export interface HostTemplateJournal extends TemplateJournal {
  beforeSubmit(): Promise<void>
}

/** Not an arbitrary remote selector payload. The implementation lives in signed client code. */
export interface V2TemplateUiBinding {
  readonly id: string
  readonly verificationLevel: 'audited-ui' | 'fixture-only'
  readonly evidenceSources: readonly string[]
  assertSupportedInput?(input: TemplateCreateInput): void
  readList(browser: TargetBrowserPort): Promise<TemplateExchange>
  fillDraft(browser: TargetBrowserPort, input: TemplateCreateInput): Promise<void>
  save(browser: TargetBrowserPort): Promise<void>
  readDetails(browser: TargetBrowserPort, templateId: number): Promise<TemplateExchange>
  /** Countries must be confirmed from the actual region UI; never split an unknown DS0810 delimiter. */
  regionMatches(actualRegionText: string, expectedCountries: readonly string[]): boolean
  assertCurrencyAndUnits(browser: TargetBrowserPort, input: TemplateCreateInput): Promise<void>
}

export function targetError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}
