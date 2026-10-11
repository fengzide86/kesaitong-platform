import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const directory = path.resolve(process.env.TOOLBOX_MARKETING_DIR || 'dist-marketing')
const seoPages = JSON.parse(fs.readFileSync(new URL('../src/marketing/seo-pages.json', import.meta.url), 'utf8'))
const routeFiles = [...seoPages.filter(page => page.path !== '/').map(page => `${page.path.slice(1)}index.html`), 'user/terms/index.html']
const required = ['index.html', '404.html', '_headers', '_redirects', 'marketing-version.json', 'robots.txt', 'sitemap.xml', ...routeFiles]
const allowedRoot = new Set([...required, 'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'pwa-512x512.png'])
const files = []
function inspect(relative = '') {
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    const file = path.posix.join(relative, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Marketing artifact cannot contain symlinks: ${file}`)
    if (entry.isDirectory()) inspect(file)
    else files.push(file)
  }
}
inspect()
for (const name of required) if (!files.includes(name)) throw new Error(`Marketing artifact is missing ${name}`)
for (const name of files) {
  if (!allowedRoot.has(name) && !/^assets\/[\w.-]+-[\w-]{8,}\.(?:js|css|svg|png|jpe?g|webp|woff2?)$/i.test(name)) {
    throw new Error(`Unexpected marketing artifact (application/source/secret/map files are forbidden): ${name}`)
  }
  if (/\.(?:js|css|html|json|svg|txt|xml)$/.test(name)) {
    const source = fs.readFileSync(path.join(directory, name), 'utf8')
    if (/\/api\/|app:\/\/toolbox|toolbox_token|user-credential\.bin|sourceMappingURL|-----BEGIN [^-]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9_]{20,}/.test(source)) {
      throw new Error(`Business API, application credential, secret or source map found in ${name}`)
    }
  }
}
const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'marketing-version.json'), 'utf8'))
if (metadata.kind !== 'kst-marketing' || metadata.sourcePolicy !== 'marketing-only-v1'
  || !/^[a-f0-9]{40}$/i.test(metadata.commitSha) || !metadata.version
  || !Number.isFinite(Date.parse(metadata.builtAt))) throw new Error('Marketing provenance is incomplete')
for (const key of ['publicUrl', 'downloadUrl']) {
  const url = new URL(metadata[key])
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || /candidate-|win-unpacked|localhost|127\.0\.0\.1/.test(metadata[key])) {
    throw new Error(`Invalid public marketing ${key}`)
  }
}
const headers = fs.readFileSync(path.join(directory, '_headers'), 'utf8')
if (!headers.includes("connect-src 'none'") || !headers.includes('immutable') || !headers.includes('/marketing-version.json\n  Cache-Control: no-store')) {
  throw new Error('Marketing response policy is incomplete')
}
const redirects = fs.readFileSync(path.join(directory, '_redirects'), 'utf8')
if (!redirects.includes('/terms /terms/index.html 200') || redirects.includes('/* /index.html')) {
  throw new Error('Marketing must retain true 404s instead of a blanket SPA rewrite')
}
const sitemap = fs.readFileSync(path.join(directory, 'sitemap.xml'), 'utf8')
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])
for (const page of seoPages) {
  const html = fs.readFileSync(path.join(directory, page.path === '/' ? 'index.html' : `${page.path.slice(1)}index.html`), 'utf8')
  const canonical = new URL(page.path, metadata.publicUrl).href
  for (const expected of [
    `<title>${page.title}</title>`,
    `<meta name="description" content="${page.description}">`,
    `<meta property="og:title" content="${page.title}">`,
    `<meta property="og:description" content="${page.description}">`,
    `<link rel="canonical" href="${canonical}">`,
    `<meta property="og:url" content="${canonical}">`,
  ]) if (!html.includes(expected)) throw new Error(`Marketing SEO metadata is missing or stale for ${page.path}`)
  if ((html.match(/rel="canonical"/g) || []).length !== 1 || (html.match(/property="og:url"/g) || []).length !== 1) {
    throw new Error(`Marketing SEO has duplicate canonical metadata for ${page.path}`)
  }
  if (!sitemapUrls.includes(canonical)) throw new Error(`Sitemap is missing ${page.path}`)
}
if (sitemapUrls.length !== seoPages.length) throw new Error('Sitemap must contain only canonical marketing routes')
const robots = fs.readFileSync(path.join(directory, 'robots.txt'), 'utf8')
if (!robots.includes(`Sitemap: ${new URL('/sitemap.xml', metadata.publicUrl).href}`)) throw new Error('robots.txt is missing the public sitemap')
const notFound = fs.readFileSync(path.join(directory, '404.html'), 'utf8')
if (!notFound.includes('name="robots" content="noindex, follow"') || notFound.includes('rel="canonical"')) throw new Error('404 pages must not be indexed or claim the homepage canonical')
console.log(`marketing_artifact=verified files=${files.length} business_api=0 source_maps=0`)
console.log(`marketing_commit=${metadata.commitSha}`)
