import fs from 'node:fs'
import path from 'node:path'
import { publicHttpsUrl } from './marketing-config.mjs'

const directRoutes = ['terms', 'user/terms', 'competition', 'course', 'tools']
const roots = new Set([
  'index.html', '404.html', '_headers', '_redirects', 'marketing-version.json', 'robots.txt', 'sitemap.xml',
  'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'pwa-512x512.png', '.nojekyll', 'CNAME',
  ...directRoutes.map(route => `${route}/index.html`),
])
const allowed = name => roots.has(name) || /^assets\/[\w.-]+-[\w-]{8,}\.(?:js|css|svg|png|jpe?g|webp|woff2?)$/i.test(name)
const allowedDirectories = new Set(['assets', ...directRoutes, 'user'])

// Called only on a fresh clone of the configured public, marketing-only repo.
// Retain its Git history, and reject unknown content before replacing any file.
export function prepareGitHubPagesTree(artifact, checkout, trackedFiles, publicUrl, { previousPublicUrl } = {}) {
  const targetOrigin = publicHttpsUrl(publicUrl, 'GitHub Pages publicUrl', { originOnly: true })
  const hostname = new URL(targetOrigin).hostname
  const customDomain = !hostname.endsWith('.github.io') && hostname !== 'github.io'
  if (previousPublicUrl !== undefined) {
    const previousOrigin = publicHttpsUrl(previousPublicUrl, 'previousPublicUrl', { originOnly: true })
    // Migration is explicit and one-directional: an existing user site to its
    // bound custom domain. This never allows swapping one github.io site for another.
    if (previousOrigin !== previousPublicUrl || !/^[a-z0-9-]+\.github\.io$/.test(new URL(previousOrigin).hostname) || !customDomain) {
      throw new Error('仅允许显式迁移既有用户官网到已绑定的自定义域名')
    }
  }
  const previous = JSON.parse(fs.readFileSync(path.join(checkout, 'marketing-version.json'), 'utf8'))
  if (previous.kind !== 'kst-marketing' || previous.sourcePolicy !== 'marketing-only-v1'
    || previous.publicUrl !== (previousPublicUrl ?? targetOrigin)) {
    throw new Error('目标仓库不是已验证的 KST 宣传站，拒绝覆盖')
  }
  for (const name of trackedFiles) {
    if (!allowed(name)) throw new Error(`官网仓库存在非发布文件，拒绝覆盖：${name}`)
    const absolute = path.resolve(checkout, name)
    if (!absolute.startsWith(`${path.resolve(checkout)}${path.sep}`) || fs.lstatSync(absolute).isSymbolicLink()) throw new Error('官网目标路径不安全')
  }
  const incoming = []
  function inspect(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name
      if (entry.isSymbolicLink()) throw new Error('官网制品不允许符号链接')
      if (entry.isDirectory()) {
        if (!allowedDirectories.has(relative)) throw new Error(`官网制品含未知目录：${relative}`)
        inspect(path.join(directory, entry.name), `${relative}/`)
      } else {
        if (!allowed(relative)) throw new Error(`官网制品含未知文件：${relative}`)
        incoming.push(relative)
      }
    }
  }
  inspect(artifact)
  for (const required of ['index.html', '404.html', 'marketing-version.json']) {
    if (!incoming.includes(required)) throw new Error(`官网制品缺少 ${required}`)
  }
  const incomingMetadata = JSON.parse(fs.readFileSync(path.join(artifact, 'marketing-version.json'), 'utf8'))
  if (incomingMetadata.kind !== 'kst-marketing' || incomingMetadata.sourcePolicy !== 'marketing-only-v1' || incomingMetadata.publicUrl !== targetOrigin) {
    throw new Error('官网制品来源或目标网址不匹配，拒绝覆盖')
  }
  // Check both tracked and untracked CNAME files before changing any file;
  // otherwise replacing the static tree could silently detach its custom domain.
  for (const directory of [checkout, artifact]) {
    const filename = path.join(directory, 'CNAME')
    let stat
    try { stat = fs.lstatSync(filename) } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('官网 CNAME 文件不安全')
    const existingHostname = fs.readFileSync(filename, 'utf8').trim().toLowerCase()
    if (!customDomain || existingHostname !== hostname) throw new Error('官网 CNAME 与目标域名不匹配，拒绝覆盖')
  }
  // Single files in this fresh disposable clone only; remote history is intact.
  for (const name of trackedFiles) fs.unlinkSync(path.join(checkout, name))
  for (const name of incoming) {
    const destination = path.join(checkout, name)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(artifact, name), destination)
  }
  // Preserve each route's generated metadata. The fallback keeps older frozen
  // artifacts publishable; current builds contain their own route HTML files.
  for (const route of directRoutes) {
    const filename = path.join(checkout, route, 'index.html')
    if (!incoming.includes(`${route}/index.html`)) {
      fs.mkdirSync(path.dirname(filename), { recursive: true })
      fs.copyFileSync(path.join(checkout, route === 'user/terms' ? 'terms/index.html' : 'index.html'), filename)
    }
  }
  // GitHub Pages does not implement Cloudflare _headers/_redirects. Embed
  // the same restrictive browser policy in every public HTML entrypoint.
  const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'self'"
  for (const filename of ['index.html', '404.html', ...directRoutes.map(route => `${route}/index.html`)]) {
    const full = path.join(checkout, filename)
    const html = fs.readFileSync(full, 'utf8')
    if (!html.includes('<head>')) throw new Error('官网 HTML 缺少 head')
    fs.writeFileSync(full, html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`))
  }
  fs.writeFileSync(path.join(checkout, '.nojekyll'), '')
  if (customDomain) fs.writeFileSync(path.join(checkout, 'CNAME'), `${hostname}\n`)
}
