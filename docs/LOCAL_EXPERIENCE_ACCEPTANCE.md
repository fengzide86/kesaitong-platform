# KST 本地体验与更新验收

## 2026-10-13 最终候选：管理端权限死链修复（r12）

- 行动中心的“平台入口审核”卡片现在与 `updates.manage` 使用同一权限源：超级管理员可见并可进入，运营/客服不再看到一个必然被路由拒绝的死链；原有路由和后端权限校验仍保留。
- 受影响回归 23/23 通过（行动中心 9 项、审核面板 14 项），包含运营/客服不显示入口、超级管理员审核面板加载、审核证据约束和版本冲突提示。
- 新候选 [`KST Setup 1.8.16.exe`](<D:/开发项目/kst-experience-fixes/release-target-live-candidate-20261013-r12/KST Setup 1.8.16.exe>)：99,945,194 bytes，SHA256 `97CA23E73E074EBF4BC04638A3D16F007F9CC4AE10688EBD9A10C9BC11429F81`，Authenticode `NotSigned`。包审计：5,763 条目、禁入文件 0、5 个根依赖、200 个解析运行包、表格回读和语言包均通过；候选完整性证据为 [`native-start-BsIk0X`](D:/AmazonToolboxData/audits/kst-multi-target-candidate/native-start-BsIk0X)。
- 用 r12 重新跑隔离 loopback 打包旅程：consumer、business、admin、agent 登录和角色页面通过；超级管理员从行动中心进入“平台入口审核”，默认展开且显示真实空队列提示；本机恢复跨重启仍与 Runner 成功分离。结果 **5 passed，1 skipped**（未启用的目录专项），证据目录 [`run-8vdMUd`](D:/AmazonToolboxData/real-e2e/run-8vdMUd)。实际审核页截图为 [`packaged-admin-target-reviews.png`](D:/AmazonToolboxData/real-e2e/run-8vdMUd/packaged-admin-target-reviews.png)。
- `r11` 的登录、多角色页面视觉截图仍适用于本候选：r12 只改变无权限角色的审核卡片可见性，未改变登录排版、品牌动效、管理员审核页视觉结构。r12 仍是本地候选，未安装覆盖、部署、推送、通知其他对话或操作真实客户账号。

## 2026-10-13 收尾：登录与管理端实际打包旅程复验（r11）

- 修复打包角色验收仍寻找旧文案“管理员登录”的选择器；当前产品入口为用户可理解的“管理端登录”。补验不改业务逻辑，只让验收与已交付界面一致。
- 使用现有 r11 Windows 候选目录 [`KST Setup 1.8.16.exe`](<D:/开发项目/kst-experience-fixes/release-target-live-candidate-20261013-r11/KST Setup 1.8.16.exe>)：99,945,030 bytes，SHA256 `F6E05C6BE0A8E4C903F6FFCE0F3535826F8E35974B63F94BD6465F027B5813EA`，Authenticode 未签名。包审计、Electron 编译、类型检查及此前 189 文件/2157 项单元测试结果沿用；本次没有重新运行已通过的全量批次。
- 重新运行隔离 loopback 后端 + 打包 Windows 旅程：consumer、business、admin、agent 登录并读取各自页面，admin 从仪表盘“打开审核页”进入 `/admin/target-reviews`，验证默认展开的审核面板与空队列提示；同时验证本机恢复记录跨重启仍与 Runner 成功状态分离。结果：**5 passed，1 skipped（未启用的品牌/工具目录专项）**，总耗时 27.3 秒；证据目录为 [`run-O8PDtg`](D:/AmazonToolboxData/real-e2e/run-O8PDtg)。
- 本次打包旅程仍只使用随机隔离账号、SQLite 和 loopback 控制面，阻断外部 origin；它证明登录、角色路由、管理审核入口和本机恢复 UI 可用，不证明学校 WebVPN、生产控制面或真实平台业务写入已上线。
- r11 仍是本地候选，不代表已部署、已推送或已通知其他对话；未执行安装覆盖、生产发布、Feishu 通知或真实客户账号操作。

## 2026-10-13 续作：回执阻断、失败恢复视觉与指定 V2 入口只读可达

### 网址优先接入与审核队列补验（本轮）

- 用户端接入区域现在默认展开，第一步直接是“输入网址，登录后开始”；网址输入支持桌面原生编辑菜单（右键粘贴、复制、全选、撤销/重做），不读取或上传剪贴板内容。已登记入口位于网址输入下方，唯一已审核入口会自动选中，下一次不必重复填写技术字段。
- “课程实训 / 比赛练习 / 正式比赛”合并为一个用户选择；正式比赛仍只显示阻止提示，不因用户选择而获得执行权限。平台版本、课程、店铺和审核范围继续由现场识别与签名配置决定。
- 刷新重登按钮仍只清理旧预检计划并保留回执；未知提交结果不能盲目重复。未审核入口的登记请求仍是 `POST /api/tools/target-profiles`，管理员队列是 `GET /api/tool-releases/target-profiles`，必须使用具备 `super_admin / updates.manage` 的后台会话；普通用户登录或仅刷新前端不会把记录变成已审核。
- 本地视觉验收脚本已改用语义选择器覆盖“正式比赛阻止 → 切回实训 → 预检/结果 → 刷新 → 待核对 → 管理员审核”顺序。`kst-target-ui-url-first-20261013/visual-results.json`：1366、1280、1024 及等效 125% 四个视口均无横向溢出、页面错误或外部请求；截图是本地 fixture，不替代客户账号或线上管理员验收。
- 由于当前学校 WebVPN 证据仍为 R1 只读，不能在没有管理员核验的课程地图/模板列表/编辑页指纹、业务路由和执行范围时代为批准；这也是“用户提交后管理员看不到或不可批准”需要首先核对的边界：确认用户端提交返回成功且管理员使用正确的队列权限/会话，而不是重复点击或直接放行。
- 线上控制面只读核对（2026-10-13）：`GET https://8.130.113.104/api/health` 返回 `status=ok`、版本 `1.8.15`；`GET /api/tools/target-profiles` 与 `GET /api/tool-releases/target-profiles` 均返回 HTTP 404。由此确认当前线上后端尚未发布入口登记/审核 API；本地 1.8.16 源码的 48/48 目标入口专项不能当作线上已部署。修复顺序应是先发布兼容后端，再发布客户端，最后用管理员会话刷新审核队列。
- 2026-10-13 登录与全角色视觉复验：登录页已改为用户语言（“登录课赛通”“输入授权码，开始使用已开通的工具”“登录并开始使用”“当前电脑”），不再展示“端/套餐/个人工具箱”等内部术语；原生打包验收覆盖 consumer、business、agent、admin 角色，72 张 1440/1024/125% 截图已生成，未发现横向溢出或角色页面脚本错误。证据目录为 `D:/AmazonToolboxData/audits/kst-experience-fixes-login-ui-20261013/visual-4Zo7UW`；其中后续可选 packaged journeys 因本地 Electron 子进程未自然退出而中断，角色截图与页面验收已完成，不把中断项记为线上成功。
- 11 个现有工具目录均已并行完成本地交互沙盒回归（商品发布、标准物流、运费比较、广告、发货、补货、FBA/AGL 及 Ali 目录），每项均完成填写/点击/结果核验；结果统一标记为 `recordKind=demo`，不是真实平台写入。目录工具当前仍由 `force_demo_only_tool_configs` 限制为 `demo_only`，不可把这批回归当作真实工具已开放。
- 2026-10-13 最新候选（含登录文案）：`release-target-live-candidate-20261013-r5e/KST Setup 1.8.16.exe`，99,941,725 bytes，SHA256 `5C4C8551BC07FAC8E01AFF226943F97028C3617B908E54664866111C640B8E1C`，Authenticode 未签名。包审计 5,758 条目、禁入文件 0、运行依赖 200 个解析包、语言包与表格回读均通过；原生启动报告为 `D:/AmazonToolboxData/audits/kst-multi-target-candidate/native-start-n1WChI/candidate-runtime.json`。
- 2026-10-13 最终候选（含 404/403/401 明确提示）：`release-target-live-candidate-20261013-r5d/KST Setup 1.8.16.exe`，SHA256 `E0116E239E1AAAA1C3047698C91AFD1109E26CBCB8F9BDC3C06A44F42228BEAA`，Authenticode 未签名。包审计（5,758 条目、禁入文件 0、200 个解析运行包）、原生启动完整性与表格回读均通过；[候选启动报告](D:/AmazonToolboxData/audits/kst-multi-target-candidate/native-start-YXwzJ3/candidate-runtime.json)。
- 2026-10-13 并行候选封装补验：新候选目录 `release-target-live-candidate-20261013-r5c` 的安装包为 99,941,640 bytes，SHA256 `0614B425FA974843AA72594FC535EB934ADE1CB72CE8AACCDF4B59716ED2E5CA`，Authenticode 仍未签名。包审计通过（5,758 条目、禁入文件 0、运行依赖 200 个解析包、语言包与表格回读均通过）；原生启动与字节/renderer 完整性证据为 [native-start-cPAEw3/candidate-runtime.json](D:/AmazonToolboxData/audits/kst-multi-target-candidate/native-start-cPAEw3/candidate-runtime.json)。

本节只记录本次续作新取得的证据；没有部署、推送、安装或向指定平台提交业务数据。

- 工作区打开时立即读取本机执行回执。同一入口、配置版本、账号/课程/店铺现场指纹、输入指纹和阶段的 `needs_review` / `submitting` 记录，会在最终提交按钮前阻止重复创建；刷新并重新登录只清理旧预检计划，不清理原回执。相关组件测试为 65/65 通过。
- 失败恢复视觉夹具新增 `needs_review` 状态：预检完成后展示“结果待核对”，不渲染最终提交按钮，并保留“读取原对象状态，不重新提交”的恢复路径。[恢复状态截图与结果](D:/AmazonToolboxData/audits/kst-target-ui-recovery-20261013)；4 个视口均无横向溢出、页面错误或外部请求。该目录仍是本地 fixture，不等于真实平台业务验收。
- 指定 V2 入口 `https://http-10-28-2-187-851.webvpn.gtcfla.edu.cn/User/LoginPage24` 已做只读 HEAD/GET：HTTP 200、0 次跳转，登录壳及 `LoginPage.js` 可读取。[只读证据](D:/AmazonToolboxData/audits/kst-v2-readonly-20261013)。本次没有使用账号密码、没有提交登录表单、没有进入课程或业务页，因此不证明账号、课程、版本识别或写入兼容。
- 用户随后在内置浏览器手动完成登录，并确认当前已到同一 WebVPN origin 的课程地图路径 `/ECrossAmazonHome/CourseIndexTraining_1`。当前 URL 中的 `paras`、课程编号/名称、`studentId` 等值未复制、未写入审计或代码；这只证明“登录后课程地图已到达”的现场状态，不证明店铺、角色、版本指纹或业务页兼容。由于本线程没有读取该浏览器会话 DOM/响应的权限，后续仍需在 KST 受控窗口中重新识别现场。
- 最新本地视觉回归 [kst-target-ui-redesign-20261013](D:/AmazonToolboxData/audits/kst-target-ui-redesign-20261013) 覆盖 1366、1280、1024 及等效 125% 视口；流程总览、现场识别、工具表单、预检、结果与管理员审核截图均生成，4/4 视口无横向溢出、页面错误或外部请求。该目录是本地 fixture 视觉证据，不替代客户账号或 Windows 原生 DPI 验收。
- 该 WebVPN 入口的审核配置不能只登记登录页和 `/ECrossAmazon`：登录后还需要允许同一 origin 的 `/User`、`/ECrossCommon`、`/ECrossCommon/CourseIndexTrainingCourse`、`/ECrossCommon/CourseUpdatePersonalProfile`、`/ECrossAmazonHome` 和 `/ECrossAmazon`；其中课程页、个人资料页和业务页必须分别保留已核验的角色与结构证据。相关路径合同测试 38/38 通过，但仍是代码合同，不是客户账号现场登录验收。
- 最新本地候选包为 [KST Setup 1.8.16.exe](<D:/开发项目/kst-experience-fixes/release-target-live-candidate-20261013-r4c/KST Setup 1.8.16.exe>)，99,941,242 bytes，SHA256 `513A7FF5655C29BBB5FE39A648BB8B3AEC55354DD0BA381FB254666CADB373F2`，Authenticode 未签名。它包含本节“打开平台窗口”的人工登录交接文案及同源不同路径发现窗口隔离修复；包审计、NSIS、运行依赖、IPC 合同和隔离启动均通过；[候选启动报告](D:/AmazonToolboxData/audits/kst-multi-target-candidate/native-start-skZHSP/candidate-runtime.json)。
- 当前产品链路已明确为：打开登记入口 → 用户登录并选择课程 → 现场识别（版本、账号、课程、店铺、角色）→ 选择配送模板工具 → 只读预检 → 用户确认 → 单次提交 → 同对象列表/详情回读 → 保存收据；登录失效刷新重登，提交后未知结果只能核对原对象，不能盲重试。首期仍只开放已验收 V2 配送模板能力，不把 V3、正式比赛或旧脚本计算器当作已支持。
- 定向链路回归为 6 个文件、131 项通过，覆盖入口打开/刷新、登录响应与课程地图、身份及课程隔离、导航、Runner、模板提交边界、回读、回执恢复和审核 UI；这是本地合同/夹具与原生流程证据，不替代客户账号登录和正式比赛 UAT。

## 2026-10-12 接入续作：原生配送模板与只读恢复通过，新本地候选已验收

本节优先于下方前一 R1 批次；保留其历史结果，不把旧候选安装包当作含本轮代码的新包。当前未提交、推送或部署。

- [本轮单次写入及回读证据](D:/AmazonToolboxData/audits/kst-multi-target-20261012/live-template-write.json)：在原 BJY 实训创建一份独立 `KST_TOOL_UAT_20261012_A`；保存仅一次，HTTP 200 / Code 0；列表从 5 到 6，唯一新名称及新 ID；同 ID 详情 8 条规则，服务、地区、时效、费用及计价单位全部一致。未设默认、未分配 SKU、未修改已有模板。学校入口仍只有 R1，不能据此宣称其写入验收。
- 已证真实字段：新建 `DS0701="0"`；显示“2 - 4 天”的实际保存/回读值为 `DS0813="2 - 2"`；Canada 每单 1.23、单位价 0.45、按商品 `DS0816=1`，新增 Mexico 规则均持久。成功弹窗为 `.k-window` 内的 `input.sureButton`，确认后才返回列表。
- 实际发现并修复关联风险：列表会自动读取默认模板详情。详情捕获须同时匹配请求路径与 `ds0701`，再核对课程/店铺/来源及响应中的同一对象；不能把先到的默认模板 44 行当成刚创建的 8 行。
- 实际 UI 绑定已进入编译模块，支持强制大陆规则、完整启用规则校验、已验证时效、单位及可见可用国际叶子国家。未知/隐藏国家、国内任意地区组合、价格段及比赛写入不在首期。用户表单已提供必要地区预设，不要求手写全部州名。
- 审核配置新增具体课程 `executionScopes` 与地图/列表/编辑页各自的结构指纹，全部被签名覆盖。课程范围是团队现场核验后的实训许可，**不是平台自动识别比赛**；用户选择“实训”不能绕过范围。旧配置缺少这些证据时需重新审核。后端专项 48/48，OpenAPI 213 操作兼容通过，类型生成已同步。
- 原生联调使用隔离 Electron 窗口、实际编译 controller/port/独立 Runner；控制面为本机签名夹具，不是生产授权/全栈验收。首次原生测试发现登录 iframe 迅速销毁使响应正文丢失，按设计阻断；采用有限内存响应保留后，原生成功登录证据已能建立。该机制参考 [Chrome DevTools Network 协议](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json)，限制总缓冲 2 MB、单响应 1 MB，不持久化登录正文。
- [原生 Runner 单独证据](D:/AmazonToolboxData/audits/kst-multi-target-20261012/native-runner-acceptance.json)：样本 C 由实际编译 controller/port 和独立 Runner 从课程地图接管，在原 BJY 实训只保存 1 次（HTTP 200 / Code 0），同 ID 列表及 8 条规则回读一致，receipt `6bd586a1-12cb-4b9f-bedb-1696e003d886` 为 verified；同计划重放被 `TARGET_PLAN_INVALID` 拒绝，没有增加提交。手动 A 与原生 C 分开记录，控制面仍是本机签名夹具，不代表生产授权全栈验收。
- 保存边界已由“开始填写”后移到主进程识别唯一保存按钮前：重新核验配置/现场、原子落盘 submitting、再点一次。缺失国家与过期编辑页指纹均在 Save 之前阻断，两个新 receipt 为 not_submitted，观测 Save 数为 0；刷新重登保留记录。早期 B 的保守 needs_review 记录未被删改或借“查无对象”自动降级。
- 样本 D 在真实 SaveTemplate HTTP 200 / Code 0 后关闭现场，Save 仅 1 次，receipt `99736fe9-a320-4980-a94c-8e32b5482787` 先保留 needs_review。实际发现 `TARGET_HOST_DRAIN_TIMEOUT` 后本机执行锁未释放，已修复原生等待的生命周期：只读等待可以清退，已派发的输入/修改必须原生命令结束或真实窗口销毁后才解除屏障，不以超时强行放行。新 submitting 记录替换草稿标记为 `submit-boundary-durably-recorded`；旧 D 未手工改账本。
- **D 恢复现场通过**：修复后重新正常登录到课程地图，直接“核对原对象”，不另填表、不建立新预检、不申请新执行授权。先核验原账号/课程/店铺及结构再导航列表，D 同对象 8 条规则一致，原 receipt 改为 verified（`read-only-reconciliation`），恢复期间 Save 请求 0。随后独立 Runner 在初始列表读取时再次关窗，380 ms 返回 not_submitted / `TARGET_RUNNER_CANCELLED`，无保存、锁释放；同一进程立即重新打开入口成功。此次是关窗/重登与应用重启保留记录验收，不冒称操作系统断电或网络断开的全组合现场测试。
- 最新本地 UI 夹具验收：[20 张截图及结果](D:/AmazonToolboxData/audits/kst-multi-target-ui-live-binding-20261012)覆盖用户展开、预览、结果、刷新及管理员审核，1366/1280/1024 与等效 125% 均无横向溢出、脚本错误和外部请求。主代理已目视查看 1024 用户预览及 125% 管理审核；完整大陆预设、课程范围、三页指纹及正式比赛阻止提示布局正常，保留品牌、搜索与分类。此结果不替代真实业务或 Windows 原生 DPI 验收。
- 冻结后接入全组回归：[17 文件 397/397](D:/AmazonToolboxData/audits/kst-multi-target-20261012/target-tests-final.json)，覆盖合同、浏览器、登录、导航、身份、Runner、控制器、模板、审核及 UI。新增核对入口保护错误账号/店铺/课程与地图指纹漂移。相关 TypeScript/ESLint、API 未知响应 0、凭据扫描 0；既有后端 48/48 和 213 操作 OpenAPI 兼容结果仍有效，未因未改后端而重复运行成功批次。

### 本轮唯一候选与包内证据

- [KST Setup 1.8.16.exe](<D:/开发项目/kst-experience-fixes/release-target-live-candidate/KST Setup 1.8.16.exe>)：100,022,092 bytes（95.39 MiB），SHA256 `EF344CF2AA6239E1D97A7DF0C98F389281620F725B9BA6E2C57F867E6FEF10E7`，未签名。下方 `release-multi-target-candidate` 等同版本旧包仍只作历史记录，不能替代本包。
- 已重新编译 Electron/preload，复用本轮已验收 UI dist，独立目录封装。包审计 5,757 条目、禁入文件 0、200 个解析运行依赖通过，表格读取/写入、语言包、CSP 和运行依赖验收通过。NSIS 文件大小、SHA512、blockmap 与更新清单一致。
- [候选原生启动与哈希报告](D:/AmazonToolboxData/audits/kst-multi-target-candidate/native-start-egyySL/candidate-runtime.json)：23 个主进程/Runner/合同/权限锁文件与当前编译字节一致，完整 244 个 renderer 文件集合及哈希一致，不容许旧 chunk 残留；共 267 份。15 个合成本地合同正反例、8 个类型化桥方法与 app:// 登录界面通过，脚本错误 0、外部网络请求 0。
- [包内原生启动截图](D:/AmazonToolboxData/audits/kst-multi-target-candidate/native-start-egyySL/native-login.png)已由主代理目视检查。它使用隔离本机控制面与用户目录，不是真实客户授权登录截图；真实平台 C/D 结果另见上文。没有执行 NSIS 安装/覆盖升级，没有提交、推送或部署，没有变更线上签名配置或默认开启能力。

### 开发接点与本轮范围

唯一入口继续使用 `AI_GUIDE.md → current-status.md → 本验收原件`。共享合同在 `src/shared/ipc/target-contract.ts`，规则常量在 `target-template-options.ts`；受控页面与独立 Runner 位于 `electron/automation/targets/`。当前只支持一个经过类型校验的配送模板 Recipe 形状，**不是已经完成任意工具的可视化编排器，也未开放 V3 或正式比赛执行**。

开发者输入示例（仅说明配置，不自行打开平台或提交）：

```ts
import { templateCreateInputSchema, recipeSchema } from './src/shared/ipc/target-contract'
import { V2_MAINLAND_COUNTRIES, V2_TEMPLATE_FIXED_TRANSIT } from './src/shared/ipc/target-template-options'

const input = templateCreateInputSchema.parse({
  name: '课程模板-样例', currency: 'USD', pricingMode: 'weight-item',
  rules: [{ countries: [...V2_MAINLAND_COUNTRIES], serviceCode: '10001',
    transitTime: V2_TEMPLATE_FIXED_TRANSIT['10001'], perOrder: '1.20', unitRate: '0.50', unit: 'lb' }],
})
const recipe = recipeSchema.parse({
  schemaVersion: 1, id: 'template.create', version: '1.0.0', platformKey: 'amazon',
  supportedEditions: ['v2'], requiredCapability: 'template.create.v1', adapterVersion: 'bjysoft-v2-template.1', input,
  steps: ['read.context', 'read.templates', 'assert.unique', 'persist.intent', 'write.template', 'verify.same-object', 'persist.receipt'],
})
```

网址、课程范围与三个页面指纹由后端已有发行审核流程签名，不能把上面输入示例当成部署授权。新增同系列网址先只读检测、取得证据后审核，字段或流程不同再增加适配变体；不复制整套脚本、不共享任意 origin 的 Cookie。首期没有设默认、删除、批量 SKU 分配；费率计算沿用原独立模块，此模板工具不声称自动挑选最优报价或打法。

生产仍待独立发布验收：先兼容后端及签名配置，再发布客户端，最后开放已验收入口/能力。此次包只作本地候选；学校 WebVPN 仍 R1，不能凭 BJY 的成功直接批准其写入。

## 2026-10-12 前一批：多入口接入、受控运行时与现场 R1（历史候选，尚未包含续作）

此节记录本地后端、版本化 IPC、独立 Runner、原子恢复账本、入口/审核 UI，以及两处真实部署的只读页面补证。没有变更默认目录、默认执行模式、线上入口或生产数据，也没有凭测试 fixture 批准真实部署。入口获批只是签名范围；客户端仍必须具备经审核的页面绑定、当前现场身份与同对象回读证据。当前真实 V2 表单绑定缺口不能用审核表中的文字代替；本轮尚未完成配送模板真实保存与业务恢复 UAT。

### 两个真实入口的只读核验

现场结构记录：[脱敏 R1 证据](D:/AmazonToolboxData/audits/kst-multi-target-20261012/live-entry-readonly.json)。采集于 2026-10-12，使用本机隔离 Edge 内存会话；用户所标记的浏览器插件当轮没有可调用的工具，因此不声称使用了内置浏览器插件。两个账号分开使用，学校窗口结束后才开始原 BJY 窗口；没有持久化浏览器会话、账号值、密码或完整参数。

| 现场 | 本轮实际到达 | 差异与边界 |
| --- | --- | --- |
| 原 BJY：`http://www.bjysoft.cn:8730/User/Welcome6` | 亚马逊卡片 → `:8732/User/loginPage24` → 登录后直接课程地图 → Amazon 弹层 → 卖家新页面 → 设置 → 配送设置 → 新模板编辑页 | 需要保留 8730 到 8732 的实际 origin 关系；没有进入 `loginPage21`。空草稿取消后刷新模板列表仍可用，不等于掉线后的恢复验收。 |
| 学校 WebVPN：`https://http-10-28-2-187-851.webvpn.gtcfla.edu.cn/User/LoginPage24` | 登录 → 课程列表 → 用户指定的已加入课程 → 地图 → Amazon 弹层 → 卖家新页面 → 设置 → 配送设置 → 新模板编辑页及国际国家弹层 | 本轮各跳均留在该精确 origin；没有推导内部 IP、没有点击“加入实训”、没有填写或保存模板。 |

两处登录都在可见 `iframe#login-iframe` 的 `/User/Sign` 内，输入为 `#userName` / `#password`，提交为 **div** `#btnLogin`；登录后也可能存在隐藏密码控件，不能只检查元素存在。学校出现账号密码相同提醒，确认提示后才到课程列表，没有修改密码。

地图的 `div.IntoBack` 精确文字 Amazon → `/ECrossAmazonHome/CompanySellerAmazonIndex` iframe → `div.divbtn03.AmazonCon`（亚马逊卖家后台）→ 新页面 `/ECrossAmazon/SellerIndex`。新 Page 事件已观察；尚未做可重复的 opener/本次动作关联验收，不能改为“任意第一个新窗口”。从账户信息的可见配送设置入口到列表，再由 `#btnAddTemplate` 打开 `#divAddTemplate`；选择新建分支的 `SubmitCancelTemplate(2)` 只导航至 `SellerShippingTemplateSettingAdd`。复制分支未使用，弹层“确定”不是保存成功。

两处新增页均实际观察到 `#templateNameInput[name=templateName]`、`#btnSubmit`、`#btnCancel`、`rateModel=0/1`、`unitMeasure=1 商品 / 2 Lb`；标准服务默认有两条规则，不能在整个服务块内直接取第一个金额框。学校补见每规则 `pricePerOrder` / `unitPrice`、服务开关和国际国家 iframe；国家控件并不全部带 `.subcheckbox`，50 个复选框包含全选等控制，不等于 50 个国家。配送时效 **label“2 - 4 天”对应 DOM value“2 - 2”** 在两处相同，当前只证明 DOM 映射，不推断提交的 DS0813，也不擅自修正平台值。

两处版本 Logo 都是 `.divLogo` 的 CSS 背景 `/Images/Logo/24/LoginPage.png`，不是可读 body 版本文字。`24` 是产品线索而非版本证明；尚未建立经核验的版本图指纹，因此运行时不因路由/控件相同就自动确认 V2。学校 `objParas` 仅观察到 `studentId` 字段名；未读取或保存其值，也没有把 URL 参数提升为可信账号身份。

**本轮没有触发 SaveTemplate、没有创建业务对象，也没有证明掉线/提交后断网恢复。** 现有静态 SaveTemplate 函数中看到的字段、历史 R2 文档、当前 R1 DOM 和本机 fixture 测试分别保留，不混为本轮真实执行成功。下一通过判据是独立身份/场景/版本证据、完整规则行绑定、一次授权模板保存与同对象回读、随后中断恢复验收。

### 本地界面与验证范围

保留工具箱品牌、搜索与分类；多入口区域默认折叠，审核位于原工具发行页。新增刷新重登、待核对结果保留、未知结果禁止直接再提交和当前记录/历史记录区分。比赛阶段明确标成用户声明，不能冒充平台核验；未支持协议或能力不回退旧脚本。

- UI 与接入层专项 59/59；后续合同长度统一相关 100/100（有重叠，不相加）。完整 source/app/test/Electron/node/e2e 类型检查通过；涉及文件 ESLint、diff 检查通过。
- [20 张本地 UI 夹具截图](D:/AmazonToolboxData/audits/kst-multi-target-ui-20261012)覆盖 1366、1280、1024、125% 等效窄视口；原截图采集无横向溢出、页面错误或外部请求。主代理已查看折叠目录和刷新保留结果图。截图是明确标识的 UI 夹具，不是平台业务或原生安装验收；随后文字收紧的定向新图单独记录，不将旧图冒称新文案截图。
- 主代理中间整合检查：5 个运行时测试文件 141/141；随后只读列表/编辑页形状细分补验 83/83，具体组见下文。各阶段用例重叠，不计算虚假的测试总数。
- 与指定资料对话只同步必要技术事实与已有状态行，没有转发凭据或推送代码。现场核验由本线程单独执行，资料负责人没有另行登录客户账号。材料仍从唯一 `AI_GUIDE.md → current-status.md` 路线接续。

### 本地候选包与最新视觉补验

- 当前增量候选为 [KST Setup 1.8.16.exe](<D:/开发项目/kst-experience-fixes/release-multi-target-candidate/KST Setup 1.8.16.exe>)，100,020,603 bytes（95.39 MiB），SHA256 `33D406AAA9C817350A5D0F6B1B1A8809E52E5DC6455D679F43E8F0E3EBF8F897`，Authenticode 未签名。它包含本轮多入口框架和之前保留的本地修改；不是正式发行，也不是已可执行的配送模板工具。
- 包审计检查 5,751 个条目，禁入项 0；5 个根依赖、200 个解析依赖、包内 Excel 读写、语言包和 CSP/runtime 检查通过。NSIS 更新清单中的文件名、大小、SHA512 和 blockmap 验证通过；没有执行 NSIS 安装或覆盖升级。
- [隔离原生启动证据](D:/AmazonToolboxData/audits/kst-multi-target-candidate/native-start-2mVG5M/candidate-runtime.json)确认 9 个包内 target 控制器、Runner、合同及 preload 文件与当前编译字节一致，原生 `app://` 登录页可呈现，包含 `targets.refresh` 的类型化桥存在，页面错误和外部请求为 0。使用独立 userData 和 loopback 控制面，没有登录生产控制面或平台。`resolveUiBinding` 仍返回 `undefined`，真实提交仍被阻断。
- 最新文字与审核校验补验图：[用户预览](D:/AmazonToolboxData/audits/kst-multi-target-ui-20261012/freeze-user-preview-1024-100pct.png)、[管理员审核](D:/AmazonToolboxData/audits/kst-multi-target-ui-20261012/freeze-admin-review-1024-100pct.png)。主代理已实际查看这两图及原生登录图；无横向溢出或遮挡。两张新图是 UI fixture，不冒充真实业务；原 20 张截图保留，不重复计入本轮两张。
- 打包首次遇到 Electron 解压后目录重命名 EPERM，仅重跑失败的封装阶段，使用已安装的同版本 Electron 42.11.12 构建成功，没有重新安装/改动依赖。失败生成的 `release-multi-target-candidate/win-unpacked.tmp` 保留诊断，不是交付目录，不运行它。
- 本次未提交、推送、部署或公开发行；生产基线与其他对话工作未覆盖。下面同版本 `release-update-accepted-ui` 的记录属于前一阶段，不包含本轮增量；不要因为版本号相同而混发。
- 最终工作区凭据扫描 `secret_findings=0`。三个私网 URL 负面测试原被端点规则误报，已增加严格“精确文件 + 完整 fixture URL”例外；不同文件、其他 URL、query/hash 变体及同一行其他凭据仍会报警，扫描器专项 30/30。没有放行整个测试目录或所有私网地址，也没有改动应用编译产物。

### 后端合同与独立执行进程

- 登录用户：`GET /api/tools/target-profiles` 返回已批准入口及自己提交的入口；`POST` 同路径登记待审核候选。
- 具工具发行权限的管理员：`GET /api/tool-releases/target-profiles` 查看队列；`POST /api/tool-releases/target-profiles/{id}/review` 带当前 revision 审核。没有新的公共管理权限。
- 所有响应沿用 `{success,message,data}`；data 为 `{profile,signature,signingKeyId}` 或其列表。pending 的 signature/key 为 null；profile 包含 `schemaVersion,id,revision,name,providerId,productKey,edition,entryUrl,allowedRoutes,reviewStatus,capabilities,adapterVersion,evidence`。
- 每个 profile 使用独立 Setting 行；审核写锁 + revision 条件更新 + 同事务审计，冲突返回 409；不会覆盖另一管理员的审核。

最小登记请求示例（仅结构示例，不是新增批准入口）：

```json
{"name":"团队实训入口","entryUrl":"http://www.bjysoft.cn:8730/User/Welcome6","providerId":"bjysoft","productKey":"amazon","edition":"unknown"}
```

服务端丢弃 URL 的认证用户信息、query 和 hash，只保存规范 origin/path；不请求这个 URL。重复登记同一用户的同一无参数入口返回已有记录，状态保持 pending、capabilities 为空。无效请求不会回显原文或凭据。只登记不执行、不增加账号登录。

长度合同最终固定：入口名称 100，持久化的净 `entryUrl` 2048，审核 route 的 `origin` / `pathPrefix` 各 300；共享 schema 与 UI 使用 `TARGET_PROFILE_LIMITS` 同一常量。登记 API 原输入上限 4096，UI 先去参数再提交；本机打开 IPC 允许粘贴最长 8192 的原 URL，但去 query/hash 后的 origin/path 仍须不超过 2048。本机粘贴上限不是保存完整参数的许可。输出模型也声明同样的净字段长度，不仅依赖页面 maxlength。

审核请求字段为 `revision,reviewStatus,edition,allowedRoutes,capabilities,adapterVersion,evidence`。每条路由形如 `{"origin":"http://www.bjysoft.cn:8732","pathPrefix":"/ECrossAmazon","role":"business"}`，不接受根路径、通配符或编码路径；entry/login/business 分开。`template.create.v1` 要求经管理员核验的 V2、`bjysoft-v2-template.1`、最小 SHA256 页面指纹及 `amazon-v2` / `seller-shipping-template` 标记；V3、unknown 不能因此获得模板写入能力。没有签名密钥不能批准。批准包采用现有 Ed25519 覆盖全部 profile 字段与 revision。

新工具目录显式字段为 `requires_target_profile=true,target_capability="template.create.v1",runner_api_version=2`。新客户端仍使用 `POST /api/tools/{tool_id}/launch-grant`，在原 `platform_key,execution_mode` 之外传 `target_profile_id,target_profile_revision,client_runner_api_version=2`。响应 `launch_data.target_profile` 保留完整签名包；`tool_manifest` 签入 `targetProfileId,targetProfileRevision,requiredCapability`。`POST /api/tools/launch-grant/verify` 消费授权前再次检查入口状态与 revision，返回 `target_profile_id,target_profile_revision,required_capability`。审核后禁用或变更将阻止未消费的旧授权。旧客户端不能拿到仅协议 2 的发行版本，不能静默回退内嵌通用脚本。

本地验证：后端目标入口、发行服务、OpenAPI 新旧协议、原工具 API、hardening 与并发事务合并 138/138；后续增加 7 条边界回归后，目标入口专项 37/37（不是额外 37 个独立用例）。补验了 catalog 保存不会丢失协议 2 字段、指纹小写/最多 4 个标记、过长入口及桌面首期不支持的 `.local`/IPv6、冲突 V2/V3 标记禁止模板批准。受影响文件 Ruff 与 mypy 通过。OpenAPI 和生成 TS 合同已经更新，兼容门禁通过 213 个操作，前端 API 合同检查 unknown_responses=0；此阶段尚未封装，后续候选结果见上节，未部署。

最终长度对齐后追加净 URL/长 query/名称临界值回归，目标入口专项为 41/41；共享字段边界、两侧 UI、API 解析与控制器/策略合并 6 文件 100/100。UI 实际 maxlength、IPC 原网址与净网址两种上限均有断言；Electron 编译、测试类型、ESLint、Ruff/mypy 与 diff 检查通过。OpenAPI 与生成 TS 随输出模型约束重新生成，213 操作兼容门禁再次通过。这些覆盖与上组存在重叠，不能相加为独立总数。

独立执行进程的本地接口为 `TargetRunnerClient.run(plan, probe, {browser,journal})`，只执行打包编译的模板 Recipe，经 RPC 使用主进程已经持有的浏览器，不创建浏览器或二次登录。响应捕获必须先收到监听 ready 再点击；主进程拒绝没有持久恢复标记的填写、选择和非审核只读点击。只读 probe 已收集部分真实页面控件，但 Runner 使用的完整执行绑定及审核只读点击清单仍未安装，因此正式路径在任何页面动作之前返回 `TARGET_UI_EVIDENCE_MISSING`。fixture 注入仅用于单测且不能冒充真实 WebContents，不存在环境变量启用开关。

取消、进程退出、超时不会生成成功；已有 host 操作仍在退出时最多等待 5 秒，随后返回 `TARGET_HOST_DRAIN_TIMEOUT` 并保持 Runner busy。主进程已将 `isDraining/whenDrained()` 接到全局执行租约，并在 Runner 启动时建立排空屏障：注销使旧执行许可失效，但不会允许新账号或旧批量入口与仍未退出的页面操作并发。独立 Runner 专项 21/21，包含真实 fork 编译进程的默认阻断、监听握手、标记失败、上下文漂移、未标记写入拦截、伪造成功拒绝与退出隔离；测试不是外部平台 UAT。四个相关文件 ESLint、Electron 编译及测试 TypeScript 检查通过。

### 课程地图接管与首次未知入口：当前客观状态

- 约定的使用起点是用户在受控平台窗口中手动登录、选择课程、进入课程地图，再开始 KST 任务。没有把“先手动找到配送模板”当作已实现的课程地图接管。主线程已在学校入口现场只读走通课程地图 → 同源公司 iframe → 卖家后台新窗口 → 设置 → 配送设置 → 新建表单；编译自动导航尚未实现/验收，预检仍明确返回 `TARGET_NAVIGATION_EVIDENCE_MISSING`。账号标识、完整表单绑定与业务 UAT 不因人工导航成功而自动完成。
- 现场已确认列表页 `/ECrossAmazon/SellerShippingTemplateSetting` 的 `#btnAddTemplate`、`#divAddTemplate`；选择模板类型后导航至独立 `/ECrossAmazon/SellerShippingTemplateSettingAdd`，观察到 `#templateNameInput`（name=`templateName`）、`#btnSubmit`、`#btnCancel` 及 `div_10001–10004` / `div_20001–20002` 服务区域。只读 probe 分别识别两种结构，不读取草稿值、不点击或保存。页头版本位于 CSS 背景图 `/Images/Logo/24/LoginPage.png`，数字 24、控件名及路径都不是 V2 版本证据；尚无受审图片指纹或明确正文版本标志时，版本保持 unknown。国家/币种、完整保存与同对象回读绑定仍需补证与 UAT，不应再表述为“全部控件都没有”。
- 未审核窗口仅供用户手动浏览与只读识别，允许登录/选课产生的正常公网导航。首次识别后若同窗口跳到另一 origin，重新建立只读探测 port；它不是新增执行白名单。已审核窗口仍严格限制签名中的精确 origin 和 path，不能自动信任学校 WebVPN 的同级或全厂商子域名。`https://http-10-28-2-187-851.webvpn.gtcfla.edu.cn` 中的数字标签不会被当作私网 IP；这不等于该入口或某一课程已经通过业务验收。
- 平台 Cookie 仅保留在按 KST 账号与精确入口 origin 隔离的内存 session；候选入口获批或更新配置不会因为换 profile ID 创建另一套登录。不同 KST 账号、不同 origin/端口仍使用不同分区。`targets:refresh` 回到已审核的原入口并清除旧计划，保留同账号分区，要求用户手动重新登录；不保存或代填密码，不自动续跑未知提交。执行/排空中不能刷新抢占锁。可见同源登录 iframe 只检查密码控件是否出现，不读取控件值、不穿透跨域 iframe。
- `scenario/stage` 目前是用户声明，不是已识别的平台事实。比赛练习/正式选择均不能作为执行证据：预检明确禁用，执行与历史比赛回读返回 `TARGET_STAGE_UNVERIFIED`。操作账本已按账号/课程/店铺/角色/能力/对象去重，换入口别名、配置版本或阶段标签不能清掉未知结果锁。训练标签同样不证明实际场景；后续启用真实绑定前，还必须补当前场景与阶段的现场核验，不能通过改选“训练”代替核验。
- 本地控制器专项 30/30、运行策略专项 37/37；包括迟到旧账号请求、同一许可只执行一次、写前落盘失败、只读回查未找到仍待核对、刷新与分区、首次跳域、阶段缺证。追加真实已观测页面结构回放后，浏览器 port 专项 16/16；与控制器及模板 schema/回读测试合跑为 83/83（包含上述 controller/port，不相加）。原有桌面安全/IPC/批次恢复/退出专项 21/21 已通过；这些是本机行为测试，不是学校入口真实创建/恢复 UAT。未生成可执行完整绑定、未开放模板提交、未部署。

## 2026-10-12：模拟中断恢复与桌面计算补同步（当前源码接续）

继续在 `D:\开发项目\kst-experience-fixes` / `codex/update-experience-20261012` 工作，保留下节已完成的更新器、安装包和 UI 工作。当前源码基于正式 1.8.15 的 `0ecc2be821b8b74dc2c93a3dcab6321307b43e9b` 加未提交修改；**本节未提交、推送、部署或重打安装包。下节 1.8.16 安装包是此前候选，不含本节新增的计算修复，不得当作当前完整源码的新包交付。**

### 已修复

| 问题 | 复现与修复 |
| --- | --- |
| FBA 停止后重跑丢失入口 | 原流程仍停在子组件的确认/危险品页，再找新转换按钮失败。新轮先通过同一库存按钮回到起点，再进入转换；不清空已转换的 SKU。 |
| 仓库残留勾选导致取消选中或带入别单 | 原流程停止后重跑会反向点击旧复选框。新轮只清除临时批量勾选，再绑定选定订单；已分拣/打包/出库状态保留，并按同订单当前阶段继续。 |
| 失败控制栏只显示“未完成” | 现在自动展开控制栏并显示本轮失败原因；切换任务不继承别的任务错误，不把无效表单显示为成功。 |
| 桌面计算漏合并原复核修正 | 定向引入原 10/8 的三个计算/解析源文件及对应测试；修复缺价按零报价、显式汇率 0 被回退、UPS 计费重超限仍可选，以及表格/公式错误和冲突费率校验。真实费率表和官网隔离计算引擎保持原字节。 |

### 本轮依据与验证

- 已与官网、旧脚本/API 两个指定对话沟通。严格 HTTPS 回读公开官网仍为营销 1.8.12，源清单标识 `a65f2916f98caff38656bf6e61ab1baca5c1adba`，公开入口脚本 `index-D3TkwTcQ.js`、`V2SimulationView-yfUspOjC.js`；这些不是本节修复的部署证明。官网负责人核对 V2 子范围与已发布逻辑一致，无另一份未说明的新流程；未整包覆盖共享核心目录。
- Edge 实际核对五条任务 × 1440/390 两种宽度：均能完成并查看本轮结果，退出重新进入清空本次样例；无外部/API 请求、页面错误或页级横向溢出。默认仍为 guided，不把用于快速检查的 flow 速度描述成默认体验速度。
- 修复前新增停止重跑用例实际失败；修后 7 条重跑单测通过，包含 FBA 三处停止、仓库选中、已分拣续跑、模板重跑与已转换结果保留。Edge 另测五个中断重跑场景通过，均有保存后状态回读。
- 官网及所选运费相关单元测试 22 文件、393 项通过；原桌面计算/两端解析专项 90/90 通过，三个合成异常补验通过。两组有重叠，不能相加为独立测试总数。
- 最终静态构建的官网 Edge E2E **66/66 通过（3.4 分钟）**，包含新增的 1440/390 两个无效表单失败反馈场景；生产静态构建及隔离审计通过。仅官网候选，没有业务 API 或真实平台操作。
- Electron 编译、应用/测试/Electron/Node/E2E 类型检查、涉及文件 ESLint 和 diff 空白检查通过。初次类型检查遇到新重跑测试误用 `get().exists()`，修复后续跑失败段通过；官网首次构建因未显式传公开站点地址而被正确拦截，补入已核实的公开地址后再验收。
- 修复前后对照图在 `D:\AmazonToolboxData\audits\kst-simulation-20261012\before` / `after`；`review/browser-review.json`、`review/shipping-rerun-review.json` 是完整样例与连续发货证据。FBA/发货中断补验图沿用 `D:\AmazonToolboxData\audits\kst-update-20261012\demo-*-restart-passed.png`。已实际查看桌面、手机失败反馈和 FBA 重跑图；测试截图不代表真实平台操作或实体手机验收。

### 真实工具的接续建议（本节没有开发适配器）

保留现有授权、Runner、签名适配器、文件选择、批次和本机原子恢复账本，不另建 Python GUI，也不把旧 Selenium 直接打包为新工具。候选已经有 V2 域名限制，不能拿共享旧分支的 allowlist 当新故障；但内置通用选择器/“成功”提示仍不等于 V2 专用业务适配。

顺序建议：单对象只读预检与版本化报价 → 一个配送模板的受控保存/详情回读 → 单订单完整发货 → 再扩商品、FBA 转换、推广与批量。发货必须是“管理订单打开确认页（未最终提交）→国内仓分拣/打包/出库→读取同订单运单→回原卖家页确认→同订单回读”，不能用名称、第一行或两侧 SKU 文本拼接订单。

每条适配明确 `operation_id`、对象键、页面/iframe/新窗口上下文、请求业务结果及同对象回读。已有本机账本只会阻止未知结果盲重试；下一阶段才补工具级平台状态核验、登录恢复和跨页面恢复。远程适配器保持受限声明式能力，不开放任意 JS。V2/V3 页面适配、费率数据、计算公式、平台渠道码分离；未知新版费率和费用不能默认为零。

每条真实工具至少验证成功、校验失败、提交后断网/崩溃、重新登录、重复启动、已成功项不再处理。FBA 转换与货件入仓分开，完整货件仍需真实非空样本；官网五条演示不证明真实 API、Runner、完整结算或得分。

## 2026-10-12：1.8.16 更新可靠性与下载体验（前一轮候选记录）

本轮在 `D:\开发项目\kst-experience-fixes` 的 `codex/update-experience-20261012` 独立分支实施，以已发布 1.8.15 的 `0ecc2be821b8b74dc2c93a3dcab6321307b43e9b` 为基线。下方 2026-10-11 章节是历史快照，不代表当前发布状态。**本轮仅本地候选，未提交、推送或部署；不改变现有正式包和线上业务数据。**

### 已完成的修复

- 下载取消等待旧请求真正结束，防止取消后立即重试复用旧 Promise；进度事件按尝试隔离。显示实际传输速度、下载阶段及 30 秒没有新字节提示，不伪造进度或承诺自动续传。
- 安装前重新读取缓存并流式核验 SHA512；丢失、损坏或不可读时先拦截，不结束当前工作。准备超时与安装启动失败有独立错误和恢复路径；失败后不反复调用已经锁住的 updater 实例。
- 更新详情保留侧栏设计，团队工作区可打开；稍后安装仍可主动重启。重启确认使用原生 modal dialog，支持焦点、Escape 和关闭；关闭不等于同意退出时安装。
- 管理员上传显示真实字节进度，最长等待 30 分钟；提交结果不明先回读版本，不自动重复写入。同一登录会话切换页面不会丢失待核对标记，退出或换账号清理；不承诺软件重启后保留该内存标记。当前正式版与历史版本分开标注。
- 官网下载使用已验证的稳定入口；构建、上传前和发布后重新核对正式清单、同源 HTTPS、禁止缓存的跳转、二进制 MIME 和精确文件大小。候选版本尚未发布时，本地官网仍指向正式包。
- 官网只窄合并官网对话确认的较新导航、案例标注和移动布局，不覆盖为旧模拟体验。官网继续是静态产品站与隔离样例，不恢复业务网页版。
- 依赖在独立目录安装，保留旧共享依赖。固定 Node 22.23.3 / npm 12.2.0，更新 Zod 4.6.6、electron-winstaller 5.4.4，保留已验收 Electron 42.11.12；补真实嵌套 npm 命令测试，不能只凭声明认定工具链已更新。
- 候选只保留简中、繁中、英文 Electron 语言，去除桌面不用的旧营销入口和 ExcelJS 浏览器重复 bundle。保留桌面表格主模块，包内 Excel 读写必须实测通过；差量报告使用已验真的正式安装包基线，不把估算当实际下载测速。

### 验收证据与修复过程

证据根目录：`D:\AmazonToolboxData\audits\kst-update-20261012`。

- 完整前端/Electron 单元回归 169 文件、1653 项通过；Electron 实际 workflow 另 6/6。后续上传会话/API/更新界面补审 69/69，弹窗定位定向 10/10，均通过相应类型或 lint 检查；它们与前述全量集有重叠，不重复相加成独立测试总数。
- 官网浏览器场景 64/64 通过，包含电脑、手机、导航、样例暂停及网络隔离。营销发布门禁最终 31/31 通过；严格 TLS 公网只读校验仍指向 1.8.15，110599411 bytes。
- 类型检查、零警告功能 lint、OpenAPI 209 操作和前端 API 契约通过；凭据扫描 0，死代码检查 0。
- 依赖门禁通过：运行依赖无已知告警，保留 2 项已有构建期告警例外至 2026-10-25，不宣称所有依赖零漏洞。
- 首轮类型检查发现上传测试 mock 类型错误，已修；npm PATH 实测发现包内安装模板不能作为实际命令，已改受控 launcher 并验证嵌套执行。失败日志保留，不算作一次全绿。
- 首次候选构建虽成功，包内运行依赖审计发现 29 项缺失；原生启动同样实证 `fs-extra` 缺失，`after-GmBzuJ` 为 0 张截图的失败证据。根因是外部 `node_modules` Junction 导致 npm 返回残缺依赖树，打包器又容忍了非零退出。已把独立依赖物理化到工作树并新增 `beforePack` 门禁，拒绝 Junction、缺失依赖和异常依赖树；npm/差量/门禁 13 项通过，发布策略检查通过。`release-update-acceptance` 保留诊断、不可交付；旧共享依赖及正式安装包未改。
- 中间修复包 `release-update-accepted` 已通过包内依赖、Excel 实际内存读写及原生启动。`after-rUE9Pk` 6 张和 `after-FCwqCW` 16 张是分段采集，不是一次 22/22；前段中断是验收脚本重复按钮选择器问题。逐张视觉检查另外发现 3 个角色的重启框偏左上角，不能把这些图算作视觉通过。已显式修复居中和边距，清理废弃样式，并给原生验收增加中心误差、边距、焦点和窄窗/缩放断言。上述中间包亦不作为最终交付。
- 最终原生布局补验 `after-sZFBJf` **11 张、0 失败**，已逐图检查；覆盖三个角色及窄窗、125% 缩放、小高度，重启框中心误差不超过 2 CSS px，四周边距及焦点断言通过。实际最窄普通视口为 900px，最窄叠加缩放为 720×459px；文件名中的宽度只是请求值，以 `result.json` 为准。前段未受定位修复影响的下载与上传证据继续保留，不重复运行已通过流程，也不把全部截图说成一次通过。
- 最终包的 NSIS/manifest/SHA512、5 根依赖 / 200 个包依赖闭包、3 语言包、Excel 包内真实读写再次通过；`package-audit-ui-final.log` 中不允许源码、测试、后端程序等禁入内容，命中数为 0。最新上传会话隔离和回调清理已在 ASAR 中核到，与对应构建 bundle 一致。
- 对照页包含 10 个验收主题、12 张精选原图，在 1440px / 390px 浏览器检查图片全部可读、无横向溢出、无外网请求。没有用网页截图或受控下载事件冒称真实公网下载、Windows 安装成功。

### 本地交付

- 截图对照：`D:\AmazonToolboxData\audits\kst-update-20261012\验收对照.html`；`screenshot-manifest.json` 记录每张图片的来源与 SHA256。第 5 组明确区分“本轮中间候选视觉缺陷”与修复，不把它冒充旧正式版问题。图库只复制选定 PNG，不暴露测试数据库、浏览器 profile 或账号凭据。
- 最终候选：`D:\开发项目\kst-experience-fixes\release-update-accepted-ui\KST Setup 1.8.16.exe`；同目录有 `latest.yml`、`.exe.blockmap`、`update-delta-report.json`。仅此目录为当前交付，前两个 `release-update-*` 目录保留失败/中间证据，不能混发。
- 最终全包 **99,877,284 bytes（95.25 MiB）**；正式 1.8.15 为 110,599,411 bytes（105.48 MiB），减少 **10,722,127 bytes / 9.69%**。尺寸单位明确，不把 MB 与 MiB 混算。
- 相对已验真的 1.8.15，electron-updater 差量规划估算 **3,566,790 bytes（3.40 MiB，3.57%，11 个区间）**，可复用 96,310,494 bytes。必须存在完全匹配的旧安装包缓存且服务器支持 HTTP Range，否则全量下载；不包含协议/清单开销，**不是实测下载耗时或服务器提速承诺**。
- 代码基线、工作分支及历史正式包保持不变；当前代码未提交，因此基线 HEAD 不是本次修改的源代码身份。最终包、构建资源及 SHA 以证据目录的 `candidate-identity.json` 为准；后续正式发布须冻结源码并重建、完整验收，不能直接以脏工作树候选替代同 SHA 发布门禁。

### 发布边界

不包含公网带宽或 CDN 采购，不承诺这轮修改会提高服务器线路速度。候选仍未数字签名（沿用此前决定）。没有执行 Windows 覆盖安装、注册表迁移或用户真实业务；实际安装/升级仍须专用 Windows CI 验证。官网源码以当前官网对话确认的较新设计为准，部署前应再核对期间是否有新进展。尚未提交、推送、部署或通知为“已上线”；当前交付是可供本地验收的候选，不是生产发布结论。

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
