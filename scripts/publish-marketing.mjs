/* global fetch, AbortSignal */
import fs from 'node:fs'
import process from 'node:process'
import console from 'node:console'
import { setTimeout } from 'node:timers'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import { assertGitHubPagesProject, assertMarketingMetadata, assertPagesProject, marketingToolEnvironment, readMarketingEnvironment, validateMarketingConfig } from './marketing-config.mjs'
import { prepareGitHubPagesTree } from './github-pages-artifact.mjs'
import { getPublishedMarketingDownload } from './marketing-download.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requiredChecks = ['Frontend and Electron contracts', 'Backend domains and API', 'MariaDB migrations and concurrency', 'Responsive C B Admin smoke', 'Internal critical-flow acceptance', 'Real backend C B Admin journeys', 'Windows NSIS install and runtime smoke']

function command(executable, args, { capture = false, environment = process.env, cwd = root } = {}) {
  const result = spawnSync(executable, args, { cwd, env: environment, windowsHide: true, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(executable)} 执行失败（${result.status}）${capture ? `: ${(result.stderr || '').slice(-1000)}` : ''}`)
  return (result.stdout || '').trim()
}
const git = (...args) => command('git', args, { capture: true })
const node = (filename, args, environment, capture = false) => command(process.execPath, [path.join(root, filename), ...args], { environment, capture })

function verifySource() {
  if (git('status', '--porcelain')) throw new Error('官网生产发布要求干净工作区；请先提交源码（配置 .env.marketing.local 不提交）')
  command('git', ['fetch', '--prune', 'origin'])
  const sha = git('rev-parse', 'HEAD')
  if (git('branch', '--show-current') !== 'main' || sha !== git('rev-parse', 'origin/main')) throw new Error('官网生产发布必须从最新 main 执行；不会自动提交或合并')
  const repository = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(git('remote', 'get-url', 'origin'))?.[1]
  if (!repository) throw new Error('无法识别 GitHub origin')
  const response = JSON.parse(command('gh', ['api', '--hostname', 'github.com', `repos/${repository}/commits/${sha}/check-runs?per_page=100`], { capture: true }))
  for (const name of requiredChecks) {
    const latest = response.check_runs?.filter(check => check.name === name).sort((a, b) => b.id - a.id)[0]
    if (!latest || latest.head_sha !== sha || latest.status !== 'completed' || latest.conclusion !== 'success') throw new Error(`当前提交尚未通过 ${name}`)
  }
  return sha
}

async function request(url, options = {}) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), cache: 'no-store', ...options })
  if (!response.ok) throw new Error(`公开链接返回 HTTP ${response.status}: ${new URL(url).pathname}`)
  return response
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length > 1 || args.some(arg => !['--dry-run', '--check', '--check-account', '--login'].includes(arg))) throw new Error('仅支持一个 --dry-run、--check、--check-account 或 --login；生产发布不支持跳过验收')
  const values = readMarketingEnvironment(root)
  const config = validateMarketingConfig(values)
  const toolEnvironment = marketingToolEnvironment()
  // Wrangler's isolated XDG directory must not redirect gh away from the
  // user's existing authenticated keyring/configuration.
  const environment = config.provider === 'github-pages'
    ? { ...process.env, ...values }
    : { ...toolEnvironment, ...values, CLOUDFLARE_ACCOUNT_ID: config.accountId }
  if (args.includes('--login')) {
    if (config.provider === 'github-pages') {
      command('gh', ['auth', 'login', '--hostname', 'github.com', '--web'], { environment })
      return
    }
    node('node_modules/wrangler/bin/wrangler.js', ['login', '--scopes', 'account:read', 'user:read', 'pages:write', ...(process.platform === 'win32' ? ['--use-keyring'] : [])], environment)
    return
  }
  if (args.includes('--dry-run')) {
    console.log(`官网配置有效：${config.projectName} → ${config.publicUrl}`)
    console.log('仅检查本地配置；未校验 CI、线上安装包、所选发布通道登录或域名，未构建或发布。')
    return
  }
  if (config.provider === 'github-pages') {
    const pages = JSON.parse(command('gh', ['api', '--hostname', 'github.com', `repos/${config.repository}/pages`], { capture: true, environment }))
    assertGitHubPagesProject(pages, config)
  } else {
    const projects = JSON.parse(node('node_modules/wrangler/bin/wrangler.js', ['pages', 'project', 'list', '--json'], environment, true))
    assertPagesProject(projects, config.projectName, config.publicUrl)
  }
  if (args.includes('--check-account')) {
    console.log(`官网账号与项目可访问：${config.projectName}；未构建、未发布，未证明 CI 或线上版本已就绪。`)
    return
  }
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const commitSha = verifySource()
  const controlUrl = metadata.toolbox.controlApiUrl
  const { downloadUrl } = await getPublishedMarketingDownload({ controlUrl, expectedVersion: metadata.version, configuredUrl: config.downloadUrl })
  if (args.includes('--check')) {
    console.log(`官网发布预检通过：${metadata.version} / ${commitSha.slice(0, 12)} / ${config.publicUrl}。未发布。`)
    return
  }
  const buildEnvironment = { ...environment, VITE_DESKTOP_DOWNLOAD_URL: downloadUrl, KST_MARKETING_SITE_URL: config.publicUrl, RELEASE_COMMIT: commitSha }
  node('node_modules/vite/bin/vite.js', ['build', '--config', 'vite.marketing.config.ts', '--mode', 'production'], buildEnvironment)
  node('scripts/audit-marketing-build.mjs', [], buildEnvironment)
  const expected = { version: metadata.version, commitSha, publicUrl: config.publicUrl, downloadUrl }
  assertMarketingMetadata(JSON.parse(fs.readFileSync(path.join(root, 'dist-marketing/marketing-version.json'), 'utf8')), expected)
  if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== commitSha) throw new Error('构建期间源码发生变化，取消上传')
  const verifyCurrentDownload = () => getPublishedMarketingDownload({ controlUrl, expectedVersion: metadata.version, configuredUrl: downloadUrl })
  await verifyCurrentDownload()
  // Explicit main target; acceptance below checks the production URL, never a
  // deployment preview URL, so a changed production branch cannot pass silently.
  if (config.provider === 'github-pages') {
    const parent = path.resolve(toolEnvironment.XDG_CONFIG_HOME, '..', '..', 'github-pages-releases')
    fs.mkdirSync(parent, { recursive: true })
    const checkout = fs.mkdtempSync(path.join(parent, 'publish-'))
    command('git', ['clone', '--depth=1', '--branch=main', `https://github.com/${config.repository}.git`, checkout], { environment })
    const tracked = command('git', ['ls-files'], { cwd: checkout, capture: true }).split(/\r?\n/).filter(Boolean)
    prepareGitHubPagesTree(path.join(root, 'dist-marketing'), checkout, tracked, config.publicUrl)
    if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== commitSha) throw new Error('上传前源码发生变化，取消官网推送')
    command('git', ['add', '--all'], { cwd: checkout })
    const changed = command('git', ['diff', '--cached', '--name-only'], { cwd: checkout, capture: true })
    if (changed) {
      const userName = git('config', 'user.name'), userEmail = git('config', 'user.email')
      command('git', ['-c', `user.name=${userName}`, '-c', `user.email=${userEmail}`, 'commit', '-m', `Publish KST ${metadata.version} (${commitSha.slice(0, 12)})`], { cwd: checkout })
      await verifyCurrentDownload()
      command('git', ['push', 'origin', 'HEAD:main'], { cwd: checkout, environment })
    }
    console.log(`GitHub Pages 宣传制品已提交；保留发布目录 ${checkout}，继续验收公开站点。`)
  } else {
    await verifyCurrentDownload()
    node('node_modules/wrangler/bin/wrangler.js', ['pages', 'deploy', 'dist-marketing', '--project-name', config.projectName, '--branch', 'main', '--commit-hash', commitSha, '--commit-dirty=false'], buildEnvironment)
  }
  const deadline = Date.now() + (config.provider === 'github-pages' ? 300_000 : 90_000)
  let lastError
  do {
    try {
      const remote = await (await request(`${config.publicUrl}/marketing-version.json?t=${Date.now()}`)).json()
      assertMarketingMetadata(remote, expected)
      const currentDownload = await verifyCurrentDownload()
      const html = await (await request(`${config.publicUrl}/`)).text()
      if (!html.includes('课赛通') || !html.includes('type="module"')) throw new Error('官网首页未返回预期产物')
      if (config.provider === 'github-pages') {
        const terms = await (await request(`${config.publicUrl}/terms/`)).text()
        if (!terms.includes('type="module"') || !terms.includes('Content-Security-Policy')) throw new Error('GitHub Pages 条款直达页面或浏览器策略缺失')
      }
      const asset = /<script[^>]+src="([^"]+)"/.exec(html)?.[1]
      if (!asset) throw new Error('官网首页缺少脚本资源')
      await request(new URL(asset, config.publicUrl), { method: 'HEAD' })
      const directory = path.join(toolEnvironment.XDG_CONFIG_HOME, '..', 'releases')
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(path.join(directory, `marketing-${metadata.version}-${commitSha.slice(0, 12)}-${Date.now()}.json`), `${JSON.stringify({ ...expected, resolvedInstallerUrl: currentDownload.installerUrl, installerBytes: currentDownload.size, project: config.projectName, verifiedAt: new Date().toISOString() }, null, 2)}\n`)
      console.log(`官网已部署并验证：${config.publicUrl}（${metadata.version} / ${commitSha.slice(0, 12)}）`)
      return
    } catch (error) { lastError = error }
    await new Promise(resolve => setTimeout(resolve, 3000))
  } while (Date.now() < deadline)
  throw new Error(`上传已完成，但公网验收未通过：${lastError?.message}。请在 ${config.provider} 检查部署与域名，不能将此结果视为已交付。`)
}

main().catch(error => { console.error(`[KST 官网] ${error.message}`); process.exitCode = 1 })
