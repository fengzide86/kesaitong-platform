// Build a selected, credential-free screenshot gallery; never expose the audit DB/profile.
import { readFile, mkdir, copyFile, writeFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import process from 'node:process'
import { basename, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const root = resolve(process.env.KST_ADMIN_EVIDENCE || 'D:/AmazonToolboxData/audits/kst-admin-product-20261011')
const hardening = process.argv.includes('--hardening')
const afterRoots = process.argv.slice(2).filter(value => !['--serve', '--hardening'].includes(value)).map(value => resolve(value))
if (!afterRoots.length) throw new Error('Pass the verified candidate acceptance roots explicitly')
const publicDir = join(root, 'screenshots')
await mkdir(publicDir, { recursive: true })
const baselineRoot = resolve(process.env.KST_ADMIN_BASELINE_EVIDENCE || root)
const before = join(baselineRoot, 'before-5OHcaC', 'screens')
const beforeAgent = join(baselineRoot, 'before-6xG2Cd', 'screens')
const groups = [
  ['工作区与行动中心', '侧边长清单、空执行提醒占据首屏。', '六个工作区；有对象的待办可直接打开，运行说明收起。', [before, 'dashboard-1440.png'], 'dashboard-1440.png'],
  ['用户与授权入口', '用户资料与授权分别查找。', '当前工作区只展示相关页面，用户详情可继续处理授权与工单。', [before, 'users-1440.png'], 'users-1440.png'],
  ['同一工单完成回复', '查看与回复分开，详情没有处理表单。', '详情内核对用户、授权，填写处理状态与回复，保存后真实回读。', [before, 'feedback-detail-1440.png'], 'support-inline-reply-1440.png'],
  ['代理客户连续处理', '客户详情只能看资料、编辑档案。', '在客户详情查看订单、授权、售后，并预选客户建立订单。', [beforeAgent, 'agent-customer-1440.png'], 'agent-customer-1440.png'],
  ['客户看到处理进展', '', '真实提交的问题可看到工单编号、处理状态和最近回复，不把“回复”当作“已解决”。', null, 'customer-reply-readback-1024.png'],
  ['收款到授权交付', '', '本机测试订单经过待确认、确认收款、发放授权，代理再读取到同一交付结果。', null, 'agency-delivery-complete-1440.png'],
  ['退款与授权分开核对', '', '退款登记后再次读取订单状态；退款不会被误写为自动停权，已退款订单不再复制交付码。', null, 'refund-license-separation-1440.png'],
  ['个人端求助', '', '从现有工具入口进入帮助，提出问题、转人工并读取自己的真实工单。', null, 'consumer-support-ticket-1024.png'],
  ['授权全库搜索与分页', '', '在超过 100 条虚构授权的数据库中搜索设备，服务端准确回读 1 条；不再只筛选前 100 条。', null, 'authorization-server-search-1024.png'],
  ['窄窗口复核', '较窄窗口仍要滚动寻找后台入口。', '1024 宽窗口继续使用相同工作区与操作，宽表仅内部横向滚动。', [before, 'dashboard-1024.png'], 'dashboard-1024.png'],
]
if (hardening) groups.push(
  ['公告全文与键盘操作', '', '真实创建并回读一万字公告；窄窗、125% 缩放下正文可滚动，Escape 关闭并返回焦点。没有改前截图的项目不伪造对照。', null, 'hardening-message-narrow-900-125pct.png'],
  ['设置未知时禁止误操作', '', '本机注入 HTTP 503，显示待确认而不是关闭；开关、发码、依赖设置的操作均禁用。', null, 'hardening-business-unknown-1024-125pct.png'],
  ['恢复后重新读取真实状态', '', '解除故障后重新请求隔离后端，依赖项确认后恢复操作能力；不靠前端乐观假设。', null, 'hardening-business-recovered-1024-125pct.png'],
  ['概览失败不伪造零数据', '', '汇总请求失败明确显示暂不可用，不把未知金额、数量渲染成正常的零。', null, 'hardening-dashboard-unavailable-1024-125pct.png'],
)
if (hardening && process.env.KST_VISUAL_BEFORE_ROOT) groups.push([
  '窄窗标题与操作区', '1038px 实际客户区内，三个操作按钮挤压团队概览标题，只剩“专…”。',
  '沿用原操作区，在 1180px 及以下回落正文；标题可完整阅读，宽屏仍保留原工具栏。两图均来自稳定合成帧的实际软件。',
  [resolve(process.env.KST_VISUAL_BEFORE_ROOT), 'screens', 'windows-1024-business-overview.png'],
  'windows-1024-business-overview.png',
])
const manifest = []
async function locate(name) {
  for (const directory of [...afterRoots].reverse()) {
    const candidate = join(directory, 'screens', name)
    if ((await stat(candidate).catch(() => null))?.isFile()) return candidate
  }
  throw new Error('Missing verified candidate screenshot: ' + name)
}
async function asset(source, label) {
  const filename = `${label}-${basename(source)}`
  const target = join(publicDir, filename)
  await copyFile(source, target)
  manifest.push({ filename, source, sha256: createHash('sha256').update(await readFile(target)).digest('hex') })
  return 'screenshots/' + filename
}
let body = ''
for (const [index, group] of groups.entries()) {
  const [title, oldText, newText, old, name] = group
  const oldImage = old ? await asset(join(...old), `before-${index}`) : ''
  const newImage = await asset(await locate(name), `after-${index}`)
  const picture = (image, text, label) => `<figure><figcaption><b>${label}</b><p>${text}</p></figcaption><a href="${image}" target="_blank" rel="noopener"><img src="${image}" alt="${title} ${label}" loading="lazy"></a></figure>`
  body += `<section><h2>${index + 1}. ${title}</h2><div class="comparison ${oldImage ? '' : 'single'}">${oldImage ? picture(oldImage, oldText, '改前') : ''}${picture(newImage, newText, oldImage ? '改后' : '新增流程验收')}</div></section>`
}
const html = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KST 用户与管理流程验收对照</title><style>*{box-sizing:border-box}body{margin:0;background:#f3f5f8;color:#192535;font:16px/1.6 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1520px;margin:auto;padding:40px 28px}h1{font-size:32px;margin:0 0 12px}header p{max-width:950px;color:#516074}.notice{padding:14px 18px;border-left:4px solid #3567c7;background:#eaf0ff;border-radius:8px}section{margin:40px 0}h2{font-size:22px}.comparison{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}.comparison.single{grid-template-columns:minmax(0,900px)}figure{margin:0;min-width:0;background:white;border:1px solid #d9e0e9;border-radius:14px;overflow:hidden}figcaption{padding:18px}figcaption b{font-size:16px}figcaption p{margin:6px 0 0;color:#58667a;min-height:52px}img{display:block;width:100%;height:auto}a:focus-visible{outline:3px solid #3567c7}footer{color:#58667a;font-size:14px}@media(max-width:800px){main{padding:25px 16px}h1{font-size:26px}.comparison{grid-template-columns:1fr}figcaption p{min-height:0}}</style><main><header><h1>KST 用户与管理流程验收对照</h1><p>点击图片可查看原图。来自本机实际打包程序与隔离测试数据库，不是设计稿。改前使用上一轮保留的候选包；改后使用本轮候选包。截图中的客户、订单和工单均为虚构验收对象。</p><p class="notice">本地验收 · 未部署、未推送 · 未修改线上业务数据。两轮均为 1.8.15 候选，以各自文件路径和哈希区分，不能当作已经发布。授权值仅在取图时遮盖。</p></header>${body}<footer>同一产品保留个人、团队、管理员和代理角色；不拆分安装包。截图、测试与安装包身份见项目原有 LOCAL_EXPERIENCE_ACCEPTANCE.md。外部真实工具、MariaDB、安装升级和生产发布仍须单独验收。</footer></main></html>`
await writeFile(join(root, '验收对照.html'), hardening
  ? html.replace('外部真实工具、MariaDB、安装升级和生产发布仍须单独验收。', '本轮 MariaDB 实库迁移和并发已另有证据；外部真实工具、NSIS 实际安装升级和生产发布仍须单独验收。')
  : html)
await writeFile(join(root, 'screenshot-manifest.json'), JSON.stringify(manifest, null, 2))
console.log('GALLERY=' + join(root, '验收对照.html'))
if (process.argv.includes('--serve')) {
  const allowed = new Map([['/', join(root, '验收对照.html')], ['/验收对照.html', join(root, '验收对照.html')], ...manifest.map(item => ['/screenshots/' + item.filename, join(publicDir, item.filename)])])
  const server = createServer(async (request, response) => {
    const key = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname)
    const filename = allowed.get(key)
    if (!filename || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404).end('Not found'); return }
    response.writeHead(200, { 'Content-Type': filename.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : await readFile(filename))
  })
  server.listen(4312, '127.0.0.1', () => console.log('LOCAL_PREVIEW=http://127.0.0.1:4312/'))
}
