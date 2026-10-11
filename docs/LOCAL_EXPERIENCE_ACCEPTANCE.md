# KST 1.8.15 本地候选验收

## 2026-10-11：正式发布接续（尚未上线）

用户已授权发布并通知交付对话。本轮候选已收口到 PR #17；首轮提交 `e609759d6528a422b19fb173bc7adf92ccdadd11` 的 push/PR CI 均为 **6 项通过、2 项失败**，未合并或部署。下节“未提交/未推送”属于发布前本地验收快照，以本节接续状态为准。

- 新发现并修复的真实问题：SlowAPI 0.1.9 的 ASGI 中间件重复发送 `http.response.start`，造成代理 CSV 在 HTTP 200 后断流；请求追踪的 `BaseHTTPMiddleware` 还可能提前结束异常流，让截断文件看起来成功。两层均改为直接透传 ASGI 流，只注入一次响应头、不缓冲、不豁免限流；失败、取消和断开原样传递，ContextVar 用 token 恢复。新增 19 项流式/协议回归与独立安全 8 项共 27/27，相关 API 128/128；空表、gzip/identity、501 行跨页、跨代理拒绝及真实 HTTP 截断故障均有证据。
- Windows 门禁使用旧缓存目录寻找 NSIS 编译器，新干净 Runner 找不到；探针改为读取当前 electron-builder 自己解析的编译器与 `NSISDIR`。16 项专项及真实内存边界探针通过，实际安装/覆盖升级仍待新版 CI。
- CI 补充脱敏后端过程日志，保留真实异常堆栈，不上传测试凭据文件或原始过程日志。9 项日志/凭据清理回归通过，证据读取、写入或关流失败仍执行 owned 凭据清理，动态生成的授权码同样脱敏。
- 上述最终修复的六条真实后端旅程一次 6/6 通过（无跳过、无重试），证据 `ci-fixes/real-final/run-mCnUK5`；凭据文件已清理，脱敏过程日志未匹配 JWT、测试授权或动态授权码。此为本地真实后端，不代表生产或外部亚马逊平台执行。
- 最终后端完整覆盖回归更新为 **881 通过、14 个 MariaDB 项跳过、0 失败**，行覆盖 85.62%（16206/18928，项目原报告包含测试源码）；本次改动执行行覆盖 96.10%（74/77），通过 80% 门槛。证据 `ci-fixes/backend-final-with-streaming.*`；实库项由新 CI 独立执行，不把历史实库通过冒充本次结果。
- 发布前补验发现更新文件硬链接会保留私有暂存 inode 的组，可能让 Nginx 无法读取新安装包。已修复为在公开更新目录创建随机临时 inode，复制并 fsync 完整后才校正/回读 `www-data` 组与 `0640` 权限，再建立硬链接；清单同样校验，失败保留旧清单并清理临时文件。更新服务专项 **19 通过、3 个 Windows POSIX 项跳过**，证据 `ci-fixes/update-permission-fix-final.*`；Linux CI 负责真实 setgid/chown 分支。
- 官网只下载候选仍以官网对话最新模拟体验源码为准，未改 source/artifact/preview，也未连接公网。候选发布状态改为 schemaVersion=2 原子状态、O_EXCL 锁、断点树恢复、提交 checkpoint 识别和 `force-with-lease` 并发保护；`publication-recovery.test.mjs` 与守卫共 **19/19**，`check-local` 通过。候选没有 `publication-state.json`，未执行 prepare/publish；必须等核心正式发布产生真实 verified/released 回读后才能更新官网安装包地址。
- 服务器已并列准备 `/opt/kst-runtimes/python-3.12.15` 和 `/usr/local/bin/python3.12`，保留系统 Python 3.10 与原 1.8.14 venv，未重启业务服务。标准库、默认 CA/主机名 HTTPS 校验、Redis PING、数据库结构导出权限及 Nginx 配置预检通过；结构导出不等于完整数据备份/恢复演练。准备证据位于 `D:\AmazonToolboxData\release-workflows\preflight-1.8.15`。
- 官网以已发布来源 `0f637bc12a176df8b2137ecfe4e8343078981973`、公开提交 `863cb7f617504b08cf3790b50fb52864954ecd77` 为准。本轮先只发布系统；如更新官网下载地址，只使用该冻结源码且必须在新包公网验收后进行，不能覆盖为旧模拟体验。

发布失败证据和补验继续保存在 `D:\AmazonToolboxData\audits\kst-hardening-20261011\ci-fixes`。正式发布仍要求最终 main 同 SHA 的八项 CI、官方 `release --publish` 全门禁及生产回读，不能以本节准备完成代替上线成功。

## 2026-10-11：完整优化实施与新候选验收（当前接续入口）

**R01–R29 已完成本地实现与对应回归；下方“只审查、尚未修复”章节保留为此前审查快照，不代表当前状态。** 本轮使用原独立工作树，保留其他对话和此前全部未提交修改；没有提交、推送、部署或写入生产数据。当前工作区为 `D:\开发项目\kst-experience-fixes`，分支 `codex/kst-experience-fixes-20261011`，基线 HEAD `7d5affa9015bedff6f197294640a5ba174b2c5cb` 加本地修改。

### 本轮改变了什么

| 已实施项 | 当前行为与验证重点 |
| --- | --- |
| R01、R02 | 解绑设备不能靠旧 JWT 静默重新绑定；启动凭证消费时重新校验授权、席位、设备、批次及工具状态，重复消费拒绝。 |
| R03、R25 | 准备期也占用执行租约；清理、退出和账号变化使迟到启动失效；单条与批量共用原子执行锁。 |
| R04 | V2 的明确域名、8730/8732 端口共用导航/重定向策略，不放开任意 HTTP 地址。 |
| R05 | 本机文件按内容 SHA256 标识，提交前再核对；同路径改文件与同内容改名正确区分。原文件及完整路径不上传。 |
| R06、R07、R08 | 执行前预留可持久化回执容量；单条与批量均支持离线补传；迟到消息不能把成功行退回执行中。未知结果仍禁止盲目重跑。 |
| R09、R10、R11、R12 | 员工角色正确读取管理日志；授权字段服务端验证；延期使用一个原子接口；订单/支出/日志 CSV 共用公式前缀防护。CSV 字节回归通过，不冒称本轮启动了 Excel。 |
| R13、R14、R15、R16、R20 | 求助上下文按账号、平台隔离并一次性消费；字段统一且不自动发送；员工账号服务端搜索/分页，知识库切筛选重置页码，客服历史分页与刷新。 |
| R17、R18、R19、R27 | 万字公告可展开并支持键盘；失败与空列表分开；未知设置禁用写入并明确“待确认”；登录使用提交身份快照，离页迟到响应不能污染账号。 |
| R21、R22、R23 | Vue 纳入功能 lint；凭据扫描覆盖新增文件和常用后缀，普通注释不能掩盖真实值；增量覆盖报告缺文件/缺执行行即失败。 |
| R24 | 与官网最新已验收来源三方合并：84 个文件中 28 接收、47 相同、4 合并、5 保留本地；保留既定设计与隔离模拟体验，没有恢复业务 Web。逐文件来源和 SHA 见本轮证据。 |
| R26、R29 | 末个超级管理员保护及分润版本更新使用数据库事务守卫；真实 MariaDB REPEATABLE READ 验证并发/首次初始化。发现并修复驱动兼容及间隙锁死锁；只对写业务前的守卫事务进行有限重试，不重放外部业务。 |
| R28 | 更新文件按不可变文件名/内容身份发布；同名不同内容在写入前拒绝，私有临时文件原子就位，最后切清单；故障不损坏旧版本。 |
| 账号平台现场隔离 | 主进程根据已验证 KST owner 和平台选择浏览器分区；换账号销毁旧 Guest，保留旧 Cookie 文件但不挂载给新账号。真实包验证原生 Cookie 隔离；不宣称自动识别外部平台登录身份，启动仍提示核对。 |
| 依赖和发布环境 | 独立迁移到 Node 22.23.3 / npm 12.2.0 / Python 3.12、Electron 42.11.12；锁文件、CI、Docker、部署预检同步。旧环境保留；服务器没有在本轮升级。新增限时依赖安全门禁，补正式 1.8.14 → 候选的 NSIS 升级夹具。 |
| 验收补漏：真实限流 | 原后台登录与默认业务路由没有真正触发限流，常规 fixture 又将其关闭。现共用一个 Limiter 并安装默认中间件，独立进程证明后台登录第 6 次、授权登录第 11 次、默认路由第 61 次返回 429；必需 Redis 失效时拒绝业务，不隐式内存降级。 |
| 验收补漏：窄窗与中文路径 | 原生稳定截图发现团队概览标题被操作按钮挤成“专…”；1180px 及以下按钮回落内容区，宽屏不变。增量覆盖检查另补 Git 引号/八进制中文路径、特殊字符和未跟踪文件的 NUL 分隔，不能因文件名而漏查。 |

### 已取得的验收证据

证据根目录：`D:\AmazonToolboxData\audits\kst-hardening-20261011`。不同测试集存在重叠，**不相加冒称独立测试总数**。

- 前端/Electron 完整覆盖回归：164 文件、1591 测试通过；实际 Electron workflow 另 6/6。前端行覆盖 75.42%，语句 68.72%，分支 64.03%；不是全分支覆盖。最终窄窗标题另有 6/6 定向回归。
- 后端最终完整回归：862 通过、14 个实库项在通用环境跳过；这些 14 项已在本机独立 MariaDB 11.4.13 真实运行全部通过。最终行覆盖 85.93%（15978/18595），改动执行行覆盖 91.63%（646/705，门槛 80%），见 `backend-final-after-live-security.log/xml`。
- 不加载常规 conftest 的独立进程安全测试 8/8：真实 429、Redis 必需/可选故障、退出/停权后旧 JWT 拒绝及数据库 token_version 回读。已纳入 `test:review-gates` 和 CI；见 `rate-limit-live-final.log`。旧 blacklist 兼容模块不被宣传为完整登出机制，当前后台撤销由数据库版本保护。
- 实库历史迁移：不可变 1.8.8 历史数据升级、空库升级、约束、旧/新运行时边界、重复升级与不安全降级拒绝均通过。临时库只绑定本机，未装服务；验收后进程和监听已回收。
- 当前 accepted 包：管理员、客服、代理、个人端、万字公告、失败恢复、原生账号分区等 12 项均有成功证据，**首轮 9 + 定向补验 2 + 1，不是一次 12/12**。44 张截图及报告分别在 `desktop-accepted/after-UpnDQW`、`after-XPtkc4`、`after-KjpcRQ`。首轮失败来自真实登录限流及 worker 重启后复用测试 profile；另保留一次填入值被额外字符干扰的失败，原因仅记为疑似本机输入干扰。只修验收登录间隔、独立 profile 和焦点/填充值检查，没有放宽产品限流。最终包及汇总见 `desktop-hardening-evidence.json`。
- 四角色 32 页面共 72 个窗口/125% 缩放采样及 6 项原生角色/恢复流程通过，最终稳定画面在 `visual/visual-FvrskT`；不是网页截图冒充桌面。72 张已逐图人工检查（32 窄窗、32 宽窗、8 张 125% 缩放），未见新增阻塞布局问题。早期采样有合成帧未更新问题，修正取图方法后才发现并修复窄窗标题挤压；有效改前在 `visual/visual-VvGxcI`，不用旧帧假作验收。
- 本地 Web 构建和隔离审计通过；团队响应式 11/11。内部导航/权限 24 项全部有成功证据（首轮 23 + 正确设置接口 fixture 后定向补验 1）。旧版内部测试中的官网断言已迁到独立官网 64 项覆盖，不再要求业务 Web 呈现已清退的营销页面。首轮中断/失败日志保留，最终见 `business-accepted-e2e.json`、`internal-accepted-e2e.json` 和 `internal-accepted-recheck.json`。
- 官网：296 单元、17 发布脚本测试通过；原 64 浏览器场景初次 58 通过，6 条过时断言修正后补验 7/7（含 1 重复），使用同一官网构建；没有重新改 UI 迎合断言。
- 真实本机后端旅程：初轮 5/6，代理售后旧菜单定位修正后第 6 条完整通过；客户回读、回复写入、跨代理拒绝和导出隔离均保留。原失败和补验分别在 `real-e2e/run-CpTTtL`、`real-e2e/run-WSZrXE`。
- 类型检查、零警告功能 lint、API 契约、OpenAPI 209 操作、架构与死代码检查通过。审查门禁 34/34（含独立进程安全 8 项，不能再重复加总），真实临时 Git 仓库证明中文/特殊路径纳入覆盖统计。NSIS 产物与更新清单 SHA512 一致；5941 包内条目无禁入项，200 个运行依赖解析闭合。
- npm 运行依赖和 Python 锁定依赖扫描无已知告警，凭据扫描 0；两个未获上游修复的构建期告警 `braces` / `sprintf-js` 明确限期至 2026-10-25，不属于“所有依赖零漏洞”。新增/过期例外均阻止门禁通过。
- 归档恢复离线用例 11 通过、2 个 Windows 符号链接权限用例跳过；证明临时文件恢复和失败保护，不证明生产数据库、附件和系统服务的整组恢复。
- [改前／改后验收对照](D:/AmazonToolboxData/audits/kst-hardening-20261011/验收对照.html)：15 组、21 张精选截图，无改前证据的项目明确标为新增验收。1440/390 布局无横向溢出、坏图或脚本错误；本地预览仅开放此页和选中的截图，不开放测试数据库、profile 或其他证据文件。

### 当前安装包身份

- 本地最终候选：`D:\开发项目\kst-experience-fixes\release-hardening-accepted\KST Setup 1.8.15.exe`
- 大小：110599387 bytes；SHA256：`F34702218E1114903D3E28592FA78670497BC12A260842E15ED4D01E509CEAD1`。
- 包内 EXE SHA256：`54655C78DBC0F3DD8BED14A11AE06AF16B5B7E55E465FD565FB5588AFB47C6BC`；`app.asar` SHA256：`44B5CC5A9E04FF5C12A60AA7076FF15FD4569CDA16AFCA32884D121274164F9A`。
- 保留未签名 Windows NSIS 的既定发行选择；日志中出现 signing 步骤不等于实际签名，Authenticode 实测为 `NotSigned`。
- `release-admin-ux/` 是此前包，`release-hardening/`、`release-hardening-final/` 是本轮中间包，均保留、不当最终交付。相同 1.8.15 版本以路径和哈希区分。

### 未偷换为“全部已上线”的边界

1. 本轮可在本机完成的源码与候选验收已经分项记录；还没有远端 CI、生产发布或客户机的成功证据。新客户端依赖新原子延期等后端能力，**先发兼容后端再发客户端**，这个包不应现在直接替换面向客户的正式版。
2. NSIS 1.8.14 升级夹具已按正式清单下载并核验哈希；实际安装/覆盖升级/卸载需专用临时 Windows 环境，未绕过安全检查在用户当前电脑安装或改注册表。
3. 真实 Redis 服务、多 worker、服务器 Nginx/Python 实际版本、异地备份/整组恢复、证书与磁盘告警需部署窗口核验。代码存在或模拟断连通过不等于已经上线。
4. 真实亚马逊工具由工具负责人对具体任务验收；本轮没有调用真实账号或平台，也不把官网样例、Runner 协议和本机后端成功当作真实商品/订单操作成功。
5. 安装新版测试浏览器时触发过工具自带旧缓存回收，已恢复 1228、1243 两组 Chromium/Headless 与 ffmpeg1011，并实际启动验证；包装器现默认禁止共享缓存自动回收。没有删除原工作区或用户资料。

---

## 2026-10-11：完整范围复核与统一待办（本轮只审查，尚未修复）

**结论：还有需要处理的内容，不能把下方已有测试通过等同于整个项目零缺陷或可直接发布。** 这轮按项目检查规范并行追踪前端、Electron/Runner、后端业务和发布运维，未改产品逻辑、安装依赖、连接生产或执行真实平台业务。保留已完成修复；以下为当前源码的待办，不是已经上线发生的事故。部分已通过纯内存真实 HTTP 或受控模拟复现，其他是代码路径确认；未重新做视觉、安装升级和生产验收。

范围包括个人/团队、管理员/代理、登录与授权、工具/恢复、客服/公告、订单/支出、数据库、打包/发布、官网源码身份、质量检查。对 `src/electron/backend/scripts/ops/.github` 枚举约 803 个文件以确定覆盖面，**不宣称逐行证明全部文件正确**；独立运营产品和飞书不在本轮代码审查范围。

### 继续补查：并发、迟到响应与发布失败（R25–R29）

本次又确认5项，包含将原“单条与批量互斥”待验项升级为R25；累计登记R01–R29，不把原待验项重复计数。它们是代码缺陷及交付缺口的待办数量，不是29个安全漏洞，也不说明线上已发生29起事故。只补充文档和证据摘要，未修产品代码、更新依赖、重打包或操作线上。新探针使用隔离HTTP/内存夹具或临时目录；正式MariaDB、真实浏览器与生产更新仍未在本轮验证。

| ID / 优先级 | 新确认的问题与触发条件 | 验证结果及准确边界 | 修复关闭判据 |
| --- | --- | --- | --- |
| R25 / P1 | 单条已运行，再启动批量时，两入口没有共用执行锁 | 加载当前受信IPC、参数schema、控制器、协调器和恢复账本；替换网络/进程/浏览器副作用后，得到singleRunActive=true、batchActive=true，两个Runner各获恢复写入ACK并接受浏览器动作。不是R03的准备期清理竞态，也没有在真实平台执行两笔业务。[单条入口](D:/开发项目/kst-experience-fixes/electron/automation/desktop-automation-controller.cts:370)、[批量入口](D:/开发项目/kst-experience-fixes/electron/automation/desktop-batch-controller.cts:209) | 主进程原子获取共用执行租约；覆盖单条→批量、批量→单条、同时启动、取消和迟到事件；最多一个执行获得页面动作权限，保留等待人工的调度语义。 |
| R26 / P1 | 两名超级管理员并发停用对方，末个管理员保护不具备全局原子性 | 真实FastAPI路由/鉴权+内存SQLite受控交错，延迟真实COUNT返回而非伪造：两次COUNT均2、两次HTTP200，最终启用超级管理员为0。当前锁的是不同目标行；MariaDB并发仍需专项验收。[数量检查](D:/开发项目/kst-experience-fixes/backend/services/staff_service.py:76)、[更新事务](D:/开发项目/kst-experience-fixes/backend/services/staff_service.py:231) | 减少启用超级管理员的操作争用同一事务守卫，取得后重查权限和数量；两个/三个管理员同时停用或降级后始终至少保留一名，失败必须回滚。 |
| R27 / P2 | 授权登录请求在途时仍能改输入，成功回调读取的是新输入而非已提交快照 | 直接调用当前登录逻辑和真实Zod契约，模拟A请求挂起→输入改B→A成功，保存A的token/user_id加B的auth_code，记住的也是B；实际轮询读取Auth.get()。未证明取得他人权限。页面离开后的迟到完成保护也应在同根因修复中覆盖。[登录回调](D:/开发项目/kst-experience-fixes/src/features/auth/useLicenseLogin.ts:98)、[可编辑输入](D:/开发项目/kst-experience-fixes/src/views/user/LoginView.vue:91) | 固定提交身份/设备快照，并以请求世代或取消机制保护离页及新登录；测试输入修改、切管理员登录、返回页面、旧失败晚于新成功、记住身份一致。不能仅禁用输入框。 |
| R28 / P2 | 不同更新版本使用同一安装包文件名，复制中途失败会破坏仍在线的旧版本文件 | 在临时目录发布2.0.0后，以相同setup.exe暂存2.0.1；注入后续blockmap复制失败，latest.yml仍是2.0.0但安装包已被覆盖，旧manifest哈希不再匹配。只执行服务代码和虚构字节，不运行安装包。标准CLI当前含版本的命名降低正常路径风险，缺口在允许同名文件的上传/发布接口。[直接覆盖](D:/开发项目/kst-experience-fixes/backend/domains/updates/service.py:184) | 文件使用不可变版本/内容身份，已存在不同内容的公开名字须在任何写入前拒绝；新文件先私有暂存并原子就位，最后切manifest。故障注入后旧安装包、blockmap及清单必须仍一致。 |
| R29 / P2 | 分润策略在加锁前计算新版本，并发更新可能让不同策略拥有同一版本号 | 真实HTTP/内存SQLite交错，两请求均读版本1并200返回版本2，但比例分别0.40/0.50，审计也有同版本不同内容。订单另存比例和金额快照，未发现历史金额重算或资金损失。[策略更新](D:/开发项目/kst-experience-fixes/backend/services/profit_service.py:59) | 读取、校验、递增、写入和审计同一锁内完成，或用expected_version拒绝过期编辑；并发应产生2/3或一成功一409，含首次初始化与真实MariaDB回归。 |

[本轮隔离探针结果摘要](D:/AmazonToolboxData/audits/kst-code-release-review-20261011/deep-review-probe-summary.json)记录五项的方法、结果与边界，是审查汇总而非伪称保存了完整可重放脚本。没有重跑之前已经成功的1539项全量测试；这些新组合必须在修复时补为固定回归。

本轮同时核对且不新增为故障：旧refreshToken辅助路径未被当前登录UI接入，不能强行调用后冒充现有用户故障；客服历史和执行记录已有请求序号保护；退出授权已有Runner epoch隔离，未证明旧回执串到新账号；客服/附件归属与订单分润快照未发现新的实证越权或金额错误。发布回滚代码的既有备份、目录边界及业务Web下线保护不因本节而判定失效。

### 第一批：执行与授权边界，优先于继续增加功能

| ID | 待处理项及触发条件 | 事实/影响边界 | 修复通过判据与定位 |
| --- | --- | --- | --- |
| R01 | 解绑设备后旧 JWT 能直接再申请工具启动 | 内存数据库+真实 HTTP 已复现：同用户另有有效席位、设备配额空出时，旧 Device 被静默重建，无须重新登录；与界面“重新授权”说明冲突 | 启动按当前设备有效席位校验；解绑撤销该设备会话/待用凭证，兼容迁移只能走明确登录流程。测试解绑后旧 JWT 拒绝、保留设备正常、重新登录恢复。[签发服务](D:/开发项目/kst-experience-fixes/backend/domains/automation/launch_service.py:201) |
| R02 | 冻结授权后，已签发 pending grant 仍能被消费 | 真实 HTTP 复现 freeze→verify success；窗口受 300 秒 TTL 限制，不是无限使用。消费未重新检查授权/设备/批次实时状态 | 同事务检查并原子消费；冻结、删除、解绑、取消关联待用 grant。覆盖签发与消费之间的状态变化、过期与重复消费。[消费入口](D:/开发项目/kst-experience-fixes/backend/domains/automation/launch_service.py:359) |
| R03 | 任务正在准备启动，却被更新/退出判断为空闲 | 当前源码受控模拟：auth 请求挂起时 hasActiveWork=false；cleanup 后放行请求，仍创建 Runner。尚未实际安装更新或运行外部任务 | 准备期纳入全局活动，清理关闭新启动并作废迟到请求；每个 await 点挂起后清理，均不能复活任务。[桌面控制器](D:/开发项目/kst-experience-fixes/electron/automation/desktop-automation-controller.cts:161)；[更新保护](D:/开发项目/kst-experience-fixes/electron/core/update-manager.cts:211) |
| R04 | V2 平台后续 HTTP 导航/重定向被 WebView 拦截 | Runner 允许精确 V2 域名端口，但实际 will-navigate/will-redirect 处理器拒绝；受控事件已复现。不是声称初始 about:blank/loadURL 一定失败 | 共用精确域名/协议/端口策略，不放开任意 HTTP；验证登录8730→8732、列表→详情→提交跳转，拒绝其他目标。[导航策略](D:/开发项目/kst-experience-fixes/electron/security/navigation-policy.ts:41)；[实际处理器](D:/开发项目/kst-experience-fixes/electron/core/main-window.cts:35) |
| R05 | 单条文件输入的恢复指纹只算路径，不算内容 | 受控账本复现：同路径改内容仍被旧成功记录拦截，同内容改名却放行。批量解析行指纹不在此结论内 | 本机内容摘要结合目标账号/业务键/工具版本；重选和提交前复核。覆盖同路径变更、同内容改名、选择后改文件；不上传内容/完整路径。[恢复指纹](D:/开发项目/kst-experience-fixes/electron/automation/recovery-store.cts:16) |
| R06 | 单条回执队列满时，容量检查晚于业务执行 | 断网模拟201份成功回执仅200份落盘，第201份报满且未保存；未执行任何真实业务 | 执行前原子预留回执槽位/验证持久化能力；覆盖200/201、磁盘故障、重启、恢复联网，不用重跑业务补记录。[回执队列](D:/开发项目/kst-experience-fixes/electron/automation/execution-report-outbox.cts:83) |
| R07 | 批量执行明细没有接入持久化回执补传 | 批量 Runner 仍直接 HTTP 上报，失败只警告；已有批次 outbox 只保存行/批次摘要，不能补 execution report。不是说所有批次记录都丢 | 单条/批量共用主进程持久回执服务，补 host handler 而非只加环境变量。成功→上报断网→退出重启→明细与摘要均回读且只补一次。[批量启动](D:/开发项目/kst-experience-fixes/electron/automation/desktop-batch-controller.cts:316)；[上报分支](D:/开发项目/kst-experience-fixes/electron/automation-runner.cts:651) |
| R08 | 运行中批次的成功行被迟到 running 消息覆盖 | 内存事务复现 completed→running、completed_at 清空；已有父批次终态保护不足。尚未证明造成真实重复提交 | 行级终态单调，事件版本/attempt 身份校验；失败恢复新建尝试，成功项不可被旧消息覆盖。测试乱序、重放及旧 attempt。[批次更新](D:/开发项目/kst-experience-fixes/backend/domains/automation/business_service.py:300) |

### 第二批：后台管理、客服与数据正确性

| ID | 待处理项及触发条件 | 事实/影响边界 | 修复通过判据与定位 |
| --- | --- | --- | --- |
| R09 | 管理日志仍按旧 role=admin 判断权限 | staff.id与customer.id不同的真实HTTP复现：超级管理员查询客户日志/导出/工具列表均空；新内部角色被误按客户过滤，旧测试ID碰巧相同可遮蔽 | 用现有 capability/角色体系，普通客户保持owner限制；不同表ID、多客户、各内部角色及代理边界回归。[日志列表](D:/开发项目/kst-experience-fixes/backend/routers/logs.py:88) |
| R10 | 授权写API接受负数、无效状态/日期等 | Schema实测接受负count/期限/配额及nonsense状态/not-a-date；存在零生成假成功、脏状态、500和无发码上限风险，不等于已发生生产脏数据 | 数字范围、枚举、datetime/时区、plan有效性与合法状态迁移在服务端收紧；无效请求422且零写入，保留合法旧调用。[授权Schema](D:/开发项目/kst-experience-fixes/backend/schemas/auth_code.py:19) |
| R11 | 显式过期授权的延期恢复仍是两次PUT | 上轮已登记：其间另一管理员冻结时存在状态覆盖窗口。不是将上轮已修复的自然过期问题重新算未修 | 服务端单一事务/版本条件的续期操作，前端只调用一次；并发冻结、删除、续期不得互相覆盖。[延期调用](D:/开发项目/kst-experience-fixes/src/views/admin/AuthCodesView.vue:694) |
| R12 | 普通订单、支出、日志CSV文本未防公式前缀 | 原函数无害样本=1+1原样输出。代理CSV已有防护；未实际打开Excel，不声称发生代码执行 | 共用文本编码，处理前导空白和公式入口，数值金额保持正确；三类导出与代理一致，补实际Excel验收。[订单导出](D:/开发项目/kst-experience-fixes/backend/routers/orders.py:30)；[支出导出](D:/开发项目/kst-experience-fixes/backend/routers/expenses.py:41)；[日志导出](D:/开发项目/kst-experience-fixes/backend/routers/logs.py:50) |
| R13 | 求助失败后切换账号可能自动发送上一账号摘要 | localStorage交接无owner；创建会话失败提前返回不清键，退出也不清。仅确认诊断摘要串号路径，不扩为密码/原表泄露 | 账号归属的一次性交接、退出清理与读时归属复核；A求助失败→B登录→帮助不能读/发A内容。[接收与自动发送](D:/开发项目/kst-experience-fixes/src/features/ai/useCustomerSupportChat.ts:257)；[退出清理](D:/开发项目/kst-experience-fixes/src/utils/auth.ts:120) |
| R14 | 执行记录求助字段不一致 | 发送error_code，接收problem_code；还缺执行模式/核对/同步状态，说明退化为泛化求助 | 共用类型契约；失败、结果待核对、待同步、预检均带正确说明，不附原始业务内容。[发送方](D:/开发项目/kst-experience-fixes/src/views/user/LogsView.vue:150)；[接收方](D:/开发项目/kst-experience-fixes/src/features/ai/useCustomerSupportChat.ts:272) |
| R15 | 内部/代理账号超过100后剩余账号界面不可达 | 前端只取第一页100条并丢弃total，后端实际支持分页 | 服务端分页+搜索，105账号能找到第101个并修改回读；不靠无限增大limit。[账号管理](D:/开发项目/kst-experience-fixes/src/views/admin/StaffAccountsView.vue:127) |
| R16 | 知识库在后续页筛选会显示假空数据 | 筛选沿用旧page，总量≤20又隐藏分页，可能没有回第一页入口 | 筛选重置页、删除越界回退、请求序号隔离；第二页精确搜索/清除/末页删除/逆序响应回归。[知识库](D:/开发项目/kst-experience-fixes/src/views/admin/KnowledgeView.vue:248) |
| R17 | 长公告无法完整阅读却能标成已读 | 横幅单行、消息中心三行截断，点击只标已读，没有全文入口 | 完整详情、换行/窄窗/键盘可读，关闭后能回看；全文可访问后才标读。[消息中心](D:/开发项目/kst-experience-fixes/src/features/announcements/MessageCenter.vue:22) |
| R18 | 消息首次加载失败被展示成暂无消息 | store无独立错误状态；加载结束空数组触发空状态 | 加载/空/失败/旧数据未更新分开；首请求断网与已有消息刷新失败都能就地重试。[公告Store](D:/开发项目/kst-experience-fixes/src/features/announcements/store.ts:44) |
| R19 | 专业工作台设置读取失败被当成未开放 | 单独getSettings失败时默认false，未显示独立失败且仍可写开关 | 未确认显示unknown、禁止该项写入并重试；四类请求逐一失败，不能将unknown当false/0。[工作台配置](D:/开发项目/kst-experience-fixes/src/views/admin/BusinessAccessView.vue:210) |
| R20 | 客服历史最多20条，打开历史不刷新 | 固定取第一页20，仅挂载时拉取；较早会话不可达，本次新会话可能也不在列表 | 分页/更多、打开时刷新、失败状态；25条历史及刚完成咨询可回看。[客服历史](D:/开发项目/kst-experience-fixes/src/features/ai/useCustomerSupportChat.ts:219) |

### 第三批：检查机制与发布来源，避免“测绿但漏查”

| ID | 已确认检查/发布缺口 | 修复与验证要求 |
| --- | --- | --- |
| R21 | 默认lint命令未包含.vue；补扫108个Vue文件得到2文件7个unused错误及6981条warning（多数格式类，不能算6981个业务bug） | 将Vue脚本/模板纳入门禁，先修7个错误，格式警告单独分批/增量基线处理，不全仓无关格式化。[lint入口](D:/开发项目/kst-experience-fixes/package.json:64)；[扫描报告](D:/AmazonToolboxData/audits/kst-code-release-review-20261011/vue-eslint-full-review.json) |
| R22 | 凭据扫描按整行安全词跳过，且未覆盖.vue/.mjs及未跟踪源码 | 合成非真实密钥样本只加localhost注释就由命中变不命中；不说明仓库已泄密。改为值级占位符/精确允许列表，覆盖相关源码后缀及新增文件，扫描不输出真实凭据。[扫描器](D:/开发项目/kst-experience-fixes/scripts/audit_secrets.py:35) |
| R23 | Python增量覆盖率会静默忽略报告中缺失的新文件 | 内存夹具“新增3行、coverage无该文件”得到exit0与100%、0行；需检测应测文件漏记，真正不可执行/豁免项显式说明，避免旧/空报告通过。[覆盖率检查](D:/开发项目/kst-experience-fixes/scripts/check_diff_coverage.py:96) |
| R24 | 候选官网源码落后于另一个对话最新已验收发布来源 | 本候选来源96a14e；本机正式发布记录的source为0f637bc、static为863cb。选定官网源文件22项差异/缺项是版本差异，不是22个新bug。下一次联合发布必须三方合并并重验，不能覆盖官网最新SEO/模拟框/联系等改进。[官网发布记录](D:/AmazonToolboxData/marketing-review-20261011-8Ot2kr/accepted-release.json) |

补充检查证据：[门禁诊断](D:/AmazonToolboxData/audits/kst-code-release-review-20261011/full-review-gate-probes.json)。R01/R02/R09的隔离HTTP、R03/R04/R05/R06/R08的受控模拟及Schema/CSV诊断结果保留于本轮审查工具输出；未另存的脚本/日志不伪称已经落盘。前一节1539个测试通过仍有效，但不覆盖本节新增的不同ID、旧凭证、迟到事件、满队列、部分失败等组合，后续应补成固定回归。

### 第四批：已有升级需求和必须补齐的验收

以下是上一轮8类验收边界；其中第3项现已升级为R25，不再重复算待确认项，其余7类仍需补验，不能跟R01–R29简单相加称为漏洞数：

1. **依赖安全迁移**：沿用下节npm审计与官方公告，优先Electron/自动更新、FastAPI/Starlette/multipart、Python基线，再处理数据库/认证及传递依赖。当前security:audit不是CVE检查，应建立有明确豁免与时限的依赖检查；共享junction不能直接更新。
2. **同机平台账号隔离**：单条浏览器使用固定persist分区；切换KST授权后旧平台登录可能仍在。先明确共享电脑/多客户规则，再验证目标账号提示、身份匹配、主动退出；不能擅自清全部Cookie或宣称一定越权。[工作区分区](D:/开发项目/kst-experience-fixes/src/components/ToolWorkspace.vue:58)
3. **单条与批量互斥（已升级R25）**：隔离IPC验证已确认双Runner可同时接受页面动作，见上方R25；不再作为独立待确认项计数，修复后仍须验证真实窗口与调度语义。[批量协调](D:/开发项目/kst-experience-fixes/electron/automation/batch-coordinator.cts:250)
4. **真实数据库/生产依赖**：补MariaDB迁移与行锁并发、Redis断连/撤销/限流、上传故障、同版本启动/回滚；SQLite及本轮内存HTTP不能替代。生产实际Python、Nginx、Redis、MariaDB版本未在本轮核验，不能断言都已升级或有故障。
5. **备份、监控与留存**：已见部署前同机备份与恢复脚本，仓库证据不足以确认定期异地备份、恢复时限/数据容许损失、证书续期告警、磁盘/日志轮转、过期备份清理已上线；需读真实运维配置并做隔离恢复演练，不能因仓库没有timer就断言服务器没有。
6. **新安装包与更新链路**：此前候选不含上一轮新增修复；本轮也未重打包。当前CI升级夹具只覆盖1.8.5/1.8.7/1.8.8，需核对实际发布清单并补当前正式版本→新候选的升级，保留旧历史夹具。安装、覆盖升级、卸载保留用户数据、断点下载、更新时任务保护都要跑。[CI升级基线](D:/开发项目/kst-experience-fixes/.github/workflows/test.yml:350)
7. **视觉与可访问性补验**：原已验收短文案截图保留；新修复后补长公告10000字、125%缩放、窄窗、键盘焦点圈定/返回/Escape、首次及部分断网。代码审查不冒充新截图验收。
8. **真实工具接入**：模拟站与Runner框架验收不等于每个工具已完成；由工具负责人按operation_id、页面上下文、同对象回读补真实成功/失败/恢复证据，费率按来源与版本适配，不套用未核实V3规则。本轮不代替另一同事开发真实工具。

### 不需要借此推倒重做的部分

目前已有且应保留：C/B/员工/代理路由隔离、代理对象范围、订单与退款事务/唯一约束、员工停用与token_version、文件路径与证据目录保护、sandbox/contextIsolation、潜在写入前持久确认、未知结果禁止盲重试、发布租约/产物校验/业务Web持续下线。未签名是已经接受的发行取舍，后续扩大分发可另排，不应借全面审查强行重做官网、拆安装包、重开业务Web或追升全部主版本。

建议按本节四批执行，并将R25/R26优先纳入执行/授权边界，其余新增项归入对应登录、发布和经营模块。每一批均以“修复→新失败用例变绿→原回归不退化→对应实际窗口/隔离旅程→写明包与源码身份”关闭；R01–R29目前是审查待办，未因写入清单自动算已修。仍使用本文件、AI_GUIDE及共享current-status作为唯一接续入口。

## 2026-10-11：代码、发布流程与依赖复核（尚未重打包）

本节接在下方界面/管理流程验收之后，记录新增源码修复和独立的安全依赖检查。**界面验收通过不等于依赖安全迁移或正式发布通过。** 这轮没有推送、部署、更新生产服务或制作新安装包；下方 `release-admin-ux` 候选的哈希未变，不包含本节新增修复。

### 已修正与实际验证

| 范围 | 修正前 | 修正后及证据 |
| --- | --- | --- |
| 授权延期 | 自然过期的未激活授权在延期后被强制改成 active，可能出现登录成功但没有用户身份、受保护请求 401 | 按更新接口返回的状态决定是否恢复；显式过期按 user_id 区分 active/unused，不覆盖返回的冻结/删除状态。纯内存复现及真实 HTTP 回归覆盖。 |
| 授权解冻 | 以设备/席位数推断是否曾激活，解绑所有设备后可能被误还原为 unused | 按真实 user_id 判断；已激活用户解绑、冻结、解冻、重新登录保留同一用户，未激活授权首次登录只创建一个用户。 |
| 发布续跑 | main 前进就拒绝原发布；后端已经完成但未写 checkpoint 时，可能重新部署 | 同一原 SHA 仍在 main 历史即可续跑，其余 CI/版本/目标/产物/租约门禁保留；部署前先记尝试，未知结果先核对线上身份、严格就绪与业务网页下线，不盲目重复。离线发布回归 17/17。 |
| Node/CI | 本机与五处 CI 硬编码版本容易漂移 | `.node-version` 升到 22.23.3，五处 CI 共读；发布策略检查拒绝竞争的硬编码版本。官方 ZIP 经 SHA256 核验，并列保留旧版本，不修改系统 PATH。 |

本轮最终验证：

- Node 22.23.3：前端/Electron 全量 **1539/1539**，无跳过；完整 app/test/Electron/node/E2E 类型检查通过；`release:policy` 通过，其中发布恢复 17/17，网页清退 Python 13 项中 2 项因主机不允许符号链接跳过，未计为通过。
- 授权专项：前端三个文件 20/20（已包含在全量内，不另累加）；真实隔离 HTTP 后端 31/31，app/test 类型、Ruff 与 ESLint 错误门禁通过。后端专项使用本机 Python 3.12.14，不等于 Python 3.10 CI 或生产数据库验收。
- 本机 Python `pip check` 无依赖冲突；它不扫描安全漏洞。`git diff --check` 通过。既有安装包重新计算 SHA256 仍为 `D66A97B7EAA426B91799A28272D34DA4B41D7C6000F5E0A66C548AE4044E1C72`。
- 本轮没有更改模板、CSS 或页面布局，不新增“视觉已改善”的声明；先前截图仍是先前安装包的视觉证据，不伪装成这轮重新打包截图。

审计结果保存在 [代码与发布复核证据](D:/AmazonToolboxData/audits/kst-code-release-review-20261011)：`unit-final.json`、`unit-final.log`、`typecheck-final.log`、`release-policy-final.log`、`npm-audit-before.json`、`npm-audit-runtime.json`、`npm-outdated.json`、`node-official.json`。授权专项完整执行结果在本轮工具输出中；不把未保存的日志写成现有文件。

### 需要升级，但本轮没有冒充已完成的部分

2026-10-11 npm 官方仓库审计：依赖图有 **38 个受影响包条目**（1 critical / 26 high / 11 moderate）；仅 `--omit=dev` 得到 4 个 high 条目。两组不是独立漏洞数，也不证明每条可由公网利用。Electron/Vue 虽在 devDependencies，仍会进入安装包或前端产物，不能用 runtime-only 结果排除其风险。当前 `security:audit` 实际只做凭据扫描，没有覆盖这些 CVE。

| 优先级 | 依赖/工具现状 | 后续升级与验收边界 |
| --- | --- | --- |
| 发布前处理 | Electron 42.4.1；electron-updater 6.8.3 及 builder-util-runtime 漏洞链 | 优先同大版本 Electron 42.11.12、updater 6.8.9；配套评估 builder 26.15.3。重新验证 sandbox/preload、登录、Runner、更新下载/断点下载和安装升级，不能只以 npm 安装成功为准。 |
| 发布前处理 | FastAPI 0.115.0 / Starlette 0.38.6 / python-multipart 0.0.9 | 文件上传解析存在安全公告；FastAPI 的 Starlette 版本约束阻止单独硬升，需隔离升级整组并验证 OpenAPI、认证、上传、异常和真实后端旅程。应用上传大小判断在解析后，不能替代解析器修复。 |
| 发布前处理 | Python CI/Docker/约束仍以 3.10 为基线，官方支持已结束 | 协调迁移受支持解释器与依赖约束、Ruff/mypy/CI/Docker，再核验部署机器的真实解释器。本次未连接生产，不断言线上正在使用 3.10。 |
| 发布前处理 | aiomysql 0.2.0 | 官方恶意 MySQL 服务端读取客户端文件公告修复于 0.3.0，候选同系 0.3.2；项目使用该驱动，需要 MariaDB 迁移/并发验收，不能以 SQLite 通过替代。 |
| 配套更新 | cryptography 43.0.1、PyJWT 2.9.0；tar、brace-expansion、js-yaml 等传递依赖；Vue 3.5.40 | 按官方公告与实际调用路径更新锁文件并复验。未证明本项目触发所有公告攻击条件，仍应消除已过时依赖；候选 Vue 3.5.43 不要求直接跳大版本。 |
| 暂不盲升 | bcrypt 4.3.0→5、TypeScript 6→7、Vue Router 4→5、SQLAlchemy 2.0→2.1 | bcrypt 5 会拒绝超过 72 字节密码，现有界面允许更长；SQLAlchemy 2.1 要求 Python≥3.11。需迁移设计、历史密码/行为兼容和完整回归，不运行 audit fix --force。 |

该工作区 `node_modules` 是通往另一工作区的 junction；本轮未执行 npm install/update/ci、未修改锁文件、未升级共享 Python 环境。依赖升级应在独立环境完成，不能损坏其他对话仍使用的验收基线。

另一个已识别的代码边界：显式 expired 授权的延期恢复仍由两次 PUT 完成，之间若另一管理员冻结，存在并发覆盖窗口；需要服务端原子操作和并发测试，本轮未新增接口，也不宣称解决。正式发布前连同依赖升级、MariaDB、NSIS 新安装/覆盖升级、生产配置与回滚门禁一起验收。

官方依据：[Node 22.23.3](https://nodejs.org/en/blog/release/v22.23.3)、[Python 支持周期](https://devguide.python.org/versions/)、[Electron 42.11.12](https://releases.electronjs.org/release/v42.11.12)、[更新组件公告](https://github.com/advisories/GHSA-p2f4-r6v6-j797)、[multipart 公告](https://github.com/Kludex/python-multipart/security/advisories/GHSA-pp6c-gr5w-3c5g)、[Starlette 公告](https://github.com/Kludex/starlette/security/advisories/GHSA-82w8-qh3p-5jfq)、[aiomysql 公告](https://github.com/aio-libs/aiomysql/security/advisories/GHSA-r397-ff8c-wv2g)。版本与公告按检查日期记录，不是未来自动升级指令。

## 2026-10-11：管理、客服与代理连续流程复验

本轮在独立 SQLite 和打包 Windows 候选中复验管理端六个工作区、客户与授权、工单回复、代理订单和个人端求助。后台回复保存后由同一工单 GET 回读；代理订单按待确认→确认收款→发放授权→代理端回读，退款仅登记退款和分润冲正，不自动停用授权。授权管理补齐服务端分页、关键词、产品和有效状态筛选，旧调用的默认分页保持不变。用户创建时间统一按 UTC 带时区返回。

- 新增实际窗口证据：`D:\AmazonToolboxData\audits\kst-admin-product-20261011` 下的 `after-*` 目录、退款回读失败/修复前证据和分页红绿报告；截图取自本机打包程序，授权码取图时遮盖。
- [本轮改前/改后截图对照](D:/AmazonToolboxData/audits/kst-admin-product-20261011/验收对照.html)；图库只复制选定截图，未包含 SQLite、浏览器配置或账号材料。
- [本轮 Windows 候选安装包](<D:/开发项目/kst-experience-fixes/release-admin-ux/KST Setup 1.8.15.exe>)：112,033,052 字节，SHA256 `D66A97B7EAA426B91799A28272D34DA4B41D7C6000F5E0A66C548AE4044E1C72`；未签名、未发布。
- 全量前端单元：`1522 / 1522`；后端全量 `769 passed / 9 skipped`（跳过项需要未提供的 MariaDB）；本轮授权兼容门禁 `83 / 83`，OpenAPI `208` 个操作；退款修复相关后端 `66 / 66`，用户时间回归 `20 / 20`。
- 最新 Windows 候选 `release-admin-ux/KST Setup 1.8.15.exe` 已完成打包审计；隔离本机候选验收 `9 / 9` 通过，覆盖六工作区、权限、客服同工单回读、个人端求助、授权全库搜索分页、代理订单收款发码回读与退款授权分离。候选未签名、未部署、未推送。
- 实际 Windows 候选已通过客户→客服回复→客户回读、运营/客服权限隔离、客户→订单→收款→发码→代理回读；退款流程曾捕获订单状态未落库的问题，修复后使用新的隔离夹具复验，旧失败数据库和截图只作为失败证据保留。
- 本轮仍未部署、未推送、未执行真实外部平台工具；MariaDB、Python 3.10 CI、新 NSIS 安装升级和生产环境仍不在本地证据范围。

## 2026-10-11：四批修复的当前验收

**本地修复及下列验证已完成，尚未发布。** 本节接续 10 月 8 日候选，后面的历史结果不覆盖本节。生产、真实平台工具、MariaDB 和实际安装升级仍按下列边界单独验收，不将本地成功写成全环境通过。

### 本次交付

- [修改前后截图对照](D:/AmazonToolboxData/audits/kst-experience-fixes-20261011/验收对照.html)：原始截图可单独放大，注明正式旧版、候选新版和新增场景；不是设计稿。
- [Windows 本地候选](<D:/开发项目/kst-experience-fixes/release/KST Setup 1.8.15.exe>)：112,025,282 字节，SHA256 `5D62E8F70230181BFECFAFDA9E1B6CF9920C2ADEB4C1144B0AE0F29C8CE1CC79`。未签名、未发布，不覆盖原安装，也不是公网正式更新。
- 源码：`D:\开发项目\kst-experience-fixes`，分支 `codex/kst-experience-fixes-20261011`，Git 基线 `7d5affa9015bedff6f197294640a5ba174b2c5cb` 加本地未提交增量；未覆盖其他对话的工作树。
- 官网设计来源：已验收冻结快照 `96a14e33812d01250075585bc19160b9c338aade`，来源目录 `D:\AmazonToolboxData\marketing-accepted-20261009-Mncpko\source`；来源及逐文件比对保存在审计目录的 `frontend-source-provenance.json` / `marketing-script-provenance.json`。同步冻结版与本次新增修复分开计，不把所有源文件差异当作新设计。
- [完整证据目录](D:/AmazonToolboxData/audits/kst-experience-fixes-20261011)。本轮没有提交、推送、部署或修改线上业务数据；官网构建仍保留正式 1.8.14 下载地址。

### 四批实际改变

| 批次 | 原问题 | 本次结果 |
| --- | --- | --- |
| 1 正确性和说明 | 发码权益受后改套餐影响；自然到期仍待激活；日志/URL 含敏感授权字段；客户默认旧演示；条款过时 | 成交/发码期限快照优先；状态计算、筛选、详情及行动中心一致，过期不可交付；日志整体遮盖，JSON 启动验证并保留限定旧兼容；客户只展示真实执行记录；条款区分 Windows 工具、真实咨询与官网模拟。 |
| 2 第一单与失败恢复 | 当前目录空时缺少准备/求助，开通前缺具体核对项；候选恢复与选文件能力尚需整合验收 | 工具准备与空目录说明不伪造可用任务；现有咨询窗口补平台/版本/任务/资料/人工接手/期限设备/支持清单；实际打包程序验证原生文件接口、恢复账本重启回读、核对边界与搜索分类。未补造外部 Runner 成功。 |
| 3 交付与运维 | 后台误请求客户公告；Redis 200 被当作全健康；旧机器/路径文档；V2 canonical host 与策略不符 | 公告按角色和会话隔离；依赖健康分层、断连恢复与缺 URL 拒绝；Nginx 去查询串日志；V2 精确域名/端口，错误目标仍拒绝；六条本地 HTTP/数据库旅程及 SQLite 独立备份恢复通过，现有发布规程更新。 |
| 4 视觉与易读性 | 代理品牌区过大、窄窗操作和长文本挤压；到期颜色不明确；模拟退出/刷新说明不可见 | 压缩代理品牌区、保留主操作，长文本换行和次要说明易读性改善；到期标签红色；电脑/手机可见会话重置提示。保留搜索、品牌、分类、官网设计、价格和案例，没有重做首页。 |

官网当前入口是 `/tools#experience`；`/demo` 保持 404。模拟退出/刷新恢复种子数据，操作仅影响本次虚构样例。后台批次数区分真实工具与内部历史演示，历史数据和兼容接口未删除。

### 验证结果及证据

以下不同组可能覆盖相同逻辑，不合计成一个夸大的“总验收数”。

| 检查 | 已取得结果 | 证据（均在本次审计目录） |
| --- | --- | --- |
| 前端 / Electron 单元 | 全量 1,435 / 1,435；最后到期标签和类型修正相关 30 / 30 增量补验 | `unit-all-final.json`、`last-ui-delta.json` |
| Electron 工作流 | 6 / 6；合成事件证明恢复边界，不等于外部任务成功 | `workflow-final.json` |
| 后端 | 最终 669 passed、9 skipped、0 failure/error；9 项需要未提供的 MariaDB 环境 | `backend-final.xml` |
| 权益与安全红绿回归 | 原权益、状态、凭据日志、JSON 验证、健康及错误回显缺陷先复现再修；保留回归证据 | `auth-before.xml`、`auth-new-regressions.xml`、`auth-fixes-evidence.json`、`security-operations-results.md` |
| 实际隔离控制面 | 6 / 6：激活/权限、团队隔离/取消/幂等、离线记录、支出/续期、代理订单/收款/发码/售后及跨代理隔离；有 SQLite 回读 | `real-control-plane/run-PUmYYp/results.json`、`database-evidence.json` |
| 实际打包 Windows | 6 / 6：四角色启动登录、记录、原生 IPC、重启回读、中文/空格文件、取消保留/删除拒绝、搜索分类品牌；只有 OS 选文件结果用测试夹具替代 | `visual-WmPGI9/packaged-results.json` |
| 官网 E2E | 64 项初次 62 通过；另 2 项是已验收官网文案/锚点的旧断言，更新测试后仅重跑这 2 项通过，未重写产品来迎合旧断言 | 工作树 `test-results/marketing`（保留初次失败诊断）、`marketing-recheck.json` |
| 桌面视觉 | 32 个角色页面 × 1024/1440 两档 = 64 次常规采样；另 8 次 125% 原生截图。到期标签最终 1024/1440 补图 | `visual-WmPGI9/observations.json`、`native-zoom-recheck/visual-5mgCll`、`final-agent/visual-GTBRrE` |
| 官网视觉与网络 | 16 张 1440 / 390 截图，条款、咨询、体验及原有页面检查；页面横向溢出、脚本异常、禁止的外部/业务请求尝试均为 0 | `marketing-visual/review.md`、`observations.json` |
| SQLite 备份恢复 | 34 张表行数、关键金额/状态/期限一致；三库完整性通过、外键异常 0；源库哈希/大小/时间未变 | `real-control-plane/run-PUmYYp/backup-restore-drill-udr3nuoo/result.json` |
| 静态与契约 | 各 TypeScript 配置、ESLint、Ruff、mypy、架构、API/208 路由兼容、生成类型、密钥扫描、发布与网页下线门禁通过；死代码扫描 0 孤立组件 / 0 未用依赖 | 本轮执行日志；兼容边界见安全专项与 `docs/DEVELOPMENT_RELEASE.md` |
| 最终打包 | ASAR 2,707 项、禁止内容 0；5 个生产根依赖及 104 个解析依赖齐全；NSIS 清单文件名/大小/SHA512 一致 | 最终 `release/`，运行时依赖和包内容审计输出 |

125% 初次 `page.screenshot` 产生重复 DPI 补偿裁切，已以真实 Electron `webContents.capturePage` 复核；没有为取图缺陷修改概览 CSS。对照页只用已稳定的原生图，旧裁切图保留诊断，不作为验收图。Windows 请求宽度 1440/1024 对应内容 CSS 1441/1025 属 DPI 四舍五入；手机为浏览器视口验证，不是实体手机应用。

六项打包流程在首轮本地候选完成；最后到期标签颜色/测试类型修正后，保留已成功流程结果，只补验相关 30 项单元、类型检查并重新打包，最终原生程序另采 6 张代理定向页面。最终包的内容、依赖和安装清单已重新核验，没有把早期包哈希当作最终交付哈希。

### 尚未取得、发布前必须补的证据

1. 新客户端 JSON 验证要求**兼容后端先发布、客户端后发布**。不允许回退 URL Token。回滚后端也须保留 JSON 或同步回滚客户端；本地候选不能直接替代旧生产客户端。
2. 本轮使用 Python 3.12.14；Python 3.10 CI、MariaDB 竞争门禁、新候选实际 NSIS 安装/升级/自动更新尚未验证。已打包原生程序启动测试不代替安装升级测试。
3. Redis 使用真实客户端 + loopback 协议故障夹具，不是完整 Redis 引擎；Nginx 为配置/静态回归，未运行 `nginx -t`；没有真实 Docker、生产备份恢复、告警/资源/证书续期验证。默认生产仍是 systemd，没有迁移到 Docker。
4. 没有执行真实外部亚马逊工具、修改客户目录或清理历史生产日志，也没有追改历史受影响客户授权；这些必须单独按对象和实际回读处理。登录专用进程内限流未被宣称改成分布式。
5. internal/production 默认 Redis 必需；部署前需提供 URL。确实设计为无 Redis 的单机环境必须显式 `REDIS_REQUIRED=false`，不能把缺少配置误当健康。原始审计目录含隔离 profile、数据库及诊断材料，仅供本机检查，不应整目录公开；对外只同步筛选的截图、报告和源码。

### 文件保留与归档

`SimulationView.vue`、`SampleProductArt.vue`、`metric-contract.ts` 三份未用旧原型移至 `docs/archive/legacy-marketing-demo/`，文件仍可恢复，不再混在当前入口。原工作树、历史证据、业务数据库、旧兼容接口和用户资料均保留。依赖构建使用独立生产 staging，没有安装或修改共享 `node_modules`。

---

## 2026-10-08：历史验收（非本次交付身份）

2026-10-08。本轮完成三项优化和官网模拟体验，仅本机交付。未部署、未推送、未修改线上数据；未覆盖其他对话的核心平台工作目录，未新增 Windows 模拟入口或真实工具。

## 交付入口

- [官网本地预览](http://127.0.0.1:4300/)、[模拟体验](http://127.0.0.1:4300/demo)。预览进程退出后可在本目录运行 `node node_modules/vite/bin/vite.js preview --config vite.marketing.config.ts --host 127.0.0.1 --port 4300 --strictPort`。
- [Windows 候选安装包](<D:/开发项目/kst-local-experience/release/KST Setup 1.8.15.exe>)，110,693,215 字节。它不是线上正式更新，官网仍链接已发布的 1.8.14。
- [验收资料目录](D:/AmazonToolboxData/acceptance/kst-local-experience-20261008)：单元测试 JSON、官网 26 张截图及网络清单、候选桌面 10 张截图和角色证据、隔离控制面 5 张截图及测试报告。
- [实现范围与使用边界](D:/开发项目/kst-local-experience/docs/LOCAL_EXPERIENCE.md)。源码分支 `codex/kst-local-experience`，本地变更已保留 Git 历史，不包含发布授权。

安装包 SHA256：`3449CF0BA167B13428814C7E7E275B77FBC11750F992E61660FCB168B2D0EF20`。`latest.yml` 的 SHA512、大小与文件名均核验一致。安装包未签名，Windows 可能提示未知发布者。

## 已实现

| 范围 | 行为与边界 |
| --- | --- |
| 官网说明与旧演示清退 | 条款明确区分 Windows 真实工具与官网模拟；价格、案例及营销设计保持。C/B 客户历史仅展示真实记录，移除再次演示和模拟执行回退；旧数据、兼容接口及内部测试保留。 |
| 稳定下载入口准备 | `/updates/latest.exe` 配置转入正式清单解析端点；成功禁止缓存跳转，清单无效、文件缺失、路径或版本不符明确失败。未部署、未提前换官网链接。 |
| 失败恢复 | 执行状态与五种恢复分类独立保存；批次各行先登记，提交前原子落盘；保存失败禁止提交，未知结果禁止重试。核对不伪装 Runner 成功，退出授权隔离迟到事件。 |
| 重新导入 | 原行号、输入指纹、工具版本及当前授权归属匹配，只建立可重试行的新批次，使用新的尝试及幂等键；成功行不再执行。账本保留内部历史，但已消费的排队记录不重复出现在客户列表或 CSV。 |
| 文件选择 | 主进程受信任选择、更换、清除，取消保留原值；工具目录决定文件字段，开始和每次上传校验归属、存在、可读性及 Runner ACK。完整路径与文件内容不上传控制面。 |
| 模拟体验 | 六个区域、五个一键任务与人工操作共用 DOM 表单/按钮/校验/保存回读；样例能持久保存，暂停/继续/停止/重置有真实样例状态变化。全程虚构数据、独立存储，无业务 API、真实平台、授权、Runner 或遥测。 |

## 验收结果

| 检查 | 结果 |
| --- | --- |
| 前端单元测试 | 133 个测试文件、1,167 项通过，0 失败；机读结果见 `unit-results.json`。 |
| Electron 工作流 | 6 项通过；安全提交边界、恢复退出等用合成 Runner 事件验证，不视作真实工具业务成功。 |
| Backend | 568 项通过、9 项跳过；Ruff 和 mypy 通过。跳过项依赖未提供的 MariaDB 环境。 |
| 官网浏览器场景 | 30 项通过：人工保存/读取、五任务、必填及重复操作、FBA 取消、暂停/继续/停止、刷新/重置、存储不可用、直达/刷新及未知路由 404。 |
| 官网视觉与网络 | 1440/1280/768/390 宽度，26 张截图；页面无横向溢出，表格区域可内部滚动；无页面脚本异常、外部或业务 API 请求。 |
| 隔离控制面 | 本机 SQLite 与实际 HTTP API，6 项通过；C/B、管理员、代理、批次取消及隔离、旧兼容 API 保留而客户演示隐藏。 |
| 实际 Windows 候选 | C/B/管理员/代理四角色启动、登录、授权及记录页面通过；同一原生应用重启后账本回读、核对禁用条件和人工结论通过，共 5 项。 |
| 文件边界 | 中文/空格文件、取消、删除后拒绝在原生候选中通过；读取失败、窗口/授权归属、伪造字段与上传中再次校验有单元覆盖。 |
| 类型与源码检查 | 所有类型配置、ESLint、来源检查、架构/API 契约和死代码检查通过；密钥扫描 0 发现。 |
| 打包 | ASAR 2,701 项，禁止内容 0；5 个生产根依赖、104 个解析后运行时依赖完整，NSIS 清单哈希一致。 |
| 打包辅助安全检查 | 运行时依赖门禁 4 个 fixture 通过；stage 路径隔离 8 项通过、1 项文件 symlink 因 Windows 权限不足跳过。实际 junction、hardlink 与跨盘纯路径案例通过。 |

候选四角色测试先通过；重启测试首次因为授权自动恢复、不再显示登录表单而遇到测试定位超时。修正测试预期后只重跑该项并通过。初次打包曾漏收间接依赖，已使用独立生产依赖目录重打包并加入递归依赖门禁；初次坏包被新候选替换，不作为交付包。

## 证据与限制

- 桌面测试使用已打包 `app://` 原生应用、受信任 IPC 及隔离真实控制面；只替换测试进程的 OS 选文件返回值，没有新增产品测试后门。未进行人工点击系统文件对话框的设备验收。
- 恢复界面重启测试注入独立合成账本，不访问外部平台。崩溃、提交前失败、提交后超时、保存失败与重新导入用存储/IPC/协调器测试覆盖。本轮不承诺自动查询外部商品、订单状态。
- 官网移动检查使用浏览器视口，不是实体手机测试。原生截图均是候选程序真实渲染；未替换为网页截图。
- 实际更新安装/线上下载稳定入口、Python 3.10 CI、MariaDB 并发及另一同事的真实工具验收不在本轮完成范围；保留现有更新能力和正式下载，不将本地测试宣称为生产验收。
- 汇总目录没有复制测试授权凭据、Cookie、Token、原表或测试数据库；原隔离测试目录留作诊断，生成凭据已由测试框架清理。

## 删除清单与恢复

- 删除未引用的旧假咨询 `LandingConsultationDialog.vue` 和装饰演示 `LandingStoryScene.vue`，可从已发布基线 `65930281159e44fab7fc51a8afb42aac7232ca8f` 的 Git 历史恢复。
- 未纳入交付的两份未使用官网装饰组件 `LandingSceneChecklist.vue`、`LandingTaskChain.vue` 仍可从已验收官网源材料找回。
- 未删除客户历史数据、兼容后端接口、共用桌面页面、数据库或真实执行记录。内部旧演示组件只由显式测试引用，生产构建禁止回退。
- 本地打包使用 `D:\AmazonToolboxData\package-staging` 下隔离的生产依赖，不安装或更改共享 `node_modules`，不上传产物。

## 搜索、品牌与布局追加验收

2026-10-08，根据用户要求再次对照改动前界面，并检查真实渲染结果。本次只补充验收脚本和证据，没有修改产品页面、CSS 或品牌资源，也没有重打包、部署或推送。

- 原有工具搜索、任务分类、当前可用筛选、平台选择均保留；个人端和团队端原有筛选逻辑未被删改。Logo、侧栏、登录页及共用品牌组件与已发布基线一致；已验收官网的主要营销页面、工具分类和设计保留。
- 搜索与品牌组件回归：5 个测试文件、59 项通过。包括搜索匹配、空结果、清空恢复和平台切换组件行为。
- 实际 Windows 候选补测：1440 / 1280 / 1024 / 900 窗口宽度，搜索框、筛选和品牌可见，头部不重叠，目录不溢出；实际输入搜索、切换分类/可用筛选及打开关闭工具详情均通过。原生窗口受 Windows DPI 影响时以实际内容宽度检查（1440 请求对应 1441 CSS 像素），不改产品布局来满足测试。
- 官网模拟体验独立复核：1440 / 1280 / 768 / 390 四种视口，56 项操作检查通过，68 张截图；品牌、制造商、搜索关键词完成填写、保存、详情回读和刷新回读。FBA 校验弹窗、广告弹窗键盘操作、订单/仓库流程及手机自动任务滚动均检查。
- 已查看原生工具目录、搜索结果、详情抽屉及手机商品表单/弹窗截图。截图等待入场动画完成，不把动画中间帧当作最终布局；没有发现遮挡、页面横向溢出或阻塞操作的布局问题。手机宽表及横向标签按设计内部滚动，不宣称所有表格都能完整同时展示。
- 原生目录使用隔离测试库中的两条不可执行合成工具，仅验证查找与说明 UI；工具状态为维护且执行被阻止，没有访问真实平台或启动 Runner，不等同于真实工具验收。官网复核只有本地静态资源请求，无业务 API、外部请求及页面脚本错误。移动检查仍是浏览器视口，不是实体手机或手机应用。

追加证据：[UI 复核目录](D:/AmazonToolboxData/acceptance/kst-ui-recheck-20261008)，其中 `core-ui-unit.json` 为组件回归，`report.json` 为官网逐项检查，`desktop/packaged-ui-evidence.json` 和 7 张原生截图为 Windows 补测。之前成功的验收结果保留，没有重复运行全套业务测试。

原生追加测试可复跑：在隔离测试所需 Node/Python 环境下，设置 `KST_REAL_E2E_UI_CATALOG=1`，运行 `node scripts/run-real-e2e.mjs --config playwright.packaged-retirement.config.mjs --grep "packaged UI preserves"`。未设置该标记时该项跳过，原有 demo 测试环境保持默认行为。
