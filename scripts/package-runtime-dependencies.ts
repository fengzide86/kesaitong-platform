import path from 'node:path'

type ManifestReader = (archivePath: string) => string | undefined
type Manifest = Record<string, unknown>
export interface RuntimeDependencyIssue {
  code: 'MISSING_DEPENDENCY' | 'INVALID_MANIFEST' | 'MISSING_ROOT_MANIFEST'
  chain: string[]
  manifestPath: string
  message: string
}
export interface RuntimeDependencyAudit {
  rootDependencyCount: number
  resolvedPackageCount: number
  issues: RuntimeDependencyIssue[]
}

function manifestObject(value: unknown): value is Manifest {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Match Node's NODE_MODULES_PATHS search, including scoped/nested packages.
// Archives always use POSIX paths, independently of the audit host OS.
function candidateManifests(packageDirectory: string, dependency: string): string[] {
  const candidates: string[] = []
  let directory = packageDirectory
  while (true) {
    if (path.posix.basename(directory) !== 'node_modules') candidates.push(path.posix.join(directory, 'node_modules', dependency, 'package.json'))
    if (!directory) break
    const parent = path.posix.dirname(directory)
    directory = parent === '.' ? '' : parent
  }
  return candidates
}

/** Inspect packaged manifests only: no installed host dependencies can mask a
 * missing ASAR transitive dependency. Optional and dev graphs are not mandatory.
 */
export function auditRuntimeDependencies(readManifest: ManifestReader): RuntimeDependencyAudit {
  const result: RuntimeDependencyAudit = { rootDependencyCount: 0, resolvedPackageCount: 0, issues: [] }
  const rootSource = readManifest('package.json')
  if (rootSource === undefined) {
    result.issues.push({ code: 'MISSING_ROOT_MANIFEST', chain: ['<root>'], manifestPath: 'package.json', message: 'Packaged root package.json is missing' })
    return result
  }
  const queue = [{ manifestPath: 'package.json', source: rootSource, chain: ['<root>'] }]
  const visited = new Set(['package.json'])
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!
    let manifest: Manifest
    try {
      const parsed: unknown = JSON.parse(current.source)
      if (!manifestObject(parsed) || (parsed.dependencies !== undefined && !manifestObject(parsed.dependencies))
        || (parsed.optionalDependencies !== undefined && !manifestObject(parsed.optionalDependencies))) throw new Error('Invalid package dependency metadata')
      manifest = parsed
    } catch {
      result.issues.push({ code: 'INVALID_MANIFEST', chain: current.chain, manifestPath: current.manifestPath, message: 'Packaged package.json is invalid' })
      continue
    }
    const dependencies = (manifest.dependencies || {}) as Manifest
    const optional = (manifest.optionalDependencies || {}) as Manifest
    const required = Object.keys(dependencies).filter(name => !Object.hasOwn(optional, name))
    if (index === 0) result.rootDependencyCount = required.length
    for (const dependency of required) {
      if (!/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(dependency) || dependency.split('/').some(segment => segment === '.' || segment === '..')
        || typeof dependencies[dependency] !== 'string') {
        result.issues.push({ code: 'INVALID_MANIFEST', chain: [...current.chain, dependency], manifestPath: current.manifestPath, message: 'Invalid required dependency declaration' })
        continue
      }
      const packageDirectory = path.posix.dirname(current.manifestPath)
      let found = false
      for (const candidate of candidateManifests(packageDirectory === '.' ? '' : packageDirectory, dependency)) {
        const source = readManifest(candidate)
        if (source === undefined) continue
        found = true
        if (!visited.has(candidate)) {
          visited.add(candidate)
          result.resolvedPackageCount += 1
          queue.push({ manifestPath: candidate, source, chain: [...current.chain, dependency] })
        }
        break
      }
      if (!found) result.issues.push({ code: 'MISSING_DEPENDENCY', chain: [...current.chain, dependency], manifestPath: current.manifestPath,
        message: 'Required runtime dependency is missing from the packaged node_modules search paths' })
    }
  }
  return result
}
