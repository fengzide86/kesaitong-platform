import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

// `build:web` is retained only for local renderer previews and browser E2E.
// Public business-Web deployment has been retired; do not recreate its PWA.
export function auditLocalRendererBuild(dist) {
  if (!fs.statSync(path.join(dist, 'index.html'), { throwIfNoEntry: false })?.isFile()) {
    throw new Error('Local renderer build is missing index.html')
  }

  const retiredArtifacts = fs.readdirSync(dist).filter(filename =>
    /^(?:sw\.js|registerSW\.js|manifest\.webmanifest|web-version\.json|workbox-.+\.js)$/i.test(filename))
  if (retiredArtifacts.length) {
    throw new Error(`Retired business-Web artifacts must not be generated: ${retiredArtifacts.join(', ')}`)
  }

  const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
  if (/rel=["']manifest["']|registerSW|serviceWorker\s*\.\s*register|web-version\.json/i.test(index)) {
    throw new Error('Local renderer must not install a PWA or poll the retired Web version endpoint')
  }
  const scripts = [...index.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1])
  if (!scripts.length) throw new Error('Local renderer must include a built application script')
  for (const source of scripts) {
    const relative = source.replace(/^\.\//, '').replace(/^\//, '')
    const target = path.resolve(dist, relative)
    if (!relative.startsWith('assets/') || !target.startsWith(`${path.resolve(dist)}${path.sep}`)
      || !fs.statSync(target, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Local renderer script is not a local built asset: ${source}`)
    }
  }
  return { scripts: scripts.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = auditLocalRendererBuild(path.join(process.cwd(), 'dist'))
  process.stdout.write(`local_renderer_build_policy=verified application_scripts=${result.scripts} public_web=retired\n`)
}
