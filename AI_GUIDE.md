# 项目协作指南

## 产品定位

这是以亚马逊赛训为主的效率工具箱。C 端核心用户是参赛学生，B 端核心用户是代打团队；课程学员、指导教师与院校、培训机构是次级用户。它不是课程平台、模拟亚马逊网站或通用卖家 SaaS。

- C 端：选择工具并启动，脚本自动处理；仅在登录、验证码或二次验证时要求用户介入。
- B 端：代打团队使用批量工作台；Live 使用单 Runner 顺序执行，多浏览器现场互相隔离。旧 Demo 仅保留兼容接口与内部测试，不再通过客户界面启动或进入真实记录。
- 管理端：处理授权、设备、公告、更新、工单和需要人工介入的批次。

用户端不展示成功率、预计时间、线程、内部步骤、任务 ID 或虚假进度。

## 当前架构

- Vue 3、Pinia、Element Plus、Vite：`src/`
- Electron、更新管理、Runner、多浏览器协调：`electron/`
- FastAPI、SQLAlchemy、领域服务：`backend/`
- 编译后的桌面主进程：`dist-electron/`
- Electron 使用受控 `app://` 协议加载界面；主进程和 preload 不依赖源码路径。
- 官网正式体验入口为 `/tools#experience` 的嵌入体验；`/demo` 和未知路径返回 404。样例只在本次打开期间保留，退出或刷新后恢复种子数据；不要重新启用旧版持久化或独立演示路由。它不导入业务 API、授权、Runner 或遥测，不恢复线上业务网页版，不代表真实工具验收。本轮不在 Windows 添加新模拟入口。

后端领域入口位于 `backend/domains/`。Router 只处理鉴权、参数和响应，业务规则进入领域 Service。

## 关键业务约束

1. 只有真实的 Runner 事件能改变执行结果，动画不决定业务成功。
2. 同一时刻最多一个活动 Runner；等待用户操作的浏览器现场可以保留。
3. 客户 Excel、密码、Cookie、Token 和页面原文不得上传到控制面。
4. 稳定设备 ID、旧设备迁移、席位释放和密码哈希升级不可当作死代码删除。
5. C 端不能看到或调用批量能力，权限必须由前端路由和后端 API 同时校验。
6. 更新需要用户确认后才下载；运行任务时不得强制重启。
7. 公告受众由后端按套餐解析，不信任前端传入的 consumer/business。
8. 旧公告、旧更新上传和旧 launch-token 协议保留到 1.9.0；新版请求发送 `X-Toolbox-Version`。
9. 只保留右上角账号菜单中的退出入口。
10. 生产部署脚本使用 `toolbox-backend.service` systemd 服务运行 Uvicorn；仓库中的 Docker Compose 用于本地一致性和集成测试，不是默认生产部署方式。除非用户明确授权，不主动部署、停止或重启生产服务。
11. 潜在提交前必须得到本机原子恢复标记的确认；超时、崩溃与无充分证据的旧任务默认待核对。人工核对不能伪装为 Runner 成功，成功项不能从恢复批次重复执行。
12. 文件路径仅来自用户实际选择的受信任本机文件，不上传完整路径或内容；取消保留原值，提交前重新检查存在与可读性。

## 开发和验证

- 新手入口：`开发预览.bat`、`检查.bat`、`仅打包.bat`（只生成本地安装包）、`一键发布.bat`（仅系统）、`官网预览.bat`、`官网发布.bat`、`联合发布.bat`（系统及独立宣传官网）。
- 前端开发：`npm run electron:dev`
- 开发综合检查：`npm run verify`
- 完整发布门禁：`npm run verify:release`（`检查.bat full`）
- 前端与 Electron 测试：`npm test`
- 后端测试：`python -m pytest backend --rootdir=backend -q`
- 桌面安装包：`npm run electron:build`
- 本地候选基线为 Node 22.23.3、npm 12.2.0、Python 3.12；CI、Docker、部署解释器及 `backend/constraints-py312.txt` 已一起迁移。旧 py310 文件只留历史参考，不参与安装。此为源码与本地验证状态，不等于云端运行时已升级；部署须先准备 Python 3.12。更新依赖前核对 node_modules junction，不覆盖其他工作区；完整验收和未关闭边界仍看 `docs/LOCAL_EXPERIENCE_ACCEPTANCE.md`。

禁止使用 `git reset --hard`、自动 `git add .` 后推送 main、全仓无关格式化或绕过管理端的更新上传脚本。

## 发布与安全

- 当前发行目标是 unsigned Windows NSIS，客户可能看到“未知发布者”，这是已接受的产品取舍。
- 当前 `internal` 安装包只包含前端产物、编译后的 Electron CJS、必要生产依赖和模板、费率、品牌资源，不包含 Python 后端；`npm run package:audit` 会拒绝内嵌后端文件。
- 生产发布使用 `node scripts/toolbox-cli.mjs release --publish --version=x.y.z`，同一提交依次发布后端与桌面更新，并验证业务网页版持续下线。要求干净工作区、HEAD 等于已推送的最新 `origin/main`、八项必需 CI（含真实后端旅程及依赖安全）通过且版本高于线上和远端标签。发布器复用已核验的同 SHA CI 结果，只补做发布策略、MariaDB 证明、桌面构建/审计和线上检查；`npm run verify:release` 仍用于需要完整本地门禁的场景。生产不生成或上传业务 Web；`build:web` 仅保留本地预览和隔离界面测试。
- 生产发布禁止 `--skip-verify` 和 `--skip-build`。新版发布状态为 schemaVersion=2，阶段为 `prepared → backend_deployed → desktop_published → verified`；中断后使用匹配的 `--resume=release-id`。历史 schemaVersion=1 只保留记录，禁止自动迁移或续跑；先核对原发布和租约，再建立新版本发布。后端回滚不得重新开放业务网页。
- 系统与宣传官网一起发布使用 `node scripts/toolbox-cli.mjs joint-release --version=x.y.z` 或 `联合发布.bat`：先只读核验官网账号及已有项目，再执行原系统完整发布，最后按官网配置发布独立静态站点。正式官网 `https://kesaitong.top` 使用 GitHub Pages；必须显式配置 `KST_MARKETING_PROVIDER=github-pages` 和已核验仓库，不能默认按旧 Cloudflare 项目发布。`--resume` 传递给系统发布器，`--dry-run` 仅做本地官网配置检查，不连接网络。两个通道不是全局原子事务；官网失败但系统成功时只运行 `官网发布.bat` 恢复，不重复发布系统，也不声称整体已完成。
- 桌面更新经服务器私有暂存区和 `publish_update.py` 校验后原子发布；管理端“应用更新”仍用于查看记录和处理已暂存版本。
- 生产部署 SSH 的目标、私钥和端口只读取当前忽略提交的 `.env.deploy`；未设置 `DEPLOY_SSH_PORT` 时脚本默认 22。不要照搬旧电脑的端口转发假设，也不要修改服务器认证或网络规则。
- Token、私钥、数据库密码和远程地址只放环境变量；提交前运行 `npm run security:audit`。
- 不推送分支、标签或发布包，除非用户明确授权。
- 2026-10-11 本地四批修复的同一交付入口为 `docs/LOCAL_EXPERIENCE_ACCEPTANCE.md`。新 Runner 使用 JSON 启动验证，发布时必须先升级兼容 JSON/query 的后端，再发布客户端；不能向仅支持旧 query 的后端直接发新客户端，也不能通过回退 URL Token 掩盖部署顺序错误。
- 2026-10-11 管理与客服流程的继续验收仍从上述同一入口读取：先看当前候选、证据目录和未确认边界，再按稳定模块 ID 接续。授权列表的全库筛选使用服务端分页参数；旧默认调用和其他模块的历史身份不要覆盖。
- 2026-10-11 完整复核后的 R01–R29 已在独立工作区完成本地修复，具体证据和剩余发布边界仍见同一验收入口顶部。新候选在 `release-hardening-accepted/`，不要再把 `release-admin-ux/`、`release-hardening/` 或 `release-hardening-final/` 当最新候选。Node/Electron/Python 依赖已在独立环境迁移，运行依赖及 Python 扫描为零已知告警；两个构建期上游告警有到期例外，不可宣称所有依赖零告警。`security:audit` 只扫描凭据，依赖安全另有 CI 与发布门禁。源码、候选包、本地实库通过均不等于已部署。

更完整的操作说明见 `docs/DEVELOPMENT_RELEASE.md`。
