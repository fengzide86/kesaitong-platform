# 按 SKU 查看亚马逊货件只读证据（2026-10-06）

## 1. 进入路径和现场结果

从“管理亚马逊库存”首个 FBA 商品的行级“查看亚马逊货件”进入：

```text
/ECrossAmazon/SellerStockFBAListBySku
```

本轮只读打开页面，没有创建货件、修改数量、预处理、贴标、确认、发货、取消或删除任何对象。

现场页面提供：

- 状态筛选：所有、处理中、在途、在运营中心、已完成、已删除/已取消；
- 表格列：货件名称、创建时间、上次更新、产品编号、SKU、数量、入库时间、状态；
- 默认每页 15 条。

当前页面回读为 0 行，分页计数为 `0`，页面显示“无相关数据”。这只说明当前课程/店铺/商品 SKU 上没有可回读的货件记录，不代表 FBA 商品转换失败，也不代表创建货件接口不可用。

## 2. 按 SKU 查询请求形状

页面脚本：

```text
http://www.bjysoft.cn:8732/Scripts/ECross/amazon/SellerStockFBAListBySku.js
```

脚本先从加密路由参数解出：

```text
courseId  -> p_courseId
shopId    -> p_shopId
proId     -> p_ds2301
ds2302    -> p_ds2302
```

然后调用：

```text
POST ../ECrossAmazon/GetFBAPlanShipmentSKUList
```

正文外层为 `arrayStr`，其值是一个 JSON 数组：

```json
{
  "arrayStr": "[{\"courseId\":\"<course>\",\"shopId\":\"<shop>\",\"ds2301\":\"<product>\",\"ds2302\":\"<sku-context>\",\"status\":\"<filter>\",\"keyword\":\"\"}]"
}
```

当前现场“所有”筛选对应的 HTML 值为 `10`；其余筛选值为：处理中 `0`、在途 `2`、在运营中心 `3`、已完成 `4`、已删除/已取消 `5`。脚本没有把 `language` 放入这条请求的数组字段。

## 3. 响应消费和证据边界

脚本只在 `CheckResult(json.result)` 通过后解析 `json.jsonStr`，再把数组绑定到 Kendo Grid。当前现场页面没有货件行，因此本轮确认的是：

- 页面宿主和按 SKU 路由；
- 状态筛选和字段列；
- `GetFBAPlanShipmentSKUList` 的请求方法、端点和字段形状；
- 当前空数组/空表的用户可见结果。

本轮没有保存真实父商品编号、SKU、FNSKU、货件编号或完整加密查询参数。也没有把旧脚本中的字段值写回当前账号，更没有通过伪造数量来制造货件对象。

## 4. 和全局货件列表的关系

`SellerStockFBAListBySku` 是按商品上下文过滤的专用查询；它不能和全局 `SellerStockFBAList` 的 `GetFBAPlanShipmentList` 直接合并成一个请求契约。前者使用 `ds2301`、`ds2302`，后者使用货件筛选、搜索和分页上下文；两条读取链路应分别保存。

## 5. 下一步缺口

若后续需要补货件详情字段，必须先在不改变业务对象的前提下获得一个真实存在的货件记录，再读取详情及箱/商品明细。当前空结果不支持继续验证货件创建、箱子、承运人、标签或完成请求；这些仍保持为未执行范围。
