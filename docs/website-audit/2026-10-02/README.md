# 网站与业务资料审计底稿

## 当前交付入口

团队获取资料、项目改名与云端迁移状态、CI 待办以及 AI 接续提示见 [最新团队交接](../../strategy-materials/2026-09-23/TEAM-SYNC-2026-10-06.md)。

最新交付说明为 [DELIVERY-2026-10-06.md](DELIVERY-2026-10-06.md)，剩余条件和完成判据见 [remaining-gaps-2026-10-06.md](remaining-gaps-2026-10-06.md)。截至该说明所列现场证据：仓库到卖家确认的单笔成功链、配送模板新建/编辑/设默认/恢复/删除、子 SKU 的 FBA 转换与回读、商品推广编辑及精确标识关联、秒杀搜索/创建/编辑/取消、管理定价只读分支和按 SKU FBA 货件查询均已登记。**这不是全站或全部异常分支完成证明，也不是自动化脚本交付。**

| 当前事实源 | 内容 |
|---|---|
| [发货与会话补证](live-api-evidence-2026-10-04.md) | 四次写入请求、字段/编码、Code0、同订单逐步回读和登录失效 |
| [配送模板补证](template-api-evidence-2026-10-04.md) | 创建/编辑/默认/恢复/删除闭环；商品级绑定与价格分段已补，独立子SKU/批量绑定仍未证实 |
| [商品模板绑定](product-template-binding-2026-10-04.md) | 商品级0.3kg→0.5kg→恢复0.3kg已回读；逐子SKU/批量仍缺，DS2046处理时间只读 |
| [价格分段补证](template-price-band-2026-10-04.md) | 非空DS08A两段保存/回读/删除；请求规则序号与响应规则ID不同，地址开关存在未持久化异常 |
| [FBA 补证](fba-api-evidence-2026-10-04.md) | 子 SKU 转换、危险品界面、真实保存体、库存回读；保存响应正文仍缺 |
| [FBA货件只读补证](fba-shipment-readonly-evidence-2026-10-04.md) | 会话恢复后的货件/入库计划 Code0 空结果、货件详情字段和后续写入边界 |
| [补货与库存商品只读补证](replenishment-product-readonly-evidence-2026-10-04.md) | 订单列表 Code0 空结果、库存字段集合、配送类型筛选、亚马逊库存 FNSKU/体积与发补货入口 |
| [商品编辑页只读补证](product-edit-readonly-evidence-2026-10-04.md) | 重要信息、变体、报价/配送、合规/危险品、图片、描述、关键字和更多详情字段 |
| [商品推广补证](ad-api-evidence-2026-10-04.md) | SKU/ASIN 搜索、广告组保存、竞价及商品明细回读、父子 ID 关联 |
| [营销活动补证](activity-api-evidence-2026-10-04.md) | 秒杀有推荐后的创建/编辑/取消；创建和编辑响应正文仍缺 |
| [优惠券补证](coupon-api-evidence-2026-10-04.md) | 未来活动创建/编辑/取消回读；30小时被业务校验拒绝，6小时样本可保存 |
| [Prime补证](prime-api-evidence-2026-10-04.md) | 活动创建、商品验证/编辑/删关联/重加/提交；最终Code0但仍等待中/准备提交，未证明生效 |
| [购买折扣补证](promotion-api-evidence-2026-10-04.md) | 新测试促销创建/编辑/删除回读；删除Code0，原记录未动；创建/编辑正文仍缺 |
| [旧发货脚本复核](legacy-shipping-review-2026-10-04.md) | 旧步骤顺序与风险；静态候选不替代现场请求 |
| [跨平台费率信息契约](freight-rate-information-contract-2026-10-04.md) | V2/V3 原始价目表、规范化字段、重量/体积重、平台编码和版本差异边界 |
| [管理定价只读补证](pricing-readonly-evidence-2026-10-06.md) | 定价筛选、费用预览静态字段、`GetProductListRepeat` 502 和保存边界 |
| [按 SKU FBA 只读补证](fba-sku-readonly-evidence-2026-10-06.md) | 页面字段、状态值、`GetFBAPlanShipmentSKUList` 请求形状和空结果 |
| [库存规划只读补证](inventory-planning-readonly-evidence-2026-10-06.md) | 库龄报告、空态、筛选和禁用移除动作 |
| [买家消息只读补证](message-readonly-evidence-2026-10-06.md) | 消息类型筛选、搜索、分页和空态 |
| [亚马逊物流设置只读补证](fba-settings-readonly-evidence-2026-10-06.md) | FBA 设置分区、当前状态和编辑边界 |
| [上传图片只读补证](upload-imaging-readonly-evidence-2026-10-06.md) | 图片要求、WebUploader 资源和未触发上传边界 |
| [业务动作与操作准备度地图](operation-readiness-map-2026-10-06.md) | 商业链、旧脚本、当前 operation_id、可设计层级与人工确认闸门 |
| [云端平台访问配置说明](ACCESS-SETUP-2026-10-06.md) | 入口、团队凭据注入方式和不入库边界；不含真实账号密码 |

上表及新交付说明覆盖下文历史状态。下文的“FBA 0 SKU”“广告 0 候选”“秒杀无推荐”“模板未回读”“仓库请求未知”仅描述各历史样本，不再是当前全局阻塞。旧 r7 压缩包含已撤回结论，不能作为最新版使用；新版压缩包须以实际生成及校验结果为准。

隐私范围：文本字段记录已脱敏，但部分本地截图仍显示原商品标识/标题，不代表全部图片可公开；本次公开 GitHub 同步只包含 Markdown 资料，不包含 `evidence-images/` 本地截图目录。实际交付图像范围与限制见最新交付说明及打包清单。FBA截图只作列表背景，目标转换以请求和同对象回读为证。

## 历史记录

打包阅读顺序及图片排除范围见 [PACKAGE-R8.md](PACKAGE-R8.md)。当前最终 r8 压缩包为 `D:\AmazonToolboxData\deliverables\V2平台技术证据审计包_2026-10-04-r8-final2.zip`，其 SHA-256 与清单复核结果写在最新交付说明中。下文旧缺口由上表较新专项覆盖；不可忽略采集时间和样本差异。

资料底稿日期：2026-10-02；现场采集日期：2026-10-03（Asia/Shanghai）  
当前阶段：首轮只读基线已被后续用户明确授权后的现场写入实测增量覆盖；未运行旧 Selenium 自动化。现场采集使用 Codex 内置浏览器（IAB）；另行修改的 KST Electron WebView 宿主不是该 IAB，不能据其代码和测试断言现场采集已修复。未修改平台、数据库或生产部署。

发货阶段进展（2026-10-04）：已在 IAB 补齐新样本 `shipping-sample-20261004-02` 的仓库三步与卖家确认四次写入 API、字段/编码、HTTP 200、业务 Code0 和逐步回读；已发运由 10 变为 11。同一新样本成功分支已确认，旧订单未重复处理。随后其他模块的补证见顶部当前入口；异常分支仍未完整覆盖。

> 状态说明：本文前半段保留 2026-10-02 首轮“只读采集”边界，不能覆盖后续事实。商品保存、配送模板、商品推广、优惠券、购买折扣、FBA 转换和 Prime 保存结果，以 `DELIVERY-2026-10-03.md`、`live-observations-2026-10-03.md`、`network-observations-2026-10-03.md` 与 `script-sync-complete-2026-10-03.md` 为准。

## 目的

把现有商业计划、赛训打法、仓库中的网站代码，以及外部云端软件的页面/网络证据放在同一处，供后续按页面分支继续采集。本文档只记录已经看到的事实和待验证项，不把静态代码分析写成真实平台能力。

## 资料来源

- GitHub 仓库：`https://github.com/fengzide86/kesaitong-platform.git`
- 原采集时快照：分支 `codex/strategy-materials-2026-09-23`，HEAD `cb24680`；当时主线 `origin/main` 为 `ebc756d`，产品版本 `1.8.12`。最新技术/迁移基线见团队交接，不用历史 HEAD 代替当前检出提交。
- 赛训资料入口：`docs/strategy-materials/2026-09-23/README.md`、`REVIEW.md`、`HANDOFF.md`、`manifest.json`、`05_V2商品字段与网络接口地图_2026-09-24.md`，以及 `sources/` 下 5 份 PDF、1 份 XLSX、1 张 JPG。
- 本机商业计划（被 `.gitignore` 忽略，不在 GitHub）：`.tmp_business_plan_v2/source.docx`（2026-06，v1.0）和 `.tmp_business_plan_v2/commercial_validation_v2_clean.docx`（2026-08，v2.0；其余 repaired/redline 文件是衍生交付件）。
- 外部入口：`http://www.bjysoft.cn:8730/User/Welcome6`。
- 现场采集：`live-observations-2026-10-03.md`、`coverage-matrix-2026-10-03.md`、`network-observations-2026-10-03.md`、`scope-exclusions-2026-10-03.md`、`legacy-script-reference-2026-10-03.md`。
- 旧资料盘点：`legacy-folder-inventory-2026-10-03.md`、`old-script-step-map-2026-10-03.md`；前者记录迁移目录、商品字段资料和旧运行环境，后者记录旧脚本步骤与高影响动作。
- 技术证据底座：`v2-page-button-inventory-2026-10-03.md`、`v2-api-catalog-2026-10-03.md`、`v2-event-traces-2026-10-03.md`、`v2-field-and-boundary-matrix-2026-10-03.md`、`v2-error-permission-matrix-2026-10-03.md`、`v2-evidence-gaps-2026-10-03.md`、`parallel-execution-matrix-2026-10-03.md`。
- 历史交付入口：`FINAL-STATUS-2026-10-03.md`、`DELIVERY-2026-10-03.md`；当前入口见顶部 `DELIVERY-2026-10-06.md`。历史压缩包 `D:\AmazonToolboxData\deliverables\V2平台技术证据审计包_2026-10-04-r7.zip` 含有已更正的稳定性因果结论，不推荐继续使用；文档更正本身不代表已重新打包。

## 证据等级

1. **现场页面/请求**：以后在允许的浏览器会话中逐页观察并保存脱敏记录。
2. **静态前端证据**：公开 HTML/JavaScript 中出现的路由、字段和请求线索；不能证明当前账号返回了同样数据。
3. **业务计划/资料主张**：只作为待验证的打法假设，不直接当作平台规则、收入或成绩。

## 当前边界

- 登录由用户在浏览器中手动完成；本资料不保存账号密码、Cookie、Token、学号或客户数据。
- 首轮采集没有调用保存、提交、发布、广告、发货、提现或其他业务写接口；后续授权实测的写入动作已在专门章节按对象、请求与回读记录。
- 不运行旧 Selenium 脚本，不把按钮点击或 `SaveProduct` 线索替代为完整脚本交付；已完成的现场写入只代表指定测试对象的事实。
- 历史首轮曾记录浏览器安全权限检查阻断；该记录仅描述当时状态，不覆盖后来通过正常入口完成的现场访问。没有绕过安全控制，也没有用替代浏览器自动化规避它。

## 本轮现场增量（2026-10-03）

先前误把 `21=敦煌网仿真` 当成亚马逊入口，导致 `loginPage21` 的试用权提示被错误归因到亚马逊。本轮重新目视核对 Welcome6 卡片，确认 `24=亚马逊仿真`，从 `loginPage24` 正常登录并进入课程首页；字段级缺口仍见 `v2-evidence-gaps-2026-10-03.md`。本轮受控测试又补了配送模板保存回读不一致、广告商品搜索 0 商品、卖家配送进入 FBA 转换页 0 SKU 三个边界；这些均已标记为未完成证据，不作为成功协议。

## 后续接续顺序

按“入口 → 导航 → 页面状态 → 分支动作 → 请求 → 返回/错误 → 回读”记录。所有请求记录脱敏后的方法、路径、触发条件、依赖上下文和是否写入。当前使用 Codex IAB 的网络事件读取能力，应及时逐批读取事件游标并核对 `truncated` / `hasMore`，不能把独立 KST Runner 的 `.network.json` 保存能力当作本次 IAB 已使用的采集路径。2026-10-04 读取命中登录失效后，已通过正确的 `loginPage24` 恢复亚马逊课程首页，并打开 Amazon → 卖家后台；这不等于稳定性完整验收。

下一批按用户筛选后的页面范围继续；截图中明确排除的入口不再深入。每批结束更新现场记录与覆盖矩阵，并保持“页面已加载不等于完整页面验收、静态候选不等于现场可访问、可写或可得分”的证据标签。

## 2026-10-04 追加

先补抓订单“确认发货”表单的只读初始化链路：页面字段、承运人选项、`GetFreightList` 与 `GetOrderDetail` 的 200 响应已进入现场记录、API 目录、网络观察和事件时序。当时尚未填写或提交运单信息；这一历史阶段的缺口随后被下文真实闭环记录更新。

同日按用户明确授权对同一未发货订单首次提交确认发货，真实触发 `SaveDeliverGoods`；HTTP 200 但业务 `Code:10`（账号在其它地方登录，暂时下线），随后进入登录失效恢复分支，当时订单仍回读为未发货。该次写入不计为成功；后续恢复和回读结果见下一段，不再把首次失败写成当前待执行事项。FBA 转换与广告搜索的 0 SKU/0 商品分支继续按当次对象的不可用证据保留。

随后已在恢复的单一会话中按旧脚本真实顺序完成同一订单的国内仓库分拣、打包、立即发货和发货记录回读，再回到卖家确认发货页提交；页面提示“操作成功.”，管理订单已发运数量由 9 变为 10，已发运列表回读为“订单完成”。前三个仓库写入的 method/path 未被监听器稳定保留，未在文档中猜测；成功闭环和未知项分别见现场、网络、API 与事件记录。

## 2026-10-04 稳定性结论更正与现场核验

本节先保留恢复阶段事实，后续已完成的单样本成功分支补证见下一节；“尚未验收”不再表示仓库成功链未执行，但仍不能宣称全量稳定性验收。

撤回此前“缺少 Network 监听是本次现场不稳定直接原因、现已修复”的结论：KST Electron WebView 与 Codex IAB 是不同宿主，KST 增强及此前记录的编译/测试结果不能证明 IAB 稳定。已完成的平台操作和回读事实保留，未捕获请求仍按未知处理。

最新 IAB 现场核验中，`Network.enable` 成功，重新加载后观察到 `POST /ECrossAmazon/GetOrderStatusNum` 与 `POST /ECrossAmazon/GetOrderList` 均 HTTP 200；外层 `result` 字符串解析后包含 `Code`、`Msg`、`RedirectUrl`、`Token`，业务结果为 `Code:10`、`Msg:上次登录已失效，请重新登录(101)`，未保存后两字段的值。首次事件批次为 `truncated=true`、`hasMore=true`，续读下一批后队列清空，说明必须及时读取游标。随后已从 `loginPage24` 恢复课程首页（页面显示处理订单 10 笔），并打开 Amazon → 卖家后台；尚未完成跨页面、写入、返回和回读的稳定性验收，详见 `live-api-evidence-2026-10-04.md`。

## 2026-10-04 发货 P0 成功分支补证

IAB 已真实捕获 `POST /ECrossAmazonHome/EditOrderSorting`、`EditOrderPack`、`EditOrderDelivery` 与 `POST /ECrossAmazon/SaveDeliverGoods`；四次均 HTTP 200、Code0，并有同一新样本的下一列表或详情回读。请求→响应序号依次为 `2245→2253`、`2433→2441`、`2615→2623`、`3008→3011`；最终列表 `3184→3187` 回读“订单完成”，未发货 26→25、已发运 10→11。旧阶段“仓库前三条路径未知”保留为历史事实，不再是当前成功分支缺口。

已记录外层 `arrayStr`、URI 编码 XML 的内层字段，以及仓库/卖家同一订单的关联要求；没有保存原始订单号、SKU、运单或认证信息。动作前后按游标及时读取，成功链各批 `truncated=false`、`hasMore=false`；续读不能恢复早前已经淘汰的事件。当前仍缺失败/重复提交/库存不足/承运人不可达分支、`DS4234/DS4255` 精确语义和跨会话持久恢复。完整证据见 `live-api-evidence-2026-10-04.md`，不扩大为 FBA、模板、营销模块完成。
