# 工具运行合同与接入边界（候选实现）

## 同事接入工具

交付编译期审核的 `ToolStages<Input, Data, Plan, Result>`，不要向运行时传远程 JS、选择器脚本或任意执行表达式。版本化描述位于 `src/shared/ipc/toolkit-contract.ts`，宿主位于 `electron/automation/toolkit-runtime.cts`。

必须实现六阶段：`detect → read → plan → execute → verify → reconcile`。输入与结果都用 Zod 校验；先读取真实现场生成计划，执行前再次验证身份、项目、站点及策略版本。发生变化只能重新生成计划。写入前必须持久记录意图；提交结果未知进入 `needs_review`，同一计划不得自动重试。`reconcile` 只读取原对象并核对，不能重新提交。

宿主共用 `ExecutionLease`，不创建第二个队列/Runner。`authorize` 必须检查服务端授权与已审核能力，`saveIntent` 必须落盘成功才可变更页面。Cookie、账号密码、客户文件和页面原文留在本机，不写控制面报告。模型或 UI 动画不能声明业务成功。

## 已接入与明确边界

- 运费计算：实际 `freight:quote` IPC 已经过通用六阶段宿主和共享执行租约，读取费率包、生成计划、计算并重新计算核验，保留原返回合同。它是本地计算，不伪造网页/账号/项目身份，也不记作外部任务成功或占用写入额度。
- V2 配送模板：`toolkit-examples.cts` 提供适配模板；实际客户与管理员执行仍复用现有 `TargetExecutionController`、独立 Runner、持久操作日志和已审核 UI binding。尚未把这条高风险链路替换成通用宿主，不能称为两类工具均完成统一宿主迁移。该适配不得绕过原签名、课程范围、登录响应与同对象回读核验。
- 新公司注册、上品、V3、比赛写动作没有因本轮框架完成而开放。缺少已审核配置时拒绝执行。
- 新商业授权的真实写入须有管理员审核的 `project_id + site_origin → courseRef` 映射；映射只能选择同站点、同场景签名入口已有的审核课程。未配置映射不能执行，不接受手填项目号作为现场证据。

## 管理员本机工作台

`/admin/local-runtime` 使用独立 staff 权限，不借客户授权码、不继承 B 端套餐。默认六个现场、最多十个，各自采用独立非持久 Session；同一账号中卖家弹窗用同 Session 的新视图，并走原 `OwnedNavigationScope` 精确来源/课程/店铺 handoff。三个及以上账号可并存，自动运行始终只有一个；任务未结束不得切换、清理或打开其他账号。

工具授权采用服务端一次性 `StaffToolGrant`，绑定 staff 登录版本、设备、账号槽位、策略版本和计划摘要。使用前调用服务器 verify 并原子消费。报告与只读核对写独立管理员台账，保留最初失败报告并追加后续同对象核验，不读写同号客户记录。

客户依旧只有一个现场。换工具现场/刷新重新登录会停止旧现场并清理旧 Session，重建使用新 nonce，不采用历史持久 Cookie。管理员关闭现场只清该账号。关闭后的未确认操作日志不删除。

## 策略与部署次序

管理端 `/admin/scenarios` 分配训练/比赛，授权级策略覆盖所有相关用户，用户级限制取交集；比赛不能由客户降级成训练。精确比较协议、主机和端口，允许指定官网正常路径，额外 origin 必须明确批准。

主进程每 30 秒拉取策略；网络失败、到期、版本变化会撤销现场执行，停止受控导航，未知提交日志仍保留。新登录/执行必需服务端明确返回策略；只有显式 `unassigned` 客户策略保留旧训练范围。**上线必须后端与迁移先行，再发布新客户端**，404/离线不回退成无限制。不要把该 fail-closed 条件描述成旧后端也兼容运行。

比赛模式下课赛通发起的“外开”链接仍进入受控 Electron 页面，后续 iframe、弹窗、重定向继续检查 origin；不转交 OS 浏览器导致失去边界。限制仅限新版课赛通，不控制电脑其他浏览器。

## 免费额度回执链

服务端创建 LaunchToken 与 `reserve_trial` 同事务。没有消费且已过期/撤销的 token 可按服务端证据释放；已消费、断线或失败回执一律暂挂，不依据 `page_changed=false` 退额度。原已消费 token 的成功回执仅扣一次，未知结果需原 run_id 的同对象核对后结算。三个免费能力独立额度；未验收能力仍不可运行。

## 本地回归入口

`backend/tests/test_scenarios.py`：策略、场景版本、staff 独立授权/核对、项目映射与免费额度真实启动/回执。

`src/tests/electron/scenarioRuntime.test.ts`、`localScenes.test.ts`、`freightToolkitEntry.test.ts`、`targetController.test.ts`、`executionHardening.test.ts`：精确 origin、30 秒撤回、隔离账号、单执行租约、通用阶段、管理员 popup handoff 与核对、Cookie 清理。

这些为隔离合成回归，不等于已在真实学校/比赛官网验证或生产发布。最终候选包、实机三账号登录与真实已审核工具验收由主线交付报告记录。
