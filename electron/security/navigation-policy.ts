import { isAuditedV2Origin } from './v2-origin.js'

export function isAllowedMainFrameUrl(url: string, allowDevelopmentOrigin = false): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) return false
    if (parsed.protocol === 'app:' && parsed.hostname === 'toolbox') return true
    return allowDevelopmentOrigin
      && parsed.protocol === 'http:'
      && parsed.hostname === 'localhost'
      && parsed.port === '3000'
  } catch {
    return false
  }
}

const REAL_COMMERCE_HOST_MARKERS = [
  'sellercentral.amazon',
  'sellercenter.aliexpress',
] as const

export function isRealCommerceHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  return REAL_COMMERCE_HOST_MARKERS.some(marker =>
    normalized === marker
    || normalized.startsWith(`${marker}.`)
    || normalized.includes(`.${marker}.`),
  )
}

export function isAllowedExternalUrl(url: string, blockRealCommerceHosts = false): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
      && !parsed.username
      && !parsed.password
      && (!blockRealCommerceHosts || !isRealCommerceHost(parsed.hostname))
  } catch {
    return false
  }
}

export function isAllowedWebviewUrl(url: string): boolean {
  if (url === 'about:blank') return true
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) return false
    if (parsed.protocol === 'https:') return true
    if (isAuditedV2Origin(parsed)) return true
    return parsed.protocol === 'http:'
      && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
  } catch {
    return false
  }
}

export function isAllowedWebviewPartition(partition: string | undefined): boolean {
  // Persistent owner profiles require a main-process grant in main-window.
  return typeof partition === 'string' && /^batch-[A-Za-z0-9_-]+$/.test(partition)
}
