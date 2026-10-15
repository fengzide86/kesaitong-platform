import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { npmEnvironment, resolveNpm } from './npm-toolchain.mjs'

const isWindows = process.platform === 'win32'
const args = process.argv.slice(2)
const separator = args.indexOf('--')
if (separator < 0 || separator === args.length - 1) {
  throw new Error('Usage: node scripts/with-toolbox-data-root.mjs [--set NAME=value] -- <command> [...args]')
}

const optionArgs = args.slice(0, separator)
const commandArgs = args.slice(separator + 1)
const dataRoot = path.resolve(
  process.env.TOOLBOX_DATA_ROOT
    || (isWindows ? 'D:\\AmazonToolboxData' : path.join(os.tmpdir(), 'AmazonToolboxData')),
)

const directories = {
  buildTemp: path.join(dataRoot, 'build-tmp'),
  electronCache: path.join(dataRoot, 'electron-cache'),
  electronBuilderCache: path.join(dataRoot, 'electron-builder-cache'),
  playwrightBrowsers: path.join(dataRoot, 'playwright-browsers'),
  npmCache: path.join(dataRoot, 'npm-cache'),
}
for (const directory of Object.values(directories)) fs.mkdirSync(directory, { recursive: true })

const env = {
  ...process.env,
  TOOLBOX_DATA_ROOT: dataRoot,
  TEMP: directories.buildTemp,
  TMP: directories.buildTemp,
  ELECTRON_CACHE: directories.electronCache,
  ELECTRON_BUILDER_CACHE: directories.electronBuilderCache,
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || directories.playwrightBrowsers,
  // Multiple independent KST workspaces share this cache; one must not collect another's browsers.
  PLAYWRIGHT_SKIP_BROWSER_GC: process.env.PLAYWRIGHT_SKIP_BROWSER_GC || '1',
  npm_config_cache: process.env.npm_config_cache || directories.npmCache,
}

for (let index = 0; index < optionArgs.length; index += 1) {
  if (optionArgs[index] !== '--set') throw new Error(`Unknown option: ${optionArgs[index]}`)
  const assignment = optionArgs[index + 1] || ''
  const splitAt = assignment.indexOf('=')
  if (splitAt <= 0) throw new Error('--set expects NAME=value')
  env[assignment.slice(0, splitAt)] = assignment.slice(splitAt + 1)
  index += 1
}

const [requestedCommand, ...requestedArgs] = commandArgs
const npmToolchain = ['npm', 'npx'].includes(requestedCommand) ? resolveNpm({ projectRoot: process.cwd(), environment: env }) : null
const localWindowsShim = path.resolve('node_modules', '.bin', `${requestedCommand}.cmd`)
const resolvedCommand = isWindows && fs.existsSync(localWindowsShim)
  ? localWindowsShim
  : isWindows && ['npm', 'npx'].includes(requestedCommand)
    ? `${requestedCommand}.cmd`
    : requestedCommand

const quoteForCmd = value => {
  const text = String(value)
  if (/\r|\n|\0/.test(text)) throw new Error('Command arguments cannot contain control characters')
  return /[\s&|<>^]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
const command = npmToolchain ? npmToolchain.nodeExecutable : isWindows && resolvedCommand.toLowerCase().endsWith('.cmd')
  ? process.env.ComSpec || 'cmd.exe'
  : resolvedCommand
const spawnedArgs = npmToolchain ? [requestedCommand === 'npx' ? path.join(path.dirname(npmToolchain.cli), 'npx-cli.js') : npmToolchain.cli, ...requestedArgs] : command === resolvedCommand
  ? requestedArgs
  : ['/d', '/v:off', '/s', '/c', `call ${[resolvedCommand, ...requestedArgs].map(quoteForCmd).join(' ')}`]

const child = spawn(command, spawnedArgs, {
  cwd: process.cwd(),
  env: npmToolchain ? npmEnvironment(npmToolchain, env) : env,
  stdio: 'inherit',
  windowsHide: true,
  windowsVerbatimArguments: !npmToolchain && command !== resolvedCommand,
})

child.once('error', error => {
  console.error(`[toolbox-data-root] ${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`[toolbox-data-root] command terminated by ${signal}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code ?? 1
})
