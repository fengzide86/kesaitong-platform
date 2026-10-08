# 项目协作指南

## 产品定位

这是以亚马逊赛训为主的效率工具箱。C 端核心用户是参赛学生，B 端核心用户是代打团队；课程学员、指导教师与院校、培训机构是次级用户。它不是课程平台、模拟亚马逊网站或通用卖家 SaaS。

- C 端：选择工具并启动，脚本自动处理；仅在登录、验证码或二次验证时要求用户介入。
- B 端：代打团队使用批量工作台；Live 使用单 Runner 顺序执行，多浏览器现场互相隔离；Demo 最多 50 个账号逻辑并发，不代表真实账号并发。
- 管理端：处理授权、设备、公告、更新、工单和需要人工介入的批次。

用户端不展示成功率、预计时间、线程、内部步骤、任务 ID 或虚假进度。

## 当前架构

- Vue 3、Pinia、Element Plus、Vite：`src/`
- Electron、更新管理、Runner、多浏览器协调：`electron/`
- FastAPI、SQLAlchemy、领域服务：`backend/`
- 编译后的桌面主进程：`dist-electron/`
- Electron 使用受控 `app://` 协议加载界面；主进程和 preload 不依赖源码路径。

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

## 开发和验证

- 新手入口：`开发预览.bat`、`检查.bat`、`仅打包.bat`（只生成本地安装包）、`一键发布.bat`（仅系统）、`官网预览.bat`、`官网发布.bat`、`联合发布.bat`（系统及独立宣传官网）。
- 前端开发：`npm run electron:dev`
- 开发综合检查：`npm run verify`
- 完整发布门禁：`npm run verify:release`（`检查.bat full`）
- 前端与 Electron 测试：`npm test`
- 后端测试：`python -m pytest backend --rootdir=backend -q`
- 桌面安装包：`npm run electron:build`
- Node 使用 22 系列，CI 固定版本见 `.node-version`；Python CI 标准为 3.10，依赖约束见 `backend/constraints-py310.txt`。本机其他 Python 版本的通过结果不能替代 CI 兼容性检查。

禁止使用 `git reset --hard`、自动 `git add .` 后推送 main、全仓无关格式化或绕过管理端的更新上传脚本。

## 发布与安全

- 当前发行目标是 unsigned Windows NSIS，客户可能看到“未知发布者”，这是已接受的产品取舍。
- 当前 `internal` 安装包只包含前端产物、编译后的 Electron CJS、必要生产依赖和模板、费率、品牌资源，不包含 Python 后端；`npm run package:audit` 会拒绝内嵌后端文件。
- 生产发布使用 `node scripts/toolbox-cli.mjs release --publish --version=x.y.z`，同一提交依次发布后端与桌面更新，并验证业务网页版持续下线。要求干净工作区、HEAD 等于已推送的最新 `origin/main`、七项必需 CI（含真实后端旅程）通过且版本高于线上和远端标签。生产不生成或上传业务 Web；`build:web` 仅保留本地预览和隔离界面测试。
- 生产发布禁止 `--skip-verify` 和 `--skip-build`。新版发布状态为 schemaVersion=2，阶段为 `prepared → backend_deployed → desktop_published → verified`；中断后使用匹配的 `--resume=release-id`。历史 schemaVersion=1 只保留记录，禁止自动迁移或续跑；先核对原发布和租约，再建立新版本发布。后端回滚不得重新开放业务网页。
- 系统与宣传官网一起发布使用 `node scripts/toolbox-cli.mjs joint-release --version=x.y.z` 或 `联合发布.bat`：先只读核验官网账号及已有项目，再执行原系统完整发布，最后发布 Cloudflare Pages 官网。`--resume` 传递给系统发布器，`--dry-run` 仅做本地官网配置检查，不连接网络。两个通道不是全局原子事务；官网失败但系统成功时只运行 `官网发布.bat` 恢复，不重复发布系统，也不声称整体已完成。
- 桌面更新经服务器私有暂存区和 `publish_update.py` 校验后原子发布；管理端“应用更新”仍用于查看记录和处理已暂存版本。
- 生产部署 SSH 的目标、私钥和端口只读取当前忽略提交的 `.env.deploy`；未设置 `DEPLOY_SSH_PORT` 时脚本默认 22。不要照搬旧电脑的端口转发假设，也不要修改服务器认证或网络规则。
- Token、私钥、数据库密码和远程地址只放环境变量；提交前运行 `npm run security:audit`。
- 不推送分支、标签或发布包，除非用户明确授权。

更完整的操作说明见 `docs/DEVELOPMENT_RELEASE.md`。
