import { z } from 'zod'
import { quoteFreight } from '../../src/shared/freight/rate-engine.js'
import type { FreightQuoteRequest, FreightQuoteResult, FreightRatePack } from '../../src/shared/freight/types.js'
import { TOOL_PHASES, type RuntimeContext } from '../../src/shared/ipc/toolkit-contract.js'
import type { ToolStages } from './toolkit-runtime.cjs'
import { templateCreateInputSchema, type TemplateCreateInput, type ProbeObservation, type TargetProfile, type RunPlan } from '../../src/shared/ipc/target-contract.js'
import { buildTargetPlan, assertPlanContext } from './targets/run-plan.cjs'
import { probeContext } from './targets/v2-probe.cjs'
import { createV2Template, reconcileV2Template } from './targets/v2-template.cjs'
import type { TargetBrowserPort, TemplateJournal, TemplateVerification, V2TemplateUiBinding } from './targets/contracts.cjs'

const freightInput: z.ZodType<FreightQuoteRequest> = z.object({
  country: z.string().trim().min(1).max(100), actualWeightKg: z.number().positive().finite(),
  dimensionsCm: z.object({ length: z.number().positive(), width: z.number().positive(), height: z.number().positive() }).strict().optional(),
  exchangeRateCnyPerUsd: z.number().positive().optional(),
}).strict()

export function freightTool(pack: FreightRatePack, detect: () => Promise<RuntimeContext>): ToolStages<FreightQuoteRequest, FreightRatePack, { ratePackVersion: string }, FreightQuoteResult> {
  const calculate = (input: FreightQuoteRequest) => quoteFreight(pack, input)
  return {
    descriptor: { schemaVersion: 1, id: 'freight.quote', version: '1.0.0', capability: 'freight.quote', effect: 'calculation', supportedModes: ['training', 'competition', 'local'], phases: [...TOOL_PHASES] },
    input: freightInput,
    result: z.custom<FreightQuoteResult>(value => !!value && typeof value === 'object' && 'ratePackVersion' in value && Array.isArray((value as FreightQuoteResult).candidates)),
    detect, read: async () => pack, plan: async (_context, _input, data) => ({ ratePackVersion: data.version }),
    execute: async (_context, input) => calculate(input),
    verify: async (_context, input, plan, result) => plan.ratePackVersion === pack.version && JSON.stringify(result) === JSON.stringify(calculate(input)),
    reconcile: async (_context, input) => calculate(input),
  }
}

/** Uses the existing independently reviewed V2 adapter, not a new remote script.
 * Its training-only signed profile checks stay in both plan and execution. */
export function v2TemplateTool(options: { browser: TargetBrowserPort; profile: TargetProfile; binding: V2TemplateUiBinding; journal: TemplateJournal; detect: () => Promise<RuntimeContext> }): ToolStages<TemplateCreateInput, ProbeObservation, RunPlan, TemplateVerification> {
  return {
    descriptor: { schemaVersion: 1, id: 'template.create', version: '1.0.0', capability: 'template.create.v1', effect: 'write', supportedModes: ['training'], phases: [...TOOL_PHASES] },
    input: templateCreateInputSchema,
    result: z.custom<TemplateVerification>(value => !!value && typeof value === 'object' && (value as TemplateVerification).verification === 'same-object-list-and-details' && Number.isSafeInteger((value as TemplateVerification).templateId)),
    detect: options.detect,
    read: async () => probeContext(options.browser),
    plan: async (_context, input, observed) => buildTargetPlan({ profileId: options.profile.id, profileRevision: options.profile.revision, toolId: 'template.create', scenario: 'training', stage: 'not_applicable', input }, options.profile, observed),
    execute: async (_context, input, plan, beforeMutation) => {
      const observed = await probeContext(options.browser)
      assertPlanContext(plan, options.profile, observed)
      await beforeMutation()
      return createV2Template(options.browser, observed, input, options.journal, options.binding)
    },
    verify: async (_context, input, _plan, result) => {
      const checked = await reconcileV2Template(options.browser, await probeContext(options.browser), input, options.binding, result.templateId)
      return checked.status === 'verified' && checked.receipt.templateId === result.templateId
    },
    reconcile: async (_context, input, plan, result) => {
      const observed = await probeContext(options.browser)
      assertPlanContext(plan, options.profile, observed)
      const checked = await reconcileV2Template(options.browser, observed, input, options.binding, result?.templateId)
      return checked.status === 'verified' ? checked.receipt : null
    },
  }
}
