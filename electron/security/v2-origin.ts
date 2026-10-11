/** Shared by actual WebView navigation and Runner target validation. */
export function isAuditedV2Origin(url: URL): boolean {
  return ['http:', 'https:'].includes(url.protocol)
    && !url.username && !url.password
    && url.hostname.toLowerCase().replace(/\.$/, '') === 'www.bjysoft.cn'
    && ['8730', '8732'].includes(url.port)
}
