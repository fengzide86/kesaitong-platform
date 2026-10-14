// Fail before creating an installer when npm cannot describe the actual runtime
// tree. electron-builder can otherwise accept npm list exit 1 and silently copy
// a partial graph (for example when node_modules is an external Junction).
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function verifyTreeResult(metadata, result) {
  if (result.error || result.status !== 0) {
    throw new Error(`Package dependency preflight failed: npm list exited ${result.status ?? 'without status'}. Resolve the installed dependency tree before packaging; no partial tree is accepted.`)
  }
  let tree
  try { tree = JSON.parse(result.stdout) } catch { throw new Error('Package dependency preflight received invalid or truncated npm JSON') }
  if (tree.name !== metadata.name || tree.version !== metadata.version || !tree.dependencies) {
    throw new Error('Package dependency preflight root identity differs from the candidate')
  }
  for (const name of Object.keys(metadata.dependencies || {})) {
    const dependency = tree.dependencies[name]
    if (!dependency || typeof dependency.version !== 'string' || typeof dependency.path !== 'string') {
      throw new Error(`Package dependency preflight cannot resolve required root dependency: ${name}`)
    }
  }
  const queue = [tree]
  let count = 0
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index]
    if (!item || typeof item !== 'object' || item.missing || item.invalid || item.problems?.length) {
      throw new Error('Package dependency preflight found an incomplete or invalid npm tree')
    }
    for (const child of Object.values(item.dependencies || {})) { queue.push(child); count += 1 }
  }
  return { rootDependencies: Object.keys(metadata.dependencies || {}).length, graphEntries: count }
}

function verifyDependencyLocation(root) {
  const expected = path.join(fs.realpathSync(root), 'node_modules')
  const actual = fs.realpathSync(path.join(root, 'node_modules'))
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`Desktop packaging requires a physical project node_modules tree, not an external link. Found ${actual}. Materialize the isolated dependencies or run npm ci in an isolated physical checkout; shared targets were not modified.`)
  }
}

async function verifyPackageDependencyTree(context) {
  const root = path.resolve(context?.packager?.info?.appDir || process.cwd())
  verifyDependencyLocation(root)
  const { assertActiveToolchain } = await import('./npm-toolchain.mjs')
  const toolchain = assertActiveToolchain(root)
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const result = spawnSync(toolchain.nodeExecutable, [toolchain.cli, 'list', '-a', '--include', 'prod', '--include', 'optional', '--omit', 'dev', '--json', '--long', '--silent', '--loglevel=error'], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024,
  })
  const verified = verifyTreeResult(metadata, result)
  console.log(`package_dependency_preflight=${JSON.stringify({ ...verified, node: toolchain.nodeVersion, npm: toolchain.npmVersion, status: 'verified' })}`)
}

module.exports = verifyPackageDependencyTree
module.exports.verifyTreeResult = verifyTreeResult
module.exports.verifyDependencyLocation = verifyDependencyLocation
if (require.main === module) verifyPackageDependencyTree().catch(error => { console.error(error.message); process.exitCode = 1 })
