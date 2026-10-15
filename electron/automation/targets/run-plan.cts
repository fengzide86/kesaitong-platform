import { randomUUID } from 'node:crypto'
import { operationContextSchema, runPlanSchema, TARGET_ADAPTER_VERSION, TARGET_TEMPLATE_CAPABILITY, type OperationContext, type ProbeObservation, type RunPlan, type TargetPreflightRequest, type TargetProfile } from '../../../src/shared/ipc/target-contract.js'
import { routeAllowed, targetError, targetHash } from './profile-policy.cjs'

/** Fixed capability recipe: remote values cannot contain code or selectors. */
export const TEMPLATE_RECIPE = Object.freeze({
  id: 'template.create', version: '1.0.0', adapter: TARGET_ADAPTER_VERSION,
  capability: TARGET_TEMPLATE_CAPABILITY,
  steps: ['核对入口、版本与当前课程店铺', '读取模板并检查重名', '保存提交前本机记录', '填写并保存一份配送模板', '按同一模板标识回读规则', '保存一致性核验结果'],
})
const templatePaths = { templateList: '/ECrossAmazon/SellerShippingTemplateSetting', templateEditor: '/ECrossAmazon/SellerShippingTemplateSettingAdd' } as const
type TemplatePage = keyof typeof templatePaths

/** Distinct pages have distinct signed structural fingerprints. Never use the
 * entry/map fingerprint as an account ID or simply skip it after navigation. */
function assertPageStructure(profile: TargetProfile, probe: ProbeObservation, allowed: readonly TemplatePage[]): void {
  const fingerprints = profile.evidence.pageFingerprints
  if (!fingerprints?.courseMap || !fingerprints.templateList || !fingerprints.templateEditor) throw targetError('TARGET_STRUCTURE_EVIDENCE_MISSING', '入口尚缺课程地图、模板列表与编辑页的分别验收证据。')
  const page = allowed.find(key => templatePaths[key] === probe.path)
  if (!page || fingerprints[page] !== probe.pageFingerprint) throw targetError('TARGET_STRUCTURE_CHANGED', '当前页面结构与该步骤的已审核证据不一致，不能沿用旧定位。')
}

function checkedContext(request: TargetPreflightRequest, profile: TargetProfile, probe: ProbeObservation, pages: readonly TemplatePage[]): OperationContext {
  if (profile.id !== request.profileId || profile.revision !== request.profileRevision) throw targetError('TARGET_REVISION_CHANGED', '入口配置已更新，请重新识别和预检')
  if (probe.kind !== 'matched' || probe.version !== 'v2' || probe.missing.length || !probe.localAccountRef || !probe.courseRef || !probe.shopRef || !probe.role
    || !probe.evidence.includes('verified-local-identity')) throw targetError('TARGET_CONTEXT_INCOMPLETE', '版本、账号、课程或店铺证据不足，请先进入已验收的业务现场')
  if (!routeAllowed(`${probe.origin}${probe.path}`, profile, 'business')) throw targetError('TARGET_ROUTE_BLOCKED', '当前页面不在已审核业务范围内')
  assertPageStructure(profile, probe, pages)
  // A user declaring "training" cannot turn an unknown/formal environment into
  // a training deployment. Only this signed, independently reviewed course is
  // permitted in v1. Unknown/V3/competition retain a closed execution gate.
  const scopes = (profile.executionScopes ?? []).filter(scope => scope.courseRef === probe.courseRef && scope.source === 'admin-verified'
    && scope.scenario === 'training' && scope.stage === 'not_applicable')
  if (request.scenario !== 'training' || request.stage !== 'not_applicable' || scopes.length !== 1) throw targetError('TARGET_SCENARIO_UNVERIFIED', '本课程缺少已审核的实训场景范围；用户选择实训不能作为比赛阶段或提交权限的证明。')
  return operationContextSchema.parse({ profileId: profile.id, profileRevision: profile.revision, edition: 'v2', scenario: request.scenario, stage: request.stage,
    localAccountRef: probe.localAccountRef, courseRef: probe.courseRef, shopRef: probe.shopRef, role: probe.role })
}

export function buildTargetPlan(request: TargetPreflightRequest, profile: TargetProfile, probe: ProbeObservation, now = Date.now()): RunPlan {
  const context = checkedContext(request, profile, probe, ['templateList'])
  return runPlanSchema.parse({ id: randomUUID(), schemaVersion: 1, context, contextHash: targetHash(context), inputHash: targetHash(request.input),
    adapterVersion: TARGET_ADAPTER_VERSION, recipeId: TEMPLATE_RECIPE.id, recipeVersion: TEMPLATE_RECIPE.version,
    rulePackVersion: 'user-template-1', capability: TARGET_TEMPLATE_CAPABILITY, input: request.input,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 10 * 60_000).toISOString() })
}
export function assertPlanContext(plan: RunPlan, profile: TargetProfile, probe: ProbeObservation, now = Date.now()): void {
  if (Date.parse(plan.expiresAt) <= now) throw targetError('TARGET_PLAN_EXPIRED', '预检计划已过期，请重新确认本次范围')
  if (plan.context.courseRef !== probe.courseRef || plan.context.shopRef !== probe.shopRef || plan.context.localAccountRef !== probe.localAccountRef || plan.context.role !== probe.role) throw targetError('TARGET_CONTEXT_CHANGED', '当前账号、课程、店铺或角色已变化，已阻止执行。')
  const current = checkedContext({ profileId: plan.context.profileId, profileRevision: plan.context.profileRevision, toolId: 'context-only', scenario: plan.context.scenario, stage: plan.context.stage, input: plan.input }, profile, probe, ['templateList', 'templateEditor'])
  if (targetHash(current) !== plan.contextHash || targetHash(plan.input) !== plan.inputHash) throw targetError('TARGET_CONTEXT_CHANGED', '当前账号、课程、阶段或对象与预检不一致，已阻止执行')
}
