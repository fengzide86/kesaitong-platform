# 开发、构建、发布与回滚

## 日常开发

主开发目录为 `D:\开发项目\课赛通-核心平台`，旧名 `D:\开发项目\amazon-toolbox-vue` 已迁移，不应重新创建。入口均从自身所在目录解析项目，不依赖打开终端的位置，也不复制源码到旧目录。

本机工作区职责（2026-10-11 核对）：`kst-web-retirement` 是上轮已发布基线的独立工作区，`kst-local-experience` 是本地体验候选，`kst-experience-fixes` 是本轮修复与验收的独立工作区。目录存在不代表版本已上线；以根目录 `AI_GUIDE.md`、共享 `current-status.md`、实际 `git status` / HEAD 和发布记录交叉核对。不要合并或覆盖其他对话的未完成改动，也不要增加另一个“最新版”入口。

第一次使用请先看根目录 `00_快捷入口说明.md`。保留全部原入口文件名，已有桌面快捷方式继续有效。

| 入口 | 执行范围 | 是否改线上 |
| --- | --- | --- |
| `开发预览.bat` | 本地后端与 Electron 管理员入口 | 否；`remote` 需明确指定 |
| `dev-preview.bat` | 本地后端与 Electron 用户登录入口；按授权进入 C/B 端 | 否；`remote` 需明确指定 |
| `检查.bat` / `检查.bat full` | 快速测试 / 完整发布门禁 | 否 |
| `仅打包.bat` | 当前版本 NSIS、包内容审计、更新清单哈希检查 | 否；不改版本、不提交、不上传 |
| `一键发布.bat` | 后端、桌面正式更新及业务网页版下线核验 | 是；完整生产门禁 |
| `官网预览.bat` | 独立宣传官网构建、审计和本地预览 | 否 |
| `官网发布.bat` | 按官网配置发布独立宣传站及上线核验 | 是；配置或认证缺失会失败 |
| `联合发布.bat` | 先预检官网账号，再完整发布系统，最后发布宣传官网 | 是；任一步失败均中止并说明完成范围 |

### 版本号策略

对外产品保持 **课赛通 KST v1.x** 主线。补丁修复递增第三位（如 `1.8.10`），兼容性功能迭代递增第二位（如 `1.9.0`）；仅当公共 API、数据结构、桌面身份或更新路径发生破坏性不兼容时，才进入 `2.0.0` 评估。功能多不等于第二代，发布器不会自动跳到 v2；官网和日常客户端页面不展示技术版本，只有检测到更新时才展示本次更新版本，管理后台和诊断信息保留精确版本。

这些入口共用 `scripts/launch-toolbox.ps1`：仅在当前进程选择 Node 22，优先使用 `TOOLBOX_NODE_EXE` 显式配置，然后逐一验证 PATH 中的 Node（不会因前面是其他版本而漏掉后面的 22），再按版本查找 D 盘 `TOOLBOX_DATA_ROOT/toolchains` 下已存在的 Node 22；不自动安装、不修改系统 PATH。Python 检查共用 `scripts/run-python.mjs`：先实际执行 `--version` 验证显式 `TOOLBOX_PYTHON`，再尝试项目 `venv`、`.venv`，Windows 下再尝试 `TOOLBOX_DATA_ROOT/venvs/amazon-toolbox-test/Scripts/python.exe`（默认 D 盘），最后检查 PATH 的 Python；Linux 保持 `python3` 回退。纯官网预览、检查与发布仅使用 Node，不因缺少 Python 而无法恢复官网。显式配置无效时直接失败，不静默换解释器；迁移损坏的本地环境会跳过，不删除或重建。

GitHub CLI 优先验证 `TOOLBOX_GH_EXE`，然后依次检查 PATH、Windows 标准安装目录、D 盘工具链（按数值版本排序）；仅使用能实际运行 `gh --version` 的程序。选中的 Python、Node 和已有 GitHub CLI 仅加入本次进程 PATH，本地预览及管理员初始化也使用同一解释器，运行数据目录不变。中文、空格及 `&`、`!` 路径、带空格参数和非零退出码都有 Windows 回归测试。失败默认保留窗口，自动化设置 `TOOLBOX_NO_PAUSE=1` 可禁用暂停，原退出码不会被暂停覆盖。

Node 使用 22 系列，当前 `.node-version` 固定为 `22.23.3`，五处 CI `setup-node` 均读取同一文件；`release:policy` 拒绝另写硬编码版本。2026-10-11 已在本机并列安装经官方 SHA256 核验的该补丁版本，旧运行时保留，未修改系统 PATH。

本地候选已把 CI、Docker、约束、静态检查和部署解释器统一到 Python 3.12，使用 `backend/constraints-py312.txt`。部署会在停止服务前确认 `python3.12` 可用，不自动安装或改写服务器解释器。旧 `constraints-py310.txt` 仅保留历史参考。当前源码迁移与本机验证不代表服务器已升级或远端 CI 已通过，结果见 `docs/LOCAL_EXPERIENCE_ACCEPTANCE.md` 顶部。

npm 固定使用 12.2.0（`packageManager`）；Node 22.23.3 自带旧 npm 在新版 peer 依赖解析中会报 `edgesOut`，不要通过 `--force` / `--legacy-peer-deps` 忽略。CI 显式安装固定 npm，本地可用 `npx --yes npm@12.2.0 ci`。Electron 新包安装通过根目录 `postinstall` 显式准备；构建期脚本只允许 package.json 中列出的精确版本。

本轮独立 Node 依赖位于 `D:\AmazonToolboxData\validation\kst-hardening-npm\node_modules`，Python 位于 `D:\AmazonToolboxData\venvs\kst-hardening-py312`；工作树仅链接到它们，未改变 `kst-web-retirement` 原共享依赖。凭据扫描不替代依赖漏洞扫描：`security:dependencies:npm` 要求运行依赖零告警，构建期例外必须有明确理由与到期日；Python 锁定依赖由独立 pip-audit 2.10.1 检查。过期或新增告警阻止发布。

使用固定 npm 的 `ci` 保持依赖锁文件一致，但先确认 `node_modules` 的 junction/symlink 目标。本轮已把 `kst-experience-fixes/node_modules` 切到上述独立目录；原链接保留为忽略提交的 `node_modules.before-hardening.link`，其原共享目标未改。后续升级同样必须使用独立依赖和 Python 环境，不运行 `npm audit fix --force`。多工作区共用 Playwright 缓存时，包装器默认 `PLAYWRIGHT_SKIP_BROWSER_GC=1`，避免升级时自动清理其他工作区仍需的浏览器。

双击 `开发预览.bat`。它默认使用本地开发后端；如果 8000 端口尚未启动，脚本会自动启动 `backend/start.bat`，关闭 Electron 后再回收由它启动的后端进程。

需要明确连接生产控制面进行兼容性检查时运行：

```powershell
开发预览.bat remote
```

远程后端版本与本地版本不同只会给出警告，不再阻止开发预览。只检查配置而不启动程序：

```powershell
开发预览.bat --dry-run
```

开发预览、检查、仅打包、官网预览的 `--dry-run` 不安装依赖、不启动服务、不构建；联合发布的 `--dry-run` 也只读取本地官网配置并显示计划，不连接网络或调用生产预检。不能把配置检查通过当作实际运行验收。由预览入口启动的本地后端在 Electron 退出或启动失败时会回收，已经在运行的后端不受影响。

等价的底层命令为：

```powershell
npm ci
npm run electron:dev
```

Electron 会编译 TypeScript、构建前端并启动桌面程序。自动化测试使用隔离的本机配置；开发预览根据下述本地配置选择控制面。

需要使用与 CI 一致的 MariaDB、Redis 和后端容器时，按 `docs/DOCKER_OPTIMIZATION_PLAN.md` 复制 `.env.docker.example` 并运行 `npm run docker:up`。Electron 与本地 Runner 仍然在 Windows 原生环境运行。

### 健康与日志契约

- `health/live` 只检查进程；`health/ready` 返回 `ready`、总体 `status` 及每项依赖的 `required`。数据库始终必需。internal/production 的 `REDIS_REQUIRED` 默认 true，与是否填写 `REDIS_URL` 无关，因为 Redis 同时承担分布式限流与认证撤销存储；缺少 URL 或必需依赖失败均返回 503。开发/测试默认可降级；历史单机无 Redis 部署必须在已确认的单进程边界显式设置 `REDIS_REQUIRED=false` 才允许降级（此时限流允许本机后备）。错误配置值启动时失败，不悄悄变成可选。
- 可选 Redis 故障可返回 HTTP 200 / `ready=true` / `status=degraded`；监控必须解析 JSON，不能把 200 当作全部健康。容器 `python -m core.healthcheck` 采用严格健康策略：degraded 也失败并提示告警分类，不改变业务 HTTP 路由语义。健康探测使用独立本机限流，在 Redis 限流存储断连时仍可解释故障。
- Redis 客户端配置有界连接/操作超时，启动失败或空闲断连保留同一连接池、短退避后重试；不会靠无限刷新或自动扩容掩盖错误。没有配置 Redis 时普通缓存是停用，不宣称存在并未实现的“内存缓存”。
- 新 Runner 使用 POST JSON `{token}` 验证一次性启动授权并发送 `X-Toolbox-Version`。旧 launch-token 路径及 query token 协议保留至 1.9.0；必须先发布 JSON/query 双传输兼容后端，再发布新客户端。仅支持旧 query 的后端会拒绝新 JSON 请求（422），新 Runner 不回退把 token 放 URL。回滚后端仍须保留 JSON 兼容，或同时协调回滚客户端；不能只回滚至 query-only 后端。本地候选仅验证隔离的新后端，不证明旧生产环境已支持新 Runner。两条 verify 路由的 422 不回显输入凭据；冲突凭据拒绝且不消费授权；成功消费后重复验证继续拒绝。
- 业务日志记录授权对象 ID，不记录授权码；人类/JSON 日志均过滤凭据、URL 认证信息和异常文本。Nginx 访问日志只含 method/path/protocol、request_id、状态和时延，不含 query、认证头或 Cookie。历史生产日志清理、权限核对需要独立运维实施，本轮本地改动不代表历史内容已清除。
- HTTP 跳转与 HTTPS 两个 server 都显式使用安全 access 格式。Nginx 原生 error_log 无字段脱敏能力，会在上游故障时附旧 query；仅两个 launch verify 精确 location 在兼容窗口内改为 crit，安全 access 仍保留 upstream_status、request_id 和时延，其他 API 错误日志不降级。1.9.0 移除旧 query 协议时一并撤销这项临时错误细节策略；不是永久关闭全站故障诊断。

如果 Playwright 自带浏览器尚未下载，可以临时复用已安装的 Chrome：

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:e2e:internal
```

根目录 BAT 只保留稳定的入口，实际逻辑统一由 `scripts/toolbox-cli.mjs` 执行，避免多个 BAT 各自维护一套易漂移的判断。

## 提交前检查

双击 `检查.bat` 默认运行快速前后端测试。发布前运行完整门禁：

```powershell
检查.bat full
```

等价命令：

```powershell
npm run verify:release
```

该命令依次执行发布配置检查、密钥审计、TypeScript、ESLint、架构边界、OpenAPI 和前端契约检查、死代码检查、前端覆盖率与 Electron 工作流、后端覆盖率与修改代码覆盖率、Ruff 和 mypy、MariaDB 门禁、Business/Internal E2E、真实隔离后端 C/B/Admin 旅程，以及桌面构建和包内容审计。`npm run verify` 是开发综合检查，不等同于完整发布门禁。

`npm run test:e2e:real` 自动建立临时 SQLite、真实 FastAPI、随机测试授权和 Web 构建，不 mock 业务 API，不连接生产。Windows 证据位于 `D:\AmazonToolboxData\real-e2e\run-*`；其他平台位于系统临时目录，可用 `KST_REAL_E2E_ROOT` 覆盖。凭据文件结束时删除，报告只含隔离测试数据。浏览器 Demo 通过不等于真实外部平台 Runner 已验收。

桌面编译先由 TypeScript 生成 CJS，再将 preload 打成只保留 `electron` 外部依赖的单文件，保持 `sandbox: true`。真实 NSIS 覆盖安装仅在一次性 GitHub-hosted Windows 执行，使用固定 SHA512 的 1.8.5 安装包与候选包验证旧数据、实际 `app://`、preload 和打包 Runner。任一安装崩溃直接失败并留诊断，不以重试成功掩盖。

MariaDB 门禁必须使用真实数据库：单独运行检查时配置隔离测试库的 `MARIADB_TEST_URL`；正式发布器也可使用同一 HEAD 已通过的 GitHub MariaDB CI 结果，并会再次独立核验。不要把生产数据库配置为测试库，也不要把跳过的测试计作通过。

如果只验证某一层：

```powershell
npm test
npm run typecheck
npm run deadcode
npm run verify:backend
```

## 仅在本机构建 Windows 安装包

双击 `仅打包.bat`，使用 `package.json` 的当前版本执行 `desktop:verify-installer`，输出 `release\KST Setup <version>.exe`，并校验包内容、blockmap、更新清单和 SHA512。此入口不连接 SSH、不提交 Git、不上传更新、不改版本；不能用 `--publish`、`--skip-verify` 或 `--skip-build` 改变其边界。

```powershell
.\仅打包.bat --dry-run
.\仅打包.bat
# 等价命令
node scripts/toolbox-cli.mjs pack
```

本地包审计不是完整 `verify:release`，也不代表真实安装、生产发布或客户 Live 任务已经验收。

## 正式发布系统

双击 `一键发布.bat` 或使用下述命令。生产发布前必须先将新版本及全部代码提交、合入最新 `main` 并推送，发布器不会替你提交代码或合并分支。它要求：

- 工作区干净，包括没有未跟踪文件。
- HEAD 等于上游分支和最新 `origin/main`。
- `package.json` 中版本等于请求版本，OpenAPI 等生成文件检查通过。
- 请求版本高于线上桌面版本及远端最新版本标签；恢复发布则必须匹配原版本和提交。
- 本机 `gh` 已登录，以下八项必需 CI 的最新结果均为当前 HEAD 的成功结果：
  - `Dependency security`
  - `Frontend and Electron contracts`
  - `Backend domains and API`
  - `MariaDB migrations and concurrency`
  - `Responsive C B Admin smoke`
  - `Internal critical-flow acceptance`
  - `Real backend C B Admin journeys`
  - `Windows NSIS install and runtime smoke`

确认生产发布后，发布器会复用同一 HEAD 已通过且已核验的八项 CI 结果，并优先下载该提交 Windows CI 已完成安装、运行和卸载验收的安装包，只执行发布策略、精确 MariaDB CI 证明、制品哈希检查及线上部署检查；CI 制品不可用时才回退本地 NSIS 构建。`检查.bat full` 仍保留完整本地质量门禁。发布阶段为 `prepared → backend_deployed → desktop_published → verified`，schemaVersion=2 状态与后端、桌面产物校验值保存到 `TOOLBOX_DATA_ROOT/release-workflows/<release-id>/`，Windows 默认位于 D 盘。后端部署包通过 `git archive` 从该提交的跟踪文件生成，包含业务网页版下线策略及 Service Worker 清退脚本；不生成、上传或激活业务 Web 归档。最终核对健康信息、桌面清单及旧网页的跳转、410 和清退脚本后才创建并推送版本标签。`build:web` 仅用于本地预览和隔离界面测试，测试产物不进入生产发布。

无人值守发布示例：

```powershell
$env:TOOLBOX_AUTO_PUBLISH='1'
$releaseVersion=(Get-Content package.json -Raw | ConvertFrom-Json).version
node scripts/toolbox-cli.mjs release --publish "--version=$releaseVersion"
```

推荐用 `仅打包.bat` 生成本地包。旧版完整本地发布命令仍保留兼容，会执行完整门禁，且明确传入不同版本时会修改本地版本文件；不用于替代新的“仅打包”入口：

```powershell
$releaseVersion=(Get-Content package.json -Raw | ConvertFrom-Json).version
node scripts/toolbox-cli.mjs release "--version=$releaseVersion"
```

中断后根据发布器输出或状态文件取得原 release ID，再恢复同一提交的发布。以下占位值必须替换为真实发布 ID：

```powershell
$env:TOOLBOX_AUTO_PUBLISH='1'
$releaseVersion=(Get-Content package.json -Raw | ConvertFrom-Json).version
$releaseId='<原发布 ID>'
node scripts/toolbox-cli.mjs release --publish "--version=$releaseVersion" "--resume=$releaseId"
```

**生产禁止 `--skip-verify` 和 `--skip-build`。** `--resume` 会验证原状态、产物哈希和已完成阶段的线上版本；后端部署后还会验证业务网页版持续下线。发布过程中保留服务器发布租约，失败后应按原 release ID 恢复，不要手动清理租约或另起一轮发布。历史 schemaVersion=1 记录保留原文件，但禁止自动迁移或续跑（含旧 `web_activated` 阶段），避免重新开放旧网页。先核对原发布是否完成及其租约归属，再按新的已审核版本建立 schemaVersion=2 发布；不得编辑历史状态伪装成新版。

2026-10-11 的恢复修正规则：

- 新发布仍要求最新 `origin/main`；续跑只允许原 HEAD、原版本、原控制面与服务器目标，且原 SHA 仍位于当前 `origin/main` 的历史中。main 正常前进不再阻塞原发布；历史被重写、缺少原目标或切到另一个 SHA 均拒绝。CI、产物哈希与租约校验不省略。
- 真正部署前先持久化 `backendDeploymentStarted=true`，保存失败不部署。处于 `prepared` 且已尝试部署、或旧状态缺少尝试标记时，先读取线上身份，精确核对 version / commit SHA / release ID、严格就绪状态及业务网页下线，再次验证租约后才补记 `backend_deployed`。
- 网络未知、已回滚、线上被其他发布覆盖、degraded、旧网页仍公开或租约失效，都停止并要求核对，不因没有 checkpoint 而自动重复部署。正常历史发布器先持久化 `artifactsPrepared=true` 才部署，因此原始最新记录的 false 可以继续产物准备；此保证不适用于手改状态或旧备份覆盖。不得通过编辑状态文件绕过恢复门禁。

仅打包的低层命令如下；它不等同于完整门禁，也不部署或发布：

```powershell
npm run electron:build
```

当前使用 unsigned NSIS，不需要购买证书或注册 Microsoft Store。Windows 可能显示“未知发布者”，不影响安装和授权码功能。

打包后可额外检查资源白名单：

```powershell
npx electron-builder --win --dir
npm run package:audit
```

当前 `internal` 桌面安装包不包含 Python 后端；`package:audit` 会拒绝 `toolbox-backend.exe`。包内包含前端、编译后的 Electron/Runner、必要生产依赖和模板、费率、品牌资源。安装包不得包含 Token、测试、文档、运维脚本、TypeScript 源码或 source map。`backend:build` 仅保留为兼容场景的手动命令，不是默认发布步骤。

## 独立宣传官网

2026-09-21 实际可访问通道为 `https://fengzide86.github.io`（独立静态仓库），Cloudflare 的 `kesaitong.pages.dev` 当时返回 522。官网通道以本机 `.env.marketing.local` 的当前配置及公开访问核验为准，登录成功不等于域名或站点可用。域名 `kesaitong.top` 是否完成绑定必须另行核验。

官网不再直接搬运业务应用。`官网预览.bat` 依次执行 `build:marketing`、`marketing:audit`、`preview:marketing`，只使用 `dist-marketing`，默认在 `http://127.0.0.1:4200` 预览，不覆盖桌面或本地预览产物。正式产品入口为 `https://kesaitong.top`，工具、授权管理和代理业务通过 Windows 软件使用。

`官网发布.bat` 委托 `marketing:publish`，由独立发布器检查 `.env.marketing.local`、所选托管通道账号、主分支及版本前置条件，构建并核对线上结果。未配置账号、站点或无法从正式更新清单取得下载链接时必须明确失败，不生成占位“发布成功”。通常留空可选的 `VITE_DESKTOP_DOWNLOAD_URL`，由当前已发布的 `latest.yml` 自动生成；若显式配置，必须与本轮系统版本一致。认证与实际生产发布由发布器控制，不由 BAT 隐式登录或静默跳过。

```powershell
.\官网预览.bat --dry-run
.\官网预览.bat
.\官网发布.bat --dry-run
.\官网发布.bat
```

`一键发布.bat` 的四阶段只负责后端、桌面更新及业务网页版下线核验；不能把系统发布成功描述成官网也已上线。需要两个通道一起更新时，使用以下联合入口。

## 联合发布系统与宣传官网

双击 `联合发布.bat`，默认使用当前 `package.json` 版本。它先通过官网发布器的 `--check-account` 核验本地配置、所选托管通道登录与已存在项目，再调用系统 `release --publish` 完整门禁和四阶段，最后运行独立官网发布器。账号预检不要求新系统版本此时已经上线；真正上传官网前仍会核对系统版本、下载清单、同一提交的 CI 与线上文件。

```powershell
.\联合发布.bat --dry-run
$releaseVersion=(Get-Content package.json -Raw | ConvertFrom-Json).version
.\联合发布.bat "--version=$releaseVersion"
# 非交互执行仍需要明确设置 TOOLBOX_AUTO_PUBLISH=1
node scripts/toolbox-cli.mjs joint-release "--version=$releaseVersion"
```

联合入口不提交业务源码、不合并分支、不创建托管项目，也不隐式登录；执行前仍需准备已合入 `main` 且 CI 通过的新版本及 `.env.deploy`、`.env.marketing.local`。GitHub Pages 通道仅向配置好的独立静态仓库提交构建产物，不代替业务源码的提交与 CI。`--skip-verify`、`--skip-build` 和未知参数均被拒绝。原系统阶段中断时可以给联合入口传入原 `--resume=<release-id>`，它仍会先预检官网，然后由原发布器校验恢复状态。

**两个发布器不是全局原子事务。** 系统未成功时绝不上传新官网；系统成功但官网失败时，联合命令返回失败并明确说明系统已经完成，不自动回滚系统，不自动重复发布版本。排除官网问题后只运行 `官网发布.bat`，按官网发布器的公开访问核验结果确认完成；不要因官网失败再不带 `--resume` 执行同一版本的系统发布。

## 发布应用更新

`一键发布.bat` 会通过 SSH 把安装包、blockmap 和 YAML 上传到服务器私有暂存目录，再调用受审计的 `publish_update.py` 完成校验和原子发布；不会直接覆盖公开更新目录。管理端“应用更新”仍可用于查看发布记录和人工处理已暂存版本。

SSH 连接信息统一放在忽略提交的 `.env.deploy`。服务器使用非 22 端口时设置 `DEPLOY_SSH_PORT`；未设置时默认使用 22。发布器会强制只使用 `DEPLOY_SSH_KEY_FILE` 指定的私钥，避免本机 SSH Agent 中的其他密钥干扰认证。

发布后仍需用一个 C 端和一个 B 端授权验证“发现更新 → 确认下载 → 后台下载 → 安全重启”。不要使用 SFTP、旧 HTTP 上传脚本或直接覆盖服务器文件。

## 回滚

- 后端部署脚本在停服后冻结写入并备份数据库、附件及代码/配置，避免数据库与凭证文件备份时间不一致。Alembic 已开始后的失败使用 `ops/deploy/restore-backup.sh` 恢复一致备份；此前失败恢复代码、配置和 Python 环境指针。
- 业务网页版下线使用独立的私有备份和恢复清单。网页问题只能恢复该网页配置及产物，不能恢复数据库；显式恢复网页须使用下线工具的 `--restore <backup-dir> --allow-web-restore` 并重新核对影响。普通后端回滚保留下线策略，不自动恢复旧网页入口。
- 桌面清单经暂存、校验后原子发布。若较早阶段已成功而后续失败，已成功阶段不会自动全部回旧版；优先用同一 release ID 恢复。后端与桌面发布不是跨服务的全局原子事务。
- 需要人工恢复后端时，先核对本次部署输出的 `backup_dir`、恢复影响和备份完整性，再使用服务器已安装的 `toolbox-restore-backup`；该操作会恢复数据库和附件，不得只因网页问题就盲目执行。
- 代码回退使用经过评审的 `git revert <commit>`，再按新版本发布。

不要使用 `git reset --hard`、强推或覆盖已发布标签。不要把某一阶段的回滚成功描述为全部服务都已回滚；必须重新核对后端健康、业务网页版下线状态和桌面更新清单。

## 仍需人工确认

发布前请完成：

1. 用真实 C 端授权运行一次工具。
2. 用真实 B 端授权导入一个小批次并处理一次登录或验证码现场。
3. 登录管理后台，检查行动中心、公告和更新发布。

仓库生产部署脚本使用 `toolbox-backend.service`，通过发布版 Python 环境的 `current-venv` 指针启动 Uvicorn。Compose 用于本地一致性和 MariaDB 集成测试，不是默认生产部署方式；不要因本机没有 Docker 而安装或迁移生产环境。

控制面及部署目标以当前 `.env.deploy` 为准；业务 API 和桌面更新使用同一 HTTPS 控制面。仓库 Nginx 配置保留 `/api/`、`/updates/` 及证书续期入口。旧业务页面 302 跳转至 `https://kesaitong.top/#`，丢弃查询参数并阻止浏览器继承旧片段；旧脚本、资源、清单和 Web 版本文件返回 410；`/sw.js` 保留清退脚本，仅清理该 scope 的历史预缓存并注销自身。发布前实时验证 TLS、健康信息、版本与下线状态，不把旧部署记录或旧电脑端口配置当作当前事实。
