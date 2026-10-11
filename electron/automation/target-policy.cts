/** Exact audited V2 origin allowance; no catch-all access to a live seller. */
import { isAuditedV2Origin } from '../security/v2-origin.js';
interface TargetPolicyError extends Error { code?: string }

function rejectTarget(code: string, message: string): never {
  const error: TargetPolicyError = new Error(message);
  error.code = code;
  throw error;
}

function assertAllowedTarget(targetUrl: string, allowedHosts: string[]): void {
  const url = new URL(targetUrl);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) rejectTarget('TARGET_HOST_NOT_ALLOWED', '目标协议或认证信息不受支持');
  const allowed = allowedHosts.some(host => host === 'www.bjysoft.cn'
    ? isAuditedV2Origin(url)
    : hostname === host || hostname.endsWith(`.${host}`));
  if (!allowed) rejectTarget('TARGET_HOST_NOT_ALLOWED', `当前适配器不允许访问该域名：${hostname}`);
  if (/sellercentral\.amazon|sellercenter\.aliexpress/i.test(hostname)) {
    rejectTarget('REAL_COMMERCE_HOST_BLOCKED', '比赛模拟平台适配器禁止在真实电商后台运行');
  }
}

module.exports = { assertAllowedTarget };
