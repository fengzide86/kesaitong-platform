/** Display helpers only. The main process remains the compatibility boundary. */
import { TARGET_RUNNER_API_VERSION, TARGET_TEMPLATE_CAPABILITY, type TargetProfile } from '@/shared/ipc/target-contract'
export const editionLabels: Record<string, string> = { v2: 'V2', v3: 'V3', unknown: '版本待识别' }
export const reviewLabels: Record<string, string> = { pending: '待团队审核', approved: '已审核', rejected: '未通过', disabled: '已停用' }
export const scenarioLabels: Record<string, string> = { training: '实训', competition: '比赛' }
export const stageLabels: Record<string, string> = { practice: '比赛练习（用户声明）', formal: '正式比赛（用户声明）', unknown: '阶段待确认', not_applicable: '不适用' }

interface TargetCatalogFields { requires_target_profile?: unknown; target_capability?: unknown; runner_api_version?: unknown }
export function requiresTargetProfile(tool: TargetCatalogFields): boolean {
  return Boolean(tool.requires_target_profile || tool.target_capability || Number(tool.runner_api_version) >= TARGET_RUNNER_API_VERSION)
}
export function supportsTargetWorkspace(tool: TargetCatalogFields): boolean {
  return requiresTargetProfile(tool) && tool.target_capability === TARGET_TEMPLATE_CAPABILITY
    && (tool.runner_api_version == null || Number(tool.runner_api_version) === TARGET_RUNNER_API_VERSION)
}

export function displayEntry(value: string): string {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '无效入口'
    return `${url.origin}${url.pathname}`
  } catch { return '无效入口' }
}

export function targetError(error: unknown): string {
  // Do not echo credentials or a complete signed platform URL from host errors.
  const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 0
  const message = status === 404
    ? '云端尚未启用平台入口登记/审核服务，请先更新服务端后再提交；不要重复提交。'
    : status === 403
      ? '当前账号没有平台入口审核权限，请使用具备审核权限的管理员账号。'
      : status === 401
        ? '登录状态已过期，请刷新并重新登录后再读取入口状态。'
        : error instanceof Error ? error.message : '操作未完成，请重新读取状态。'
  return message.replace(/https?:\/\/[^\s<>"']+/g, match => displayEntry(match))
    .replace(/\b(?:cookie|token|password|authorization|paras)\s*[:=]\s*[^\s,;]+/gi, '[认证内容已隐藏]')
}

export function splitLines(value: string): string[] {
  return [...new Set(value.split(/[\r\n]+/).map(item => item.trim()).filter(Boolean))]
}

export function reviewedMarkerNames(evidence: string[]): TargetProfile['evidence']['markers'] {
  const map: Record<string, TargetProfile['evidence']['markers'][number]> = {
    'explicit-v2-marker': 'amazon-v2', 'verified-v2-logo': 'amazon-v2', 'explicit-v3-marker': 'amazon-v3',
    'template-controls-observed': 'seller-shipping-template', 'course-navigation-observed': 'course-index',
    'amazon-v2': 'amazon-v2', 'amazon-v3': 'amazon-v3', 'seller-shipping-template': 'seller-shipping-template', 'course-index': 'course-index',
  }
  return [...new Set(evidence.flatMap(value => map[value] ? [map[value]!] : []))]
}

export function missingEvidenceLabel(code: string): string {
  const labels: Record<string, string> = {
    'conflicting-version-markers': '页面包含相互冲突的版本标识，需团队核对兼容范围。',
    'explicit-platform-version-marker': '尚未取得明确的技术版本标识，不能仅凭网址判断。',
    'amazon-brand-and-route': '尚未确认这是亚马逊仿真页面，请从正确产品入口进入。',
    'recognised-page-shape': '当前页面结构尚未适配，需补齐页面识别证据。',
    'course-context': '尚未识别当前课程或赛事。请自行选择课程并进入带 Amazon / 国内仓库入口的课程地图首页；课程列表不是就绪状态。',
    'shop-context': '尚未识别当前店铺，请进入目标卖家店铺后重新检测。',
    'account-identity-unverified': '尚未完成本次登录、个人设置与所选课程的交叉核对。仅重新登录不能证明已修复，还需重新识别且证据一致。',
    'role-context': '尚未确认当前业务角色，不能混用卖家、买家与仓库现场。',
  }
  return labels[code] || `识别条件尚未满足：${code}`
}
