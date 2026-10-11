# 接口契约与质量门禁

本文记录模块化单体在不改变产品行为、公共 API 和数据库结构前提下的开发约束。

## 固定运行环境

- Node.js 使用 22 系列，版本入口为仓库根目录 `.node-version`，`package.json` 的 `engines` 会拒绝不兼容的大版本。
- 后端候选基线是 Python 3.12。开发依赖引用 `backend/constraints-py312.txt`；Docker、CI 和部署解释器必须同轮迁移，不能以本地通过宣称生产已迁移。
- npm 12.2.0 使用 `npm ci` 和已提交的 `package-lock.json`，不在共享 junction 安装或更新。
- 有意更新 Python 依赖时，在独立 Python 3.12 环境对运行依赖与开发依赖列表做 `pip install --dry-run --ignore-installed --report <report.json>` 解析（避免旧约束阻止目标升级），再执行 `python scripts/generate_python_constraints.py --report <report.json>`，用新约束干净安装、闭包检查、漏洞扫描及完整回归。其他时候不重解版本。

## OpenAPI 契约

`backend/openapi-baseline.json` 是兼容性基准，`backend/openapi.json` 是当前完整文档，`src/shared/api/openapi.generated.ts` 是前端编译期类型。

```powershell
npm run openapi:generate
npm run openapi:check
```

`openapi:check` 会重新导出文档、检查路径/方法/参数/请求体/响应码没有被意外删除，并确认生成的 TypeScript 文件无未提交差异。现有 Zod 运行时校验仍然保留。

所有 FastAPI 路由必须显式声明 `response_model`。已经完成精确 DTO 的接口直接使用 `APIResponse[T]` 或具体模型；尚在渐进迁移的旧接口使用 `CompatibleResponse`，它保留原先 FastAPI `jsonable_encoder` 的运行行为，不会强制改变响应字段。

## 模块边界

```powershell
npm run architecture:check
```

边界检查禁止 `domains` 反向依赖 `routers`、领域间直接引用内部实现、遗漏路由响应模型，以及新增 Router 事务提交/回滚和未标注签名。当前遗留项记录在 `backend/architecture-baseline.json`；只允许减少，不允许增加。

平台看板服务的规范入口是 `domains.platform.DashboardService`，产品权限的规范入口是 `domains.access`。旧的 `services.dashboard_service` 和 `services.entitlement_service` 仅保留兼容导出，新增调用方不得继续依赖旧入口；后续领域迁移沿用相同的“新入口先落地、调用方切换、兼容出口最后删除”顺序。领域之间只允许引用另一个领域的包级公开契约，不得导入其内部模块。

Electron 的 `main.cts` 只做主进程组合，现有桌面生命周期实现位于 `desktop-application.cts`。Runner 的 command、event、Host Request/Response 和协议版本统一由 `src/shared/ipc/automation-contract.ts` 校验；事件名、preload 方法和执行顺序保持不变。

Business Workspace Store 保持原公开 state/action 契约。纯数据转换位于 `src/features/business/workspace-helpers.ts`，离线队列、重试与恢复位于 `src/features/business/workspace-outbox.ts`。

公司公账支出属于 `commerce` 领域，但和订单收入、分润记录保持独立。五张表分别保存分类、实际支出、凭证元数据、续费项目与周期处理记录；待续费只按日期实时计算提醒，只有确认续费才会原子生成实际支出。确认和跳过请求必须携带当前 `due_on`，领域服务在行锁内核对周期并依赖唯一约束防止并发重复入账。凭证文件存入 `EXPENSE_ATTACHMENT_DIR` 指定的持久目录，数据库只保存元数据。

后台页面入口为 `/admin/expenses`。超级管理员和运营可读写支出与处理续费，只有超级管理员能管理分类，客服路由和接口均不可达。前端编译期使用生成的 OpenAPI 类型，同时由 `src/features/admin/expenses/model.ts` 的 Zod 契约执行运行时解析。

## 检查命令

快速开发检查：

```powershell
npm run typecheck
npm run lint -- --max-warnings=0
npm run architecture:check
npm run openapi:check
npm test
npm run verify:backend
python -m pytest backend/tests/api/test_expenses.py --rootdir=backend -q
```

完整发布候选检查（只检查和构建，不提交、不发布、不连接生产服务器）：

```powershell
npm run verify:release
```

CI 把前端、后端、MariaDB、E2E 和桌面包拆为独立 Job。MariaDB Job 设置 `REQUIRE_MARIADB_TEST=1`，没有真实数据库连接时必须失败；E2E 失败会上传 trace、截图和测试报告。
