import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const codeExtensions = ['.ts', '.cts', '.vue']
// Include non-ignored, untracked sources so the gate is reliable before a
// developer stages a new module. `git ls-files` alone made freshly extracted
// entry modules look invisible and reported their dependencies as orphans.
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .map(file => file.replaceAll('\\', '/'))
  .filter(file => fs.existsSync(path.join(root, file)))

const sourceFiles = new Set(tracked.filter(file =>
  codeExtensions.includes(path.posix.extname(file))
  && !file.endsWith('.d.ts')
  && (file.startsWith('src/') || file.startsWith('electron/') || file.startsWith('scripts/') || file.startsWith('tests/')),
))

function sourceCandidate(candidate: string): string | null {
  const normalized = path.posix.normalize(candidate)
  const candidates = [normalized]
  const extension = path.posix.extname(normalized)
  if (extension === '.js') candidates.push(normalized.slice(0, -3) + '.ts')
  if (extension === '.cjs') candidates.push(normalized.slice(0, -4) + '.cts')
  if (!codeExtensions.includes(extension) && extension !== '.js' && extension !== '.cjs') {
    for (const suffix of codeExtensions) candidates.push(normalized + suffix)
    for (const suffix of codeExtensions) candidates.push(path.posix.join(normalized, `index${suffix}`))
  }
  return candidates.find(file => sourceFiles.has(file)) || null
}

function resolveImport(owner: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return sourceCandidate(`src/${specifier.slice(2)}`)
  if (!specifier.startsWith('.')) return null
  return sourceCandidate(path.posix.join(path.posix.dirname(owner), specifier))
}

function importsOf(file: string): string[] {
  const content = fs.readFileSync(path.join(root, file), 'utf8')
  const specifiers = new Set<string>()
  const patterns = [
    /(?:import|export)\s+(?:[^'"()]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) if (match[1]) specifiers.add(match[1])
  }
  // Eager component smoke tests really import these modules. Treat their
  // literal Vite globs as edges instead of incorrectly calling them orphans.
  for (const match of content.matchAll(/import\.meta\.glob\(\s*(\[[\s\S]*?\]|['"][^'"]+['"])/g)) {
    const globs = [...match[1]!.matchAll(/['"]([^'"]+)['"]/g)].map(item => item[1]!)
    for (const imported of fs.globSync(globs, { cwd: path.join(root, path.posix.dirname(file)) })) {
      specifiers.add(imported.replaceAll('\\', '/'))
    }
  }
  return [...specifiers]
}

const entries = new Set<string>([
  'src/main.ts',
  'src/marketing/main.ts',
  'electron/desktop-main.cts',
  'electron/preload.cts',
  'electron/automation-runner.cts',
  'electron/smoke/embedded-browser-smoke.cts',
  'electron/smoke/amazon-navigation-smoke.cts',
  'electron/smoke/app-protocol-smoke.cts',
  'electron/smoke/local-scenes-smoke.cts',
  // Loaded as an absolute preload path by the native local-scenes smoke.
  'electron/smoke/local-scenes-smoke-preload.cts',
  ...[...sourceFiles].filter(file =>
    file.startsWith('scripts/')
    || file.startsWith('tests/')
    || file.startsWith('src/tests/')
    || /\.(?:spec|test)\.ts$/.test(file),
  ),
])

const reachable = new Set<string>()
const queue = [...entries].filter(file => sourceFiles.has(file))
while (queue.length) {
  const file = queue.pop()
  if (!file || reachable.has(file)) continue
  reachable.add(file)
  for (const specifier of importsOf(file)) {
    const dependency = resolveImport(file, specifier)
    if (dependency && !reachable.has(dependency)) queue.push(dependency)
  }
}

const ignoredOrphans = new Set<string>([
  // Generated declarations and standalone build configuration are checked elsewhere.
])
const orphans = [...sourceFiles]
  .filter(file => !reachable.has(file) && !ignoredOrphans.has(file))
  .sort()

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
}
const importedPackages = new Set<string>()
for (const file of sourceFiles) {
  for (const specifier of importsOf(file)) {
    if (specifier.startsWith('.') || specifier.startsWith('@/') || specifier.startsWith('node:')) continue
    const segments = specifier.split('/')
    importedPackages.add(specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0] || specifier)
  }
}
const unusedDependencies = Object.keys(packageJson.dependencies || {})
  .filter(dependency => !importedPackages.has(dependency))
  .sort()

for (const file of orphans) console.error(`orphan_source=${file}`)
for (const dependency of unusedDependencies) console.error(`unused_dependency=${dependency}`)
console.log(`deadcode_orphans=${orphans.length}`)
console.log(`deadcode_unused_dependencies=${unusedDependencies.length}`)
if (orphans.length || unusedDependencies.length) process.exitCode = 1
