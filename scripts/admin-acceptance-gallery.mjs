// Build a selected, credential-free screenshot gallery; never expose the audit DB/profile.
import { readFile, mkdir, copyFile, writeFile, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import process from 'node:process'
import { basename, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const updates = process.argv.includes('--updates')
const root = resolve(updates ? (process.env.KST_UPDATE_EVIDENCE || 'D:/AmazonToolboxData/audits/kst-update-20261012') : (process.env.KST_ADMIN_EVIDENCE || 'D:/AmazonToolboxData/audits/kst-admin-product-20261011'))
const hardening = process.argv.includes('--hardening')
const afterRoots = process.argv.slice(2).filter(value => !['--serve', '--hardening', '--updates'].includes(value)).map(value => resolve(value))
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
if (updates) groups.splice(0, groups.length,
  ['下载进度与实际速度', '上一正式版显示百分比和传输字节，不显示速度。', '保留原侧栏和主界面，增加实际速度与下载阶段。这里用受控事件验证显示，不是公网测速；改前后说明文字、目标版本和文件大小来自测试夹具。', [root, 'before-e8bznc', 'screens', 'consumer-downloading-1280-1.png'], 'consumer-downloading-1280-1.png'],
  ['125% 缩放', '', '原生打包程序在 125% 缩放下检查进度、说明和按钮，没有用网页设计图代替实际窗口。', null, 'consumer-downloading-zoom-1280-1.25.png'],
  ['长时间没有新字节', '', '30 秒未收到新字节时给出明确等待或取消建议，不继续显示虚假速度，也不自动重复下载。', null, 'consumer-stalled-1280-1.png'],
  ['取消后重新下载', '', '取消等旧请求真正结束后才允许重新下载，下一次使用新的下载尝试。', null, 'consumer-cancelled-1280-1.png'],
  ['重启确认位置修复', '本轮中间候选实际截图：原生对话框被全局 reset 影响，偏在左上角；这不是旧正式版的缺陷。', '修复后显式居中并保留边距；支持焦点和 Escape。关闭只是稍后决定，不代表允许退出时安装。截图目标 1.8.99 为隔离夹具，不是已发布版本。', [root, 'after-FCwqCW', 'screens', 'consumer-ready-1280-1.png'], 'consumer-ready-1280-1.png'],
  ['重启确认：窄窗与缩放', '', '最窄原生窗口叠加 125% 缩放和较小高度；同时断言对话框居中、四周留白和键盘焦点。实际视口尺寸见 result.json。', null, 'consumer-ready-short-zoom-768-1.25.png'],
  ['安装启动失败恢复', '', '模拟安装程序启动错误后仍有明确说明和恢复入口；本次没有实际执行 Windows 安装程序。', null, 'consumer-install-failed-1280-1.png'],
  ['团队工作区更新详情', '', '工作区能查看更新进度；本截图没有执行活动任务，活动任务重启保护另由状态机测试验证。', null, 'business-downloading-1280-1.png'],
  ['当前版本与历史版本', '', '原生后台页面区分当前更新版本、历史已发布和暂存状态。列表是本机受控样例，不是线上发布记录。', null, 'admin-release-list-1280-1.png'],
  ['上传结果待核对', '', '隔离注入上传 HTTP 500 后先回读并阻止重复上传；最窄原生窗口仍可操作核对入口。没有向线上提交发布文件。', null, 'admin-upload-uncertain-narrow-768-1.png'],
)
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
let output = hardening
  ? html.replace('外部真实工具、MariaDB、安装升级和生产发布仍须单独验收。', '本轮 MariaDB 实库迁移和并发已另有证据；外部真实工具、NSIS 实际安装升级和生产发布仍须单独验收。')
  : html
if (updates) output = output
  .replaceAll('KST 用户与管理流程验收对照', 'KST 1.8.16 更新体验验收')
  .replace('改前使用上一轮保留的候选包；改后使用本轮候选包。', '下载对照使用正式 1.8.15 与本轮候选；重启弹窗另列本轮中间候选的视觉缺陷及修复。')
  .replace('截图中的客户、订单和工单均为虚构验收对象。', '登录使用本机隔离数据库；下载、安装错误和发布列表使用受控夹具。')
  .replace('两轮均为 1.8.15 候选，以各自文件路径和哈希区分，不能当作已经发布。授权值仅在取图时遮盖。', '改前为正式 1.8.15 包，改后为本地 1.8.16 候选。屏幕中的目标 1.8.99 是测试夹具。不是公网下载或覆盖安装成功的证据。')
  .replace('外部真实工具、MariaDB、安装升级和生产发布仍须单独验收。', 'Windows 实际覆盖安装、线上更新和线路速度仍须单独验收。文件名中的宽度是请求值；Windows 最小窗口约束下的实际视口宽度记录在 result.json，不将 900px 冒称 768px。')
await writeFile(join(root, '验收对照.html'), output)
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
