import fs from 'node:fs'
import process from 'node:process'
import { URL } from 'node:url'
import os from 'node:os'
import path from 'node:path'

const fields = ['KST_MARKETING_PROVIDER', 'GITHUB_PAGES_REPOSITORY', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_PAGES_PROJECT', 'KST_MARKETING_SITE_URL', 'VITE_DESKTOP_DOWNLOAD_URL']

export function readMarketingEnvironment(root, environment = process.env) {
  const filename = path.join(root, '.env.marketing.local')
  const result = {}
  if (fs.existsSync(filename)) {
    for (const raw of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const index = line.indexOf('=')
      if (index < 1) continue
      const key = line.slice(0, index).trim()
      let value = line.slice(index + 1).trim()
      if (!fields.includes(key)) continue
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
      result[key] = value
    }
  }
  for (const key of fields) if (environment[key]) result[key] = environment[key]
  return result
}

export function publicHttpsUrl(value, name, { originOnly = false } = {}) {
  let url
  try { url = new URL(value) } catch { throw new Error(`${name} 必须是完整 HTTPS 地址`) }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
    || (originOnly && url.pathname !== '/')) throw new Error(`${name} 必须是无凭据、无查询参数的公开 HTTPS ${originOnly ? '站点根地址' : '地址'}`)
  return originOnly ? url.origin : url.href
}

export function validateMarketingConfig(values) {
  const provider = values.KST_MARKETING_PROVIDER || 'cloudflare'
  if (!['cloudflare', 'github-pages'].includes(provider)) throw new Error('未知官网发布渠道')
  const publicUrl = publicHttpsUrl(values.KST_MARKETING_SITE_URL, 'KST_MARKETING_SITE_URL', { originOnly: true })
  const downloadUrl = values.VITE_DESKTOP_DOWNLOAD_URL ? publicHttpsUrl(values.VITE_DESKTOP_DOWNLOAD_URL, 'VITE_DESKTOP_DOWNLOAD_URL') : ''
  if (provider === 'github-pages') {
    const repository = values.GITHUB_PAGES_REPOSITORY || ''
    const match = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\/([a-z0-9-]+\.github\.io)$/i.exec(repository)
    const siteUrl = new URL(publicUrl)
    const hostname = siteUrl.hostname
    if (!match || match[2].toLowerCase() !== `${match[1].toLowerCase()}.github.io`
      || ((hostname === 'github.io' || hostname.endsWith('.github.io')) && hostname !== match[2].toLowerCase())) {
      throw new Error('GitHub Pages 仅支持明确匹配的用户官网仓库，不接受其他用户的 github.io 地址')
    }
    if (siteUrl.port || (hostname !== match[2].toLowerCase() && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/i.test(hostname))) {
      throw new Error('GitHub Pages 自定义网址必须使用有效的公开域名')
    }
    return { provider, repository, projectName: repository, publicUrl, downloadUrl }
  }
  if (!/^[a-f0-9]{32}$/i.test(values.CLOUDFLARE_ACCOUNT_ID || '')) throw new Error('请在 .env.marketing.local 配置 Cloudflare Account ID')
  if (!/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$/.test(values.CLOUDFLARE_PAGES_PROJECT || '')) throw new Error('Cloudflare Pages 项目名无效')
  return {
    provider,
    accountId: values.CLOUDFLARE_ACCOUNT_ID,
    projectName: values.CLOUDFLARE_PAGES_PROJECT,
    publicUrl,
    downloadUrl,
  }
}

export function assertGitHubPagesProject(pages, config) {
  const hostname = new URL(config.publicUrl).hostname
  const userHostname = config.repository.split('/')[1].toLowerCase()
  const expectedCname = hostname === userHostname ? null : hostname
  const cname = typeof pages.cname === 'string' ? pages.cname.trim().toLowerCase() : pages.cname
  if (pages.html_url?.replace(/\/$/, '') !== config.publicUrl || pages.source?.branch !== 'main'
    || pages.source?.path !== '/' || pages.build_type !== 'legacy'
    || (expectedCname ? cname !== expectedCname : Boolean(cname))) {
    throw new Error('GitHub Pages 网址、已绑定自定义域名或 main 根目录发布来源不匹配；不会改动远端站点配置')
  }
}

export function marketingToolEnvironment(environment = process.env) {
  const dataRoot = path.resolve(environment.TOOLBOX_DATA_ROOT || (process.platform === 'win32' ? 'D:/AmazonToolboxData' : path.join(os.tmpdir(), 'AmazonToolboxData')))
  return {
    ...environment,
    WRANGLER_SEND_METRICS: 'false',
    XDG_CONFIG_HOME: path.join(dataRoot, 'cloudflare', 'config'),
    XDG_CACHE_HOME: path.join(dataRoot, 'cloudflare', 'cache'),
    WRANGLER_LOG_PATH: path.join(dataRoot, 'cloudflare', 'logs'),
  }
}

export function installerFromManifest(text, controlUrl, expectedVersion) {
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text)?.[1]
  if (version !== expectedVersion) throw new Error(`请先正式发布系统 ${expectedVersion}；当前桌面清单为 ${version || '未知'}`)
  const filename = /^path:\s*(.+?)\s*$/m.exec(text)?.[1]?.replace(/^['"]|['"]$/g, '')
  if (!filename || !filename.endsWith('.exe') || filename.includes('..') || /[\\/:?#]/.test(filename)) throw new Error('已发布桌面清单的安装包文件名无效')
  return new URL(`/updates/${encodeURIComponent(filename)}`, controlUrl).href
}

export function assertMarketingMetadata(metadata, expected) {
  for (const field of ['version', 'commitSha', 'publicUrl', 'downloadUrl']) {
    if (metadata[field] !== expected[field]) throw new Error(`官网元数据 ${field} 与本次发布不一致`)
  }
}

export function assertPagesProject(projects, projectName, publicUrl) {
  // Wrangler 4 emits presentation rows, not the raw Cloudflare API schema.
  const project = Array.isArray(projects) ? projects.find(item => item['Project Name'] === projectName) : undefined
  if (!project) {
    throw new Error('Cloudflare Pages 项目不存在或当前账号不可访问；请先完成账号项目配置')
  }
  const domains = String(project['Project Domains'] || '').split(',').map(domain => domain.trim().toLowerCase())
  if (!domains.includes(new URL(publicUrl).hostname.toLowerCase())) {
    throw new Error('官网公开地址尚未绑定到该 Pages 项目；请先完成域名接入，不会上传到错误站点')
  }
}
