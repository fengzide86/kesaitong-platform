import { createToolLaunchGrant } from '@/utils/api'
import { toolLaunchResponseSchema, type ToolCatalogItem } from '@/features/tools/model'
import type { ActiveTool } from '@/stores/app'

type UnknownRecord = Record<string, unknown>

function randomId(prefix: string): string {
  const value = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return `${prefix}_${value}`
}

export function isLiveTool(tool: ToolCatalogItem): boolean {
  return tool.supports_live_single === true
    && (tool.availability === 'live' || tool.availability === 'live_beta')
}

export function buildDemoLaunch(tool: ToolCatalogItem, platformKey: string, input: UnknownRecord = {}): ActiveTool {
  return {
    id: tool.id,
    name: tool.name,
    module: tool.module,
    category: tool.category,
    platformKey,
    capabilityKey: tool.capability_key,
    targetUrl: `demo://${platformKey}/${encodeURIComponent(String(tool.id))}`,
    executionMode: 'demo',
    scenarioId: tool.demo_scenario_id,
    demoRunId: randomId('demo_run_local'),
    scriptKey: tool.script_key,
    scriptStatus: tool.script_status,
    executionContext: { mode: 'single', sessionId: randomId('demo_session'), input },
  }
}

export function buildPreflightLaunch(tool: ToolCatalogItem, platformKey: string, input: UnknownRecord = {}): ActiveTool {
  return {
    id: tool.id,
    name: tool.name,
    module: tool.module,
    category: tool.category,
    platformKey,
    capabilityKey: tool.capability_key,
    scriptStatus: tool.script_status || 'script_not_ready',
    targetUrl: tool.target_url || '',
    executionMode: 'preflight',
    scriptKey: tool.script_key || `${platformKey}.${tool.capability_key || tool.id}.v1`,
    executionContext: { mode: 'single', sessionId: randomId('preflight_session'), input },
  }
}

export async function buildLiveLaunch(
  tool: Pick<ToolCatalogItem, 'id' | 'name' | 'module' | 'category' | 'platform_key' | 'capability_key'>,
  platformKey: string,
  input: UnknownRecord = {},
): Promise<ActiveTool> {
  const raw = await createToolLaunchGrant(tool.id, {
    platformKey,
    deviceId: window.electronAPI?.runtime?.deviceId,
    executionMode: 'single',
    idempotencyKey: randomId('single_attempt'),
  })
  const parsed = toolLaunchResponseSchema.parse(raw)
  const grant = parsed.launch_data || parsed.grant
  if (!grant?.token || !grant.target_url || !grant.script_key) throw new Error('真实工具启动授权不完整，请刷新工具列表后重试')
  return {
    id: tool.id,
    name: grant.tool_name || tool.name,
    module: grant.tool_module || tool.module,
    category: grant.category || tool.category,
    platformKey: grant.platform_key || tool.platform_key || platformKey,
    capabilityKey: tool.capability_key,
    targetUrl: grant.target_url,
    executionMode: 'live',
    scriptStatus: 'script_ready',
    scriptKey: grant.script_key,
    launchGrant: {
      token: grant.token,
      scriptKey: grant.script_key,
      runnerApiVersion: grant.runner_api_version,
      expiresAt: grant.expires_at || parsed.expires_at,
      expiresIn: parsed.expires_in,
      toolVersion: grant.tool_version,
      toolManifest: grant.tool_manifest,
      toolSignature: grant.tool_signature,
      signingKeyId: grant.signing_key_id,
      signatureRequired: grant.signature_required,
    },
    executionContext: { mode: 'single', sessionId: randomId('live_session'), input },
  }
}

export async function refreshLiveLaunch(tool: ActiveTool): Promise<ActiveTool> {
  if (!tool.id) throw new Error('当前工具信息不完整')
  const next = await buildLiveLaunch({
    id: tool.id,
    name: tool.name || '自动化工具',
    module: tool.module,
    category: tool.category || 'automation',
    platform_key: tool.platformKey,
    capability_key: tool.capabilityKey,
  }, tool.platformKey || 'amazon', tool.executionContext?.input || {})
  if (next.executionContext) next.executionContext.fileInputKeys = tool.executionContext?.fileInputKeys
  return next
}
