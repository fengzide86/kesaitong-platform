# 开发、构建、发布与回滚

## 日常开发

唯一源码目录为 `D:\开发项目\amazon-toolbox-vue`；入口均从自身所在目录解析项目，不依赖打开终端的位置，也不复制源码到旧目录。

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

Node 使用 22 系列，CI 固定版本见 `.node-version`。Python CI 使用 3.10，并按 `backend/constraints-py310.txt` 验证生产依赖。使用 `npm ci` 保持依赖锁文件一致；本机其他 Python 版本的测试结果不替代 Python 3.10 CI。

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
- 本机 `gh` 已登录，以下七项必需 CI 的最新结果均为当前 HEAD 的成功结果：
  - `Frontend and Electron contracts`
  - `Backend domains and API`
  - `MariaDB migrations and concurrency`
  - `Responsive C B Admin smoke`
  - `Internal critical-flow acceptance`
  - `Real backend C B Admin journeys`
  - `Windows NSIS install and runtime smoke`

确认生产发布后，脚本执行完整质量门禁、构建及内容审计，再依次部署后端与桌面更新。发布阶段为 `prepared → backend_deployed → desktop_published → verified`，schemaVersion=2 状态与后端、桌面产物校验值保存到 `TOOLBOX_DATA_ROOT/release-workflows/<release-id>/`，Windows 默认位于 D 盘。后端部署包通过 `git archive` 从该提交的跟踪文件生成，包含业务网页版下线策略及 Service Worker 清退脚本；不生成、上传或激活业务 Web 归档。最终核对健康信息、桌面清单及旧网页的跳转、410 和清退脚本后才创建并推送版本标签。`build:web` 仅用于本地预览和隔离界面测试，测试产物不进入生产发布。

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
