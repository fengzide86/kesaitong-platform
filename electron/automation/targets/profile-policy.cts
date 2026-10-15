import { createHash, createPublicKey, verify } from 'node:crypto'
import { isIP } from 'node:net'
import { signedTargetProfileSchema, type SignedTargetProfile, type TargetProfile, TARGET_ADAPTER_VERSION } from '../../../src/shared/ipc/target-contract.js'

export const targetError = (code: string, message: string): Error & { code: string } => Object.assign(new Error(`${code}: ${message}`), { code })
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export const targetHash = (value: unknown): string => createHash('sha256').update(stableJson(value)).digest('hex')
export function checkedUrl(raw: string): URL {
  let url: URL
  try { url = new URL(raw) } catch { throw targetError('TARGET_URL_INVALID', '请输入有效平台入口网址') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname || /sellercentral\.amazon|sellercenter\.aliexpress/i.test(url.hostname)) {
    throw targetError('TARGET_URL_BLOCKED', '只支持已选择的教学平台 HTTP/HTTPS 入口，不能打开真实电商后台')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const parts = host.split('.').map(Number)
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.')
      || (isIP(host) === 4 && (parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0]! >= 224 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) || (parts[0] === 192 && parts[1] === 168)))
      || isIP(host) === 6) throw targetError('TARGET_URL_BLOCKED', '当前入口接入仅支持公网域名或公网 IPv4；本机与内网地址不在首期范围')
  return url
}
export function redactedUrl(raw: string): string { const u = checkedUrl(raw); return `${u.origin}${u.pathname}` }
export function routeAllowed(raw: string, profile: TargetProfile, role?: 'entry' | 'login' | 'business'): boolean {
  let u: URL
  try { u = checkedUrl(raw) } catch { return false }
  let pathname: string
  try { pathname = decodeURIComponent(u.pathname) } catch { return false }
  if (pathname.includes('\\') || pathname.includes('//') || /%[0-9a-f]{2}/i.test(pathname)) return false
  return profile.allowedRoutes.some(rule => {
    const prefix = rule.pathPrefix.replace(/\/$/, '') || '/'
    return (!role || rule.role === role) && u.origin === rule.origin
      && (prefix === '/' || pathname === prefix || pathname.startsWith(`${prefix}/`))
  })
}
export function verifyTargetProfile(value: unknown, publicKeyB64: string, requireCapability = true): SignedTargetProfile {
  const signed = signedTargetProfileSchema.parse(value)
  if (!signed.signature || !publicKeyB64) throw targetError('TARGET_SIGNATURE_MISSING', '入口配置尚未签名，不能执行')
  try {
    const raw = Buffer.from(publicKeyB64, 'base64')
    if (raw.length !== 32) throw new Error('key')
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' })
    if (!verify(null, Buffer.from(stableJson(signed.profile)), key, Buffer.from(signed.signature, 'base64'))) throw new Error('signature')
  } catch { throw targetError('TARGET_SIGNATURE_INVALID', '入口配置签名无效') }
  const p = signed.profile
  if (p.reviewStatus !== 'approved' || (requireCapability && (p.edition !== 'v2' || p.adapterVersion !== TARGET_ADAPTER_VERSION || !p.capabilities.includes('template.create.v1')))) {
    throw targetError('TARGET_NOT_APPROVED', '入口尚未通过 V2 配送模板能力审核')
  }
  if (redactedUrl(p.entryUrl) !== p.entryUrl || !routeAllowed(p.entryUrl, p, 'entry')) throw targetError('TARGET_ROUTE_INVALID', '入口配置范围不一致')
  for (const route of p.allowedRoutes) {
    if (checkedUrl(route.origin).origin !== route.origin || !route.pathPrefix.startsWith('/') || route.pathPrefix.includes('?') || route.pathPrefix.includes('#') || route.pathPrefix.includes('%') || route.pathPrefix.includes('\\')) throw targetError('TARGET_ROUTE_INVALID', '入口路径配置无效')
  }
  return signed
}
