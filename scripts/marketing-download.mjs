/* global fetch, AbortSignal */
import { createRequire } from 'node:module'
import { URL } from 'node:url'
import { installerFromManifest, publicHttpsUrl } from './marketing-config.mjs'

const require = createRequire(import.meta.url)
// Parse with the pinned updater's own YAML dependency, not a second parser or
// a regex that could take the size of a different file in the manifest.
const { load, JSON_SCHEMA } = createRequire(require.resolve('electron-updater/package.json'))('js-yaml')
const installerMimeTypes = new Set(['application/octet-stream', 'application/x-msdownload', 'application/vnd.microsoft.portable-executable'])

export function marketingInstallerFromManifest(text, controlUrl, expectedVersion) {
  if (typeof text !== 'string' || text.length > 64 * 1024) throw new Error('正式下载清单大小无效')
  let manifest
  try { manifest = load(text, { schema: JSON_SCHEMA }) } catch { throw new Error('正式下载清单无法解析') }
  if (!manifest || typeof manifest !== 'object' || !/^\d+\.\d+\.\d+$/.test(manifest.version || '')) throw new Error('正式下载清单版本无效')
  const version = expectedVersion || manifest.version
  const installerUrl = installerFromManifest(text, controlUrl, version)
  const matches = Array.isArray(manifest.files) ? manifest.files.filter(file => file?.url === manifest.path) : []
  if (matches.length !== 1 || !Number.isSafeInteger(matches[0].size) || matches[0].size <= 0) throw new Error('正式下载清单缺少唯一安装包大小')
  return { version: manifest.version, installerUrl, expectedSize: matches[0].size }
}

// Every invocation reads current publication state. Call again immediately
// before publishing so an immutable old URL cannot hide a concurrent release.
export async function getPublishedMarketingDownload({ controlUrl, expectedVersion, configuredUrl = '', request = fetch }) {
  const origin = publicHttpsUrl(controlUrl, 'controlUrl', { originOnly: true })
  const response = await request(new URL('/updates/latest.yml', origin).href, {
    method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000),
  })
  if (response.status !== 200) throw new Error(`无法取得当前正式下载清单：HTTP ${response.status}`)
  const installer = marketingInstallerFromManifest(await response.text(), origin, expectedVersion)
  const verified = await verifyMarketingDownload({ controlUrl: origin, ...installer, configuredUrl, request })
  return { ...verified, version: installer.version }
}

// The website stays static. Resolve and validate redirects at build/release
// time, never by fetching the business API from a visitor's browser.
export async function verifyMarketingDownload({ controlUrl, installerUrl, expectedSize, configuredUrl = '', request = fetch }) {
  if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0) throw new Error('需要正式清单中的安装包大小')
  const origin = publicHttpsUrl(controlUrl, 'controlUrl', { originOnly: true })
  const expected = publicHttpsUrl(installerUrl, 'installerUrl')
  const stable = new URL('/updates/latest.exe', origin).href
  const selected = configuredUrl ? publicHttpsUrl(configuredUrl, 'downloadUrl') : stable
  if (new URL(expected).origin !== origin || !new URL(expected).pathname.startsWith('/updates/')
    || expected === stable || !new URL(expected).pathname.endsWith('.exe')) throw new Error('清单安装包必须来自受信更新源')
  if (![expected, stable].includes(selected)) throw new Error('下载入口必须是当前正式安装包或同源稳定入口；拒绝旧包和外部地址')
  const head = url => request(url, { method: 'HEAD', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30_000) })
  if (selected === stable) {
    const redirect = await head(stable)
    if (![302, 303, 307, 308].includes(redirect.status)) throw new Error('稳定下载入口必须显式跳转到已发布安装包')
    if (!/(?:^|,)\s*no-store\s*(?:,|$)/i.test(redirect.headers.get('cache-control') || '')) throw new Error('稳定下载入口不得缓存旧版本')
    const location = redirect.headers.get('location')
    if (!location) throw new Error('稳定下载入口缺少跳转目标')
    const target = publicHttpsUrl(new URL(location, stable).href, 'redirect')
    if (target !== expected) throw new Error('稳定入口与正式清单不一致，或跳转到了不受信地址')
  }
  // Follow only the explicitly verified version URL, not an arbitrary chain.
  const response = await head(expected)
  if (response.status !== 200) throw new Error(`正式安装包不可用：HTTP ${response.status}`)
  const size = Number(response.headers.get('content-length'))
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!Number.isSafeInteger(size) || size !== expectedSize || !installerMimeTypes.has(mime)) throw new Error('正式安装包大小或文件类型与清单不一致')
  return { downloadUrl: selected, installerUrl: expected, size }
}
