import path from 'node:path'
import process from 'node:process'
import console from 'node:console'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readMarketingEnvironment } from './marketing-config.mjs'
import { getPublishedMarketingDownload } from './marketing-download.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const environment = { ...process.env, ...readMarketingEnvironment(root) }
if (!environment.VITE_DESKTOP_DOWNLOAD_URL) {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const verified = await getPublishedMarketingDownload({ controlUrl: metadata.toolbox.controlApiUrl })
  environment.VITE_DESKTOP_DOWNLOAD_URL = verified.downloadUrl
  console.log(`本地官网使用已验证稳定入口，当前正式安装包 ${verified.version}；未发布本地候选。`)
}
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.marketing.config.ts', '--mode', 'production'], {
  cwd: root, env: environment, stdio: 'inherit', windowsHide: true,
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
