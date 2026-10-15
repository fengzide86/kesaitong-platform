# KST 运行框架与商业配置候选验收

本轮基于已发布的 1.8.17，准备以兼容性功能版本 1.9.0 发布。用户已于 2026 年 10 月 15 日授权完成并上线；套餐内容参考官网，UI 遵循平台自己的设计体系。发布前仍须完成同一提交的八项 CI 和正式发布器门禁，新价格及团队分配规则不随升级自动启用。

本次发布准备已只读核验线上后端与桌面更新仍为 1.8.17，服务严格就绪，生产 Python 3.12 和 SSH 可用。尚未执行本轮生产迁移、部署或客户端更新。

## 当前交付

源码位于 `D:\开发项目\kst-platform-framework`，分支为 `codex/platform-framework-commerce-20261015`。基线提交是 `cce11691da8d0707d2f3bce3b84e5c4c1a43d46d`；本轮修改尚未提交，该基线 SHA 不是候选完整源码身份。

- [工具接入和管理员配置说明](platform-framework-handoff.md)
- [运行合同及真实工具边界](TOOLKIT_RUNTIME_HANDOFF.md)
- [Windows 候选安装包](<D:/AmazonToolboxData/candidates/kst-framework-20261015-r1/KST Setup 1.8.17.exe>)：100,069,416 字节，Authenticode 为 `NotSigned`。

安装包仍使用基线版本号 1.8.17，仅供隔离候选验收，不能覆盖认作原正式包或直接作为正式更新发布。SHA256 为 `7E4E98082AEF12BC7CFF72634492C64620CB7D488FF518E3320992C7D1079404`。它不包含 Python 后端；新场景接口和迁移尚未上线，不能只安装此客户端就认为整套新功能可用于生产。

打包使用独立物理依赖目录 `D:\AmazonToolboxData\package-staging\kst-platform-framework-20261015-r1`，没有更换其他工作树的共享依赖，也没有执行安装覆盖。

## 已实现的业务范围

| 范围 | 本地实现与边界 |
| --- | --- |
| 账号现场 | 用户保持一个账号现场；管理员使用独立授权和隔离 Session，默认六个、最多十个；所有入口共用一个执行租约。失效权限仍可清理本人现场，恢复记录保留。 |
| 场景策略 | 管理端分配实训或比赛，精确 origin 校验，30 秒检查策略。比赛外开链接保留在受控窗口；恢复入口同样检查。用户不能自行切实训，旧训练入口不能覆盖管理端指定比赛入口。 |
| 工具合同 | 六阶段宿主及版本化输入、结果、现场合同已建立。实际运费 IPC 已接入；V2 写入保留原审核执行链，并提供六阶段适配模板。 |
| 商品与权益 | 商品草稿和版本、项目期限、购买快照、免费三项额度、服务次数与履约、退款权益核对。599 元不继承旧 B 端批量能力。39 元须选择具体已审核工具，空权益模板不能销售。 |
| 成员台账 | 每单显式分配金额、承担人、预览确认、暂留、线下已付和追加调账。旧账本和代理佣金独立。结算同时守恒每个子项池和每单分配金额，调账不能绕过原暂留条件。 |
| 公开目录 | 仅导出已启用商品的白名单字段，离线校验版本与内容哈希；内部比例及成员数据不进入公开目录。 |

套餐页保留免费体验、49／199／599 比赛套餐、69 实训套餐、39 元单工具次级入口及单独服务。199 元是主要推荐；颜色、字号、按钮、圆角和阴影来自平台共享 token，不复制官网营销大区或超大价格。

本轮清理只针对已确认的冗余：旧演示启动构造器、无调用的辅助导出及旧前端包装、重复百分比转换和恒等表达式。必要演示夹具、兼容协议、恢复日志、身份及回滚代码保留。两个本机烟测文件已登记为独立测试入口，不作为孤儿文件删除。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 前端和 Electron 单元测试 | 197 文件、2242 项及 6 项工作流测试通过；语句覆盖率 72.32%，行覆盖率 78.84%。首次并行覆盖率运行有一项授权传输夹具超时；定向复核及完整覆盖率重跑均通过，未放宽正式阈值。 |
| 后端全量测试 | 发布准备全量 1064 通过、17 跳过；新增代码覆盖率 89.00%。本机没有 MariaDB，相关跳过不能计作真实数据库通过。 |
| 静态与合同 | 五套 TypeScript 配置、ESLint、Ruff、mypy、架构与 API 合同检查通过；OpenAPI 270 个操作兼容检查通过。最后台账增量另通过定向 Ruff、mypy。 |
| 安全检查 | 凭据扫描通过；运行依赖零已知告警，两个构建依赖上游告警仍在有效审查期内；发布策略与真实安全子进程测试通过。 |
| 源码清理检查 | 文件级孤儿 0、未使用生产依赖 0；该检查不覆盖所有 Python 和动态调用。 |
| 真实控制面旅程 | 管理配置与新版套餐两个独立旅程通过，使用实际 FastAPI、隔离 SQLite 和测试身份，没有操作生产。 |
| 发布界面回归 | C/B 响应式 11 项、内部关键流程 24 项通过；这些桥接夹具检查不替代真实网站任务验收。 |
| 桌面现场 | 三个真实 Electron WebContentsView 的 Cookie、localStorage 隔离、切换保留、关闭清理、重开空会话及执行租约互斥通过。站点为本机测试服务，不是真实外部账号。 |
| 构建与安装包 | 桌面构建通过；NSIS SHA512、blockmap 和清单一致；包内 5779 条目，禁入文件 0，5 个根依赖和 200 个解析运行包、表格回读及语言包通过。 |
| 包内原生启动 | app 协议登录渲染、场景桥和目标桥、受审查合同检查通过；293 份编译及渲染文件哈希与当前构建一致，页面错误及外部请求为 0。 |

最后一轮现场截图曾因 Chromium 视图缺少可捕获表面失败；烟测显式使用保持视图唤醒的截图选项后重新通过，未删除失败证据或用静态图替代。

## 操作截图和证据

- 平台风格套餐页：[1440 宽度](D:/AmazonToolboxData/real-e2e/run-ZjvAub/commercial-pricing-1440.png)、[1024 宽度](D:/AmazonToolboxData/real-e2e/run-ZjvAub/commercial-pricing-1024.png)、[实训页](D:/AmazonToolboxData/real-e2e/run-ZjvAub/commercial-pricing-training-1024.png)。均无横向溢出；截图中的旧当前套餐和合成工具用于验证兼容与展示，不代表开放了新工具。
- 管理操作：[商品与订单](D:/AmazonToolboxData/real-e2e/run-dcDz56/framework-commercial.png)、[成员台账](D:/AmazonToolboxData/real-e2e/run-dcDz56/framework-ledger.png)、[场景配置](D:/AmazonToolboxData/real-e2e/run-dcDz56/framework-scenarios.png)。
- 三账号原生验证：[报告](D:/AmazonToolboxData/build-tmp/kst-native-scenes-evidence-vbatgn/report.json)、[账号 A](D:/AmazonToolboxData/build-tmp/kst-native-scenes-evidence-vbatgn/account-a.png)、[关闭重开](D:/AmazonToolboxData/build-tmp/kst-native-scenes-evidence-vbatgn/reopened-cleared.png)。
- 打包原生启动：[报告](D:/AmazonToolboxData/audits/kst-multi-target-candidate/native-start-MJQ1sU/candidate-runtime.json)、[登录截图](D:/AmazonToolboxData/audits/kst-multi-target-candidate/native-start-MJQ1sU/native-login.png)。

## 上线前仍需完成

1. MariaDB 的迁移、并发和事务验收。本机 SQLite 通过不能代替它，17 个跳过项中包含未配置的 MariaDB 集成测试。
2. 在已批准的学校站点和比赛场景做真实账号与工具验收。框架或付费权益不自动批准新平台、新动作；V2 写入仍通过原严格适配链，尚未完成通用宿主替换验收。
3. 官网静态构建接入稳定 SKU 与公开目录快照。两边当前价格和内容口径已协调，但官网尚无对应 catalogVersion，不能宣称已实现自动版本同步。
4. 核对真实成员归属、商业草稿、服务履约及代理关联订单退款规则。代理关联订单的部分退款在规则补齐前保持拒绝，不能套用全额冲回。
5. 源码已准备版本 1.9.0；冻结提交后完成所需发布门禁，先部署配套后端再交付客户端。上面的 1.8.17 候选包只保留历史验收用途，不作为正式更新上传。真实安装覆盖和生产迁移以新版本门禁及发布记录为准。

新界面继续从 `/user/plans`、`/admin/commercial`、`/admin/scenarios`、`/admin/local-runtime` 和 `/admin/team-ledger` 验收。普通浏览器只能核对页面；真实账号现场必须在 Electron 内验证。
