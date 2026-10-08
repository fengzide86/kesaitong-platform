# KST 业务网页版下线交付

## 范围与实际状态（2026-10-08）

以已发布 1.8.13 / `df0efeb6571371bd52619b01d65f79f509443d94` 为基线，在独立目录 `D:\开发项目\kst-web-retirement`、分支 `codex/kst-web-retirement` 实施，没有覆盖共享开发目录的未完成工作。

线上普通用户、团队、管理员及代理的业务网页已下线。旧页面响应为 302，固定目标 `https://kesaitong.top/#`；查询参数不转发，显式空 fragment 阻止浏览器继承旧 hash。旧脚本、CSS、图片、manifest、Web 版本文件等返回 410，不返回官网 HTML。`/sw.js` 以 JavaScript 和 no-store 返回清退程序。

正式官网内容及设计未改。手机和电脑浏览产品使用官网；执行工具、团队业务、管理员及代理操作使用 Windows 软件。不能把官网手机适配解释成手机可执行工具。

## 删除与保留清单

| 分类 | 处理 |
| --- | --- |
| 服务器旧业务 Web | 清理 `/var/lib/kesaitong-platform/web`，原兼容路径 `/var/lib/amazon-toolbox/web` 指向同一处；清理前清单 2,925 项、文件合计 64,369,099 字节 |
| Web 发布器 | 删除 `ops/deploy/deploy-web.sh`；CLI 不再构建、归档、上传或激活线上 Web |
| PWA / 网页更新 | 移除 vite-plugin-pwa 及专属依赖、public manifest、安装声明、WebUpdateNotice、web-version 轮询；不再生成 SW / manifest / web-version |
| 共享 UI | 保留用户、团队、管理员、代理页面和登录；安装包从 `app://toolbox/index.html` 加载界面 |
| 本地浏览器构建 | 保留 `build:web` 供本地预览和隔离 UI 测试；CI 产物名为 `local-renderer-dist`，不是服务器发布物 |
| 后端 / 更新 / TLS | 保留 `/api/`、`/updates/`、历史安装包、latest.yml、blockmap、HTTPS 和 ACME；下线工具不重启后端、不恢复或修改数据库 |
| 持久清退策略 | 保留 web-retirement.json、web-retired/nginx.conf 和 sw.js，普通历史后端恢复不得重新打开旧 Web |

## 备份与回滚

当前有效、非公开备份：

`/var/lib/kesaitong-platform/.web-retirement-backups/retire-20261008T045232Z-a61a2779`

备份目录权限 0700。包含 `web.tar.gz`（17,913,299 字节）、nginx.conf、原恢复脚本、带逐文件哈希的 manifest.json 及 acceptance.json。归档校验一致后才删除原文件；备份路径不存在静态公开映射。第一次切换因 Nginx reload 短暂仍响应旧页面而自动回滚，未清理文件；现增加最多 15 秒的收敛检查，仅重试旧网页响应，API / 更新清单变化立即失败。

本机另有完整备份副本 `D:\AmazonToolboxData\acceptance\kst-web-retirement\retire-20261008T045232Z-a61a2779`，归档、配置及原恢复脚本均再次与 manifest 的 SHA256 对照通过。原始备份和验收截图保存在该本地验收目录。

显式前端回滚（会重新开放旧网页，不是常规后端恢复）：

```sh
python3 ops/deploy/retire-web.py \
  --control-plane-url https://8.130.113.104 \
  --restore /var/lib/kesaitong-platform/.web-retirement-backups/retire-20261008T045232Z-a61a2779 \
  --allow-web-restore
```

该操作只还原网页产物、网页配置及下线前的恢复保护程序，不还原数据库。独立下线持生产发布互斥锁；存在未完成发布租约时拒绝执行。正常后端发布/回滚沿用下线策略。

## 已有验收证据

- 服务器 Linux：13 项路径、归档、清理/恢复、损坏拒绝、重载收敛与保护程序测试全部通过。
- 切换后公网：用户/团队/后台/代理旧入口 302；旧资源 410；清退 SW 200、JavaScript、no-store。独立发布 CLI 的下线探针再次通过。
- 清理后服务器：原 Web 目录不存在，私有归档仍存在；nginx 和 toolbox-backend 服务 active。
- 下线切换前后 API health live/ready 均保持 1.8.13 / df0efeb；latest.yml 哈希不变，安装包 Range 206 / 总长度 110,622,409。
- Chromium 清退：根 scope 和 nested scope 两场景通过；旧受控页面跳转固定官网、注销自身 SW、只删除该 scope 的 Workbox cache，其他缓存、Cookie、localStorage 保留。
- 隔离真实 API 六条 C / B / 管理员 / 代理流程通过，5 张实际截图视觉检查无本次改动引入的空白、裁切或遮罩问题。证据位于 `D:\AmazonToolboxData\real-e2e\run-w7zvYB`。
- Windows 实际包：1.8.13 启动 seed 7 组断言通过；1.8.14 替换 check 11 组通过，包括设备 ID、加密授权、用户设置和文件保留。证据位于 `D:\AmazonToolboxData\acceptance\kst-runtime-smoke-a814`。
- 1.8.14 桌面包审计：2,695 条目，禁止项为 0，生产加载与内部运行策略通过。
- 实际 1.8.14 Windows EXE 的四角色隔离登录及页面读取通过：普通用户、管理员、代理证据位于 `D:\AmazonToolboxData\real-e2e\run-qmqHkV`，团队补验位于 `run-Rlh7R1`；7 张新截图实际查看确认页面正确、无明显遮挡、溢出或布局错乱。关键登录、授权、记录、后台及代理 API 均为 200；测试进程未请求外网，无渲染异常。管理员用户公告 feed 403 是现有角色权限限制，已记录为非阻塞项，测试仅显式允许该路径/角色/状态，其他 4xx 仍失败。
- 单元测试 1,037 项、Electron workflow 6 项通过；类型、lint、架构、OpenAPI 兼容、API 契约、deadcode 和凭据审计通过。
- 独立官网的电脑/手机视觉及既有安装包下载验收见 [官网验收记录](./WEB_RETIREMENT_OFFICIAL_ACCEPTANCE.md)。官网当前展示 1.8.12，此次没有擅自替换其内容或下载链接。

正式新版本需依次经过最新 main、GitHub 七项 CI、完整 verify:release、安装包审计和四阶段发布器验收。新状态 schemaVersion=2，仅含后端/桌面产物；schemaVersion=1 历史记录保持原样，在任何网络、锁或写入前拒绝续跑。不以本地候选包冒充已发布安装包；最终发布状态及下载信息以发布器 state.json 为准。
