import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, normalizePath, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { isMarketingSource, marketingHeaders, marketingRedirects, publicHttpsUrl } from './src/marketing/build-policy'
import { marketingSitemap, marketingStaticRoutes, renderMarketingSeo } from './src/marketing/seo'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const marketingRoot = path.join(projectRoot, 'src', 'marketing')
const packageMetadata = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as { version: string }

export default defineConfig(({ command }) => {
  const required = command === 'build'
  const downloadUrl = publicHttpsUrl(process.env.VITE_DESKTOP_DOWNLOAD_URL, 'VITE_DESKTOP_DOWNLOAD_URL', required)
  const configuredPublicUrl = publicHttpsUrl(process.env.KST_MARKETING_SITE_URL, 'KST_MARKETING_SITE_URL', required)
  if (configuredPublicUrl && new URL(configuredPublicUrl).pathname !== '/') throw new Error('KST_MARKETING_SITE_URL must be the website origin')
  const publicUrl = configuredPublicUrl ? new URL(configuredPublicUrl).origin : ''
  const commitSha = process.env.RELEASE_COMMIT || process.env.GITHUB_SHA
    || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim()
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) throw new Error('Marketing build requires the exact source commit SHA')

  const publicArtifactPlugin: Plugin = {
    name: 'kst-marketing-only',
    enforce: 'post',
    transformIndexHtml(html) {
      return renderMarketingSeo(html, '/', publicUrl)
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const sourceModules = [...this.getModuleIds()]
          .map(id => normalizePath(path.relative(projectRoot, id.split('?')[0] || id)))
          .filter(id => id.startsWith('src/'))
        const forbidden = sourceModules.filter(id => !isMarketingSource(id))
        if (forbidden.length) this.error(`Marketing bundle imports application modules: ${forbidden.join(', ')}`)
        const index = bundle['index.html']
        if (!index || index.type !== 'asset') this.error('Marketing index.html was not generated')
        const html = typeof index.source === 'string' ? index.source : Buffer.from(index.source).toString('utf8')
        for (const route of marketingStaticRoutes) {
          this.emitFile({ type: 'asset', fileName: `${route}/index.html`, source: renderMarketingSeo(html, `/${route}/`, publicUrl) })
        }
        this.emitFile({ type: 'asset', fileName: '404.html', source: renderMarketingSeo(html, '/404.html', publicUrl) })
        this.emitFile({ type: 'asset', fileName: '_headers', source: marketingHeaders })
        this.emitFile({ type: 'asset', fileName: '_redirects', source: marketingRedirects })
        this.emitFile({ type: 'asset', fileName: 'marketing-version.json', source: JSON.stringify({
          kind: 'kst-marketing', version: packageMetadata.version, commitSha,
          builtAt: new Date().toISOString(), publicUrl, downloadUrl,
          sourcePolicy: 'marketing-only-v1', sourceModuleCount: new Set(sourceModules).size,
        }, null, 2) })
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', publicUrl).href}\n` })
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: marketingSitemap(publicUrl) })
        for (const fileName of ['favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png', 'pwa-512x512.png']) {
          this.emitFile({ type: 'asset', fileName, source: readFileSync(path.join(projectRoot, 'public', fileName)) })
        }
      },
    },
  }

  return {
    root: marketingRoot,
    publicDir: false,
    envDir: false,
    // No ambient VITE_* configuration (API, telemetry or secrets) enters this
    // independent artifact. Only the deliberately public download URL is exposed.
    envPrefix: 'KST_MARKETING_PUBLIC_UNUSED_',
    plugins: [vue(), publicArtifactPlugin],
    resolve: { alias: { '@': path.join(projectRoot, 'src') } },
    define: { 'import.meta.env.VITE_DESKTOP_DOWNLOAD_URL': JSON.stringify(downloadUrl) },
    base: '/',
    build: {
      outDir: path.join(projectRoot, 'dist-marketing'),
      emptyOutDir: true,
      sourcemap: false,
      assetsInlineLimit: 0,
      minify: 'esbuild',
    },
  }
})
