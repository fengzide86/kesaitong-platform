// Local candidate assembly only. Never mutates shared node_modules or publishes.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export function assertStageChild(parent, candidate, paths = path) {
  if (typeof candidate !== 'string' || !candidate || !paths.isAbsolute(candidate)) throw new Error('Candidate stage must be an explicit child of package-staging')
  const stage = paths.resolve(candidate)
  const relative = paths.relative(paths.resolve(parent), stage)
  if (!relative || paths.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${paths.sep}`)) throw new Error('Candidate stage must be an explicit child of package-staging')
  return stage
}

function existingStat(filename) {
  try { return lstatSync(filename) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

function assertPlainPath(filename, kind) {
  const stat = existingStat(filename)
  if (!stat) return null
  if (stat.isSymbolicLink()) throw new Error('Candidate paths cannot contain symlinks or junctions')
  if (stat.isFile() && stat.nlink > 1) throw new Error('Candidate files cannot contain shared hard links')
  if ((kind === 'directory' && !stat.isDirectory()) || (kind === 'file' && !stat.isFile())) throw new Error('Candidate output must contain only regular files and directories')
  return stat
}

function assertPlainAncestors(filename) {
  let directory = path.resolve(filename)
  while (true) {
    assertPlainPath(directory, 'directory')
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
}

function sourceInventory(directory, entries = new Map(), prefix = '') {
  if (!assertPlainPath(directory, 'directory')) throw new Error('Build compiled output before assembling the local candidate')
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    const relative = path.join(prefix, entry.name)
    const stat = existingStat(filename)
    if (!stat || stat.isSymbolicLink()) throw new Error('Compiled output cannot contain symlinks or junctions')
    if (stat.isDirectory()) {
      entries.set(relative, 'directory')
      sourceInventory(filename, entries, relative)
    } else if (stat.isFile()) entries.set(relative, 'file')
    else throw new Error('Compiled output must contain only regular files and directories')
  }
  return entries
}

function validateExistingOutput(directory, expected, prefix = '') {
  if (!assertPlainPath(directory, 'directory')) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    const relative = path.join(prefix, entry.name)
    const stat = existingStat(filename)
    if (!stat || stat.isSymbolicLink()) throw new Error('Candidate paths cannot contain symlinks or junctions')
    const kind = expected.get(relative)
    if (!kind) throw new Error(`Candidate compiled output contains stale extra entries: ${relative}`)
    assertPlainPath(filename, kind)
    if (kind === 'directory') validateExistingOutput(filename, expected, relative)
  }
}

function copyBuildDirectory(source, destination) {
  assertPlainAncestors(destination)
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    const stat = existingStat(from)
    if (!stat || stat.isSymbolicLink()) throw new Error('Compiled output cannot contain symlinks or junctions')
    if (stat.isDirectory()) copyBuildDirectory(from, to)
    else if (stat.isFile()) {
      assertPlainAncestors(destination)
      assertPlainPath(to, 'file')
      copyFileSync(from, to)
    } else throw new Error('Compiled output must contain only regular files and directories')
  }
}

export function prepareLocalDesktopStage({ project, parent, candidate }) {
  const sourceProject = path.resolve(project)
  const stage = assertStageChild(parent, candidate)
  // Full preflight before any output write: even dangling links are rejected.
  assertPlainAncestors(stage)
  for (const filename of ['package.json', 'package-lock.json']) {
    if (!assertPlainPath(path.join(sourceProject, filename), 'file')) throw new Error(`Source ${filename} is missing`)
    assertPlainPath(path.join(stage, filename), 'file')
  }
  const metadata = JSON.parse(readFileSync(path.join(sourceProject, 'package.json'), 'utf8'))
  if (existsSync(path.join(stage, 'package.json'))) {
    const current = JSON.parse(readFileSync(path.join(stage, 'package.json'), 'utf8'))
    if (current.name !== metadata.name || current.version !== metadata.version) throw new Error('Refusing to overwrite a different candidate stage')
  }
  for (const directory of ['dist', 'dist-electron']) {
    const source = path.join(sourceProject, directory)
    const relative = path.relative(source, stage)
    if (!path.isAbsolute(relative) && (!relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`)))) throw new Error('Candidate stage cannot be inside compiled source output')
    const inventory = sourceInventory(source)
    validateExistingOutput(path.join(stage, directory), inventory)
  }
  mkdirSync(path.resolve(parent), { recursive: true })
  mkdirSync(stage, { recursive: true })
  assertPlainAncestors(stage)
  if (realpathSync(stage) !== stage) throw new Error('Candidate stage cannot be a symlink or junction')
  for (const directory of ['dist', 'dist-electron']) copyBuildDirectory(path.join(sourceProject, directory), path.join(stage, directory))
  // electron-builder's two-package layout keeps build configuration and dev
  // tools in the source project; only runtime metadata belongs in the app.
  const runtimeMetadata = { ...metadata }
  delete runtimeMetadata.build; delete runtimeMetadata.devDependencies; delete runtimeMetadata.scripts
  assertPlainAncestors(stage)
  assertPlainPath(path.join(stage, 'package.json'), 'file')
  writeFileSync(path.join(stage, 'package.json'), JSON.stringify(runtimeMetadata, null, 2) + '\n')
  assertPlainAncestors(stage)
  assertPlainPath(path.join(stage, 'package-lock.json'), 'file')
  writeFileSync(path.join(stage, 'package-lock.json'), readFileSync(path.join(sourceProject, 'package-lock.json')))
  return stage
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const parent = path.resolve(process.env.TOOLBOX_DATA_ROOT || 'D:/AmazonToolboxData', 'package-staging')
  const stage = prepareLocalDesktopStage({ project, parent, candidate: process.argv[2] })
  console.log(`local_candidate_stage=${stage}`)
  console.log('shared_dependencies_changed=false publishing=false')
}
