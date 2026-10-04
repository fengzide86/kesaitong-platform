# 后续全站页面与网络采集表

## 页面记录字段

每个页面一行或一个 JSON 对象，至少记录：

`page_key`、`source_url`、`parent_page_key`、`entry_action`、`visible_title`、`iframe_or_popup`、`route_or_paras_presence`、`role_or_product_type`、`read_only_observation`、`branch_actions`、`request_keys`、`response_summary`、`error_branch`、`write_risk`、`evidence_time`。

`paras`、Bearer、Cookie、学号、密码、客户数据和商品原文只记录“存在/依赖关系”，不保存原值。

## 请求记录字段

`request_key`、`method`、`host_port`、`path`、`trigger_page`、`trigger_action`、`body_schema`、`query_schema`、`auth_dependency`、`context_dependency`、`response_shape`、`read_or_write`、`replay_risk`、`observed_status`、`notes`。

## 采集顺序

1. 入口页和产品类型分支：Welcome6、21/22/24/25 登录壳。
2. 登录后默认页：只记录导航、面包屑、iframe、弹窗、列表和分页，不点提交。
3. 一级导航逐项进入：目录、库存、定价、订单、广告、品牌旗舰店、增长、数据报告、绩效、应用商店。
4. 每个页面先做静态结构记录，再做一次无写入分支（搜索、展开、分页、切换标签）；保存/提交按钮只记录存在和可能的请求名。
5. 对每条只读请求记录返回字段与权限/空数据分支，标注是否由动态 `courseId`、`shopId`、语言和 `paras` 驱动。
6. 最后按页面树整理“同一页面的不同状态”和“点击后进入的新页面”，再讨论脚本边界。

## 明确不做

- 不调用保存、发布、发货、广告、提现、删除、注册或改密码。
- 不上传文件、不提交商品、不发送消息、不改变账号设置。
- 不复制 Cookie、Token、密码或未脱敏请求到 GitHub、聊天或报告。
- 不把前端静态代码中出现的接口当成当前账号已授权或已可执行。

