# Docker 与云服务器完整优化方案

## 2026-10-06 改名收尾验收

本节记录本次目录改名的实际验收，不代表完成了下文的生产容器化方案。下文硬件、空间、版本及 SSH 限制属于旧方案快照，不是当前设备或服务状态。

- 项目仓库：`fengzide86/kesaitong-platform`；本地开发目录：`D:\开发项目\课赛通-核心平台`。
- 部署脚本、systemd、Nginx、Dockerfile 和 Compose 的正式路径统一为 `/opt/kesaitong-platform`、`/var/lib/kesaitong-platform`。部署脚本的固定根目录与配置模板保持一致，不支持单独覆盖根目录环境变量。
- `/opt/amazon-toolbox`、`/var/lib/amazon-toolbox` 仍作为兼容符号链接保留；`toolbox-backend.service`、Nginx 配置文件名、Compose 项目名/镜像名/卷名及发布锁标识有意保留，避免新建空数据卷或绕过现有锁。不要机械替换所有 `amazon-toolbox` / `toolbox` 字样。
- 旧备份路径和旧 venv 指针先解析真实路径，再检查正式目录边界；符号链接逃逸、无效指针与原子切换失败都会拒绝，历史备份内容不改写。
- 新增 `python3 scripts/tests/deployment-rename.test.py`：在 Linux 临时目录中通过 14 项测试，覆盖新旧路径、历史服务回退、边界拒绝、条件上下文失败传播及 Bash 语法。仅测试恢复前置检查和临时链接，不执行生产数据库恢复。已接入 GitHub Actions。
- `node scripts/verify-release-configuration.mjs` 通过；线上 7 份已有备份的 venv 指针只读检查全部有效。
- 线上恢复命令 `/usr/local/sbin/toolbox-restore-backup` 已备份后更新；Nginx 已平滑重载。后端保持 active，HTTPS readiness、网页版本与更新清单返回 200。
- 本次未发布新的业务程序、未操作数据库恢复；线上应用仍为 `1.8.12`（`f1276c98077ab91c5bcdb520b92f49870e5e1f48`）。本地及服务器均未提供 Docker，因此没有宣称完成真实容器构建/启动验收。

## 1. 目标与不可改变项

本方案用于提高环境一致性、测试真实性、部署可回滚性和日志可观察性，不改变现有业务功能。

必须保持：

- 产品仍是跨境电商赛训效率工具箱，不是通用卖家 SaaS。
- Electron、嵌入式浏览器、本地 Runner、浏览器配置与自动化证据继续运行在 Windows 客户端。
- `TOOL_EXECUTION_MODE=demo`、Demo/Live 边界、签名校验和真实平台限制不因 Docker 改变。
- 公网 API 地址、现有 API 路径、数据库模型、授权规则和更新发布协议不改变。
- `/api/health/live` 只表示进程存活，`/api/health/ready` 继续检查 MySQL、Redis、连接池和后台任务。
- 生产 Nginx、证书续期和 `/var/lib/kesaitong-platform/updates` 更新文件发布路径第一阶段保持在宿主机。

## 2. 原方案基线（历史快照）

### 本地 Windows

- Windows 11 家庭版，Intel i5-1240P，12 核 16 线程，硬件虚拟化和 SLAT 可用。
- 内存约 16 GB；审计时空闲内存不足 2 GB，需要限制 WSL/Docker 资源。
- C 盘审计时仅剩约 4.3 GB，D 盘约剩 89 GB。
- 尚未安装现代 WSL 和 Docker Desktop。

### 云服务器

- 公开接口当前报告应用版本 `1.8.0`。
- 运行环境报告 Python 3.10.12、Linux 5.15 系列内核。
- `/api/health/ready` 当前为 `ok`，MySQL、Redis 正常，后台待处理任务为 0。
- 现有 canonical 部署目录为 `/opt/kesaitong-platform/backend`；`/opt/amazon-toolbox` 仅作为兼容符号链接保留。
- systemd 以 `toolbox` 非 root 用户启动一个 Uvicorn worker，只监听 `127.0.0.1:8000`。
- Nginx 在宿主机终止 TLS，反向代理 API，并直接提供受控的安装包、blockmap 和 `latest.yml`。
- 发布脚本已包含数据库备份、代码备份、Alembic、健康探测和失败回滚。
- 当前 SSH 80 端口入口从本机连接会被服务端立即关闭，因此本轮无法读取生产 journal/Nginx 原始日志。任何生产实施前必须先恢复受限 SSH 运维入口。

公开健康接口只包含版本号，不包含 Git SHA 或镜像摘要，因此不能证明服务器正在运行某个具体提交。

## 3. 目标架构

```text
Windows 客户端
  Electron + 本地 Runner + 浏览器自动化
                    |
                  HTTPS
                    |
云服务器宿主机     Nginx + TLS + 更新文件目录
                    |
             127.0.0.1:8000
                    |
第一阶段容器        FastAPI
                    |
宿主机服务          MariaDB + Redis

本地开发 Compose
  FastAPI + MariaDB 11.4 + Redis + Alembic migration + integration test
```

生产第一阶段不容器化 Nginx、MariaDB、Redis 和 Electron。这样可以保留当前证书、更新文件、数据库备份和 Runner 边界，把变化限制在 Python 运行环境。

## 4. 已实施的本地 Docker 基线

仓库新增：

- `backend/Dockerfile`：Python 3.10、固定依赖、非 root 用户、只读运行、健康检查、生产与测试构建目标。
- `compose.yaml`：MariaDB、Redis、Alembic、API 和 MariaDB 并发测试。
- `.dockerignore`：排除密钥、构建产物、测试产物、日志、浏览器配置和本地数据库。
- `.env.docker.example`：只含本地占位配置，不复用生产密钥。
- npm Docker 命令：配置检查、启动、停止、日志和真实 MariaDB 测试。

Docker 服务默认只把 API 映射到 `127.0.0.1`，数据库和 Redis 不发布到宿主机网络。MariaDB root 密码只注入数据库容器，API 和迁移容器仅接收业务数据库账号。

## 5. 本机安装与资源方案

### 5.1 安装前

1. 把不需要的文件从 C 盘迁出，至少为 Windows 更新和临时文件保留 15 GB。
2. 在管理员 PowerShell 安装/更新 WSL 2，重启后确认 `wsl --version` 不低于 Docker Desktop 当前要求。
3. Docker Desktop 使用 WSL 2 Linux 容器后端；Windows 家庭版无需 Windows 容器。
4. 安装时将 WSL 数据根目录设为 `D:\DockerData`，不要让镜像和卷写入空间不足的 C 盘。

建议的全局 WSL 资源上限：

```ini
[wsl2]
memory=4GB
processors=4
swap=1GB
```

修改后执行 `wsl --shutdown` 再启动 Docker Desktop。

### 5.2 首次启动

```powershell
Copy-Item .env.docker.example .env.docker
# 把 .env.docker 中的三个密码/密钥占位符替换为本机随机值
npm run docker:config
npm run docker:up
Invoke-RestMethod http://127.0.0.1:8000/api/health/ready
npm run docker:test:mariadb
```

通过标准：

- `migrate` 退出码为 0。
- `api`、`mariadb`、`redis` 都是 healthy。
- readiness 中 MySQL、Redis 都是 `ok`。
- MariaDB 20 并发确认收款测试得到 1 个成功、19 个冲突且只生成 1 条分润记录。
- Electron 开发预览显式连接 `http://127.0.0.1:8000` 后行为与原本本地后端一致。

## 6. 测试与质量门禁优化

### 已发现并处理的问题

- 高负载 Electron 子进程协议测试在四 worker 并发时可能超过 30 秒；现已固定为单 worker 独立门禁并通过。
- 内部 E2E 的旧标题和浏览器文件选择器断言已更新为稳定工作区标识及 Electron 脱敏桥接边界，10 条验收已通过。
- 前端覆盖率基线已设为：语句 35%、分支 25%、函数 25%、行 39%；当前结果高于门槛。
- 本地无 MariaDB 时真实行锁并发测试会跳过；CI 已提供 MariaDB 11.4 服务。
- `npm run verify` 不直接执行浏览器 E2E；GitHub CI 会执行，但未推送提交没有远端结果。

### 实施原则

- 普通前端测试与高负载 Runner 子进程测试分开执行，后者固定单 worker。
- E2E 使用稳定 `data-testid` 锁定工作区，不再把营销文案当成唯一定位契约。
- 覆盖率先设置为当前可达基线，禁止倒退；随后逐步提高。
- 优先补路由守卫、Business Workspace、更新发布、运费管理、授权启动和异常恢复分支。
- 发布候选必须依次通过：安全扫描、类型、Lint、死代码、单元测试、Runner 工作流、桌面构建、后端门禁、MariaDB 并发测试、内部 E2E、包内容审计。

## 7. 生产容器化分期

### 阶段 A：只建立可验证镜像

目标：生成与 CI 一致的不可变后端镜像，但不替换线上进程。

- 镜像标签同时包含版本和短 Git SHA，例如 `1.8.0-caeef1d`。
- 记录镜像内容摘要，不使用可漂移的 `latest` 作为回滚依据。
- 对镜像执行依赖检查、敏感信息扫描、非 root/只读检查和 readiness smoke。
- 输出 SBOM 和依赖漏洞报告；高危漏洞未处置不得进入生产。

### 阶段 B：云服务器旁路验证

前置条件：SSH 运维入口恢复、当前数据库备份可恢复、磁盘空间充足。

- 宿主机 Nginx、MariaDB、Redis、更新目录保持不变。
- 测试容器先监听 `127.0.0.1:18000`，不接公网流量。
- 使用与生产相同的非敏感配置结构；密钥只从服务器受限文件注入，不进镜像、不进 Git。
- 只执行 live/readiness、OpenAPI 合同和只读管理探针；不创建真实订单、不发布更新。
- 比较容器与当前 systemd 服务的版本、数据库延迟、Redis、启动日志和内存。

### 阶段 C：后端容器切换

- 先执行当前 `deploy-backend.sh` 等价的数据库和文件备份。
- 停止旧 systemd Uvicorn，执行一次性 Alembic migration。
- 容器以宿主机网络模式运行时，Uvicorn必须只绑定 `127.0.0.1:8000`；不要把 8000 暴露到公网。
- 继续由宿主机 Nginx 代理和提供更新文件。
- 连续验证 live、ready、管理员登录、受保护接口和更新清单。
- 观察至少一个业务低峰窗口，再移除旧虚拟环境；在此之前旧运行目录保持可启动。

### 阶段 D：数据库和 Redis（可选，最后实施）

只有满足以下条件才考虑迁移：

- 完整备份已在隔离数据库成功恢复。
- 容器卷、磁盘告警、自动备份、异地副本和恢复时间均经过演练。
- 明确维护窗口和 DNS/端口回切路径。
- 数据库迁移测试覆盖订单状态并发、授权码、分润、审计日志和 Alembic 版本。

数据库容器化主要提供环境一致性，不保证自动提升性能。当前单机 MariaDB/Redis 健康时，没有必要把它作为第一步。

## 8. 生产数据与目录映射

首个生产容器必须显式映射并备份：

- `/var/lib/kesaitong-platform/updates`
- `/var/lib/kesaitong-platform/.updates-staging`
- 后端运行日志目录
- 上传/运行时目录（若实际启用）
- Chroma 数据目录（只有在线知识库模式启用时）

禁止把 `.env`、SSH 私钥、MySQL 密码、JWT 密钥和工具签名私钥复制进镜像层。

## 9. 安全与可观察性

- API 容器保持 UID/GID 10001、`no-new-privileges`、`cap_drop: ALL`、只读根文件系统和有限 tmpfs。
- MySQL/Redis 不发布公网端口。
- Docker 日志限制单文件 10 MB、保留 5 份；应用自身日志继续轮转。
- 生产使用 JSON 日志并保留 `request_id`，日志采集必须清理 token、Cookie、密码和表格原文。
- 监控 live、ready、5xx、P95、数据库延迟、连接池占用、容器重启、磁盘和备份年龄。
- 部署记录增加 Git SHA、镜像摘要和 Alembic revision，解决“只有版本号、无法定位代码”的问题。

## 10. 性能优化顺序

1. 修复测试失真与 worker 资源竞争。
2. 使用 Docker/BuildKit 的 pip 构建缓存，CI 复用 npm/pip 缓存。
3. Docker Desktop 数据盘放 D 盘并限制 WSL 资源，避免 C 盘耗尽和宿主机换页。
4. 保留数据库连接池 `pool_size=5`、`pool_pre_ping` 和 900 秒回收，先监控再调整。
5. ExcelJS 构建块较大，确保只在 Excel/运费页面按需加载，不放进首屏主包。
6. 根据真实 P95 和慢请求日志优化，不通过盲目增加 Uvicorn worker 掩盖数据库或同步阻塞问题。

## 11. 回滚清单

切换前必须记录：

- 当前 Git 提交、应用版本、Alembic revision、旧 systemd 单元和 Nginx 配置。
- 当前镜像摘要与上一镜像摘要。
- MySQL 压缩备份的大小、校验和与恢复演练结果。
- 更新目录和暂存目录的文件清单与权限。
- live/ready、管理员登录和受保护接口的基准结果。

回滚顺序：

1. 从 Nginx 移除新容器流量或停止新容器。
2. 启动旧 systemd 服务/上一镜像。
3. 验证 live、ready、登录和受保护接口。
4. 只有数据库迁移不向后兼容时才恢复数据库备份；禁止在不确认数据影响时自动覆盖生产库。
5. 保留失败容器日志、镜像摘要和部署记录用于复盘。

## 12. 完成定义

方案只有在以下证据全部存在时才算实施完成：

- 本机 Docker Compose 配置可解析，所有容器 healthy。
- 本地 MariaDB 并发测试不再跳过且稳定通过。
- 前端覆盖率门槛通过，Runner 子进程测试连续多次通过且无残留进程。
- 内部 E2E 全部通过。
- 镜像安全、非 root、只读和包内容审计通过。
- 云服务器旁路容器验证通过。
- 数据库恢复演练成功并记录耗时。
- 生产切换和一次真实回滚演练完成。
- 生产日志、指标和部署版本可以关联到 Git SHA 与镜像摘要。
