# 上传图片只读页面证据（2026-10-06）

## 1. 页面入口

从卖家后台“库存 → 上传图片”进入：

```text
/ECrossAmazon/SellerUploadImaging
```

本次没有选择文件、打开文件选择器或点击“提交图片”。

## 2. 页面校验说明

页面标题为“批量图片上传”，说明了图片至少一张、主图白底、商品占比、最长边、单文件大小、JPG/PNG/TIF/GIF 格式和 `ASIN + 变体代码 + 扩展名` 命名要求。页面提供“取消”和“提交图片”两个按钮。

当前 DOM 没有可见的 `input[type=file]` 或表单 action；文件选择控件由 WebUploader 在后续交互中动态接管。因为没有文件对象，本次没有产生上传 POST、文件校验结果或服务器回读。

## 3. 静态资源

页面加载了：

```text
/Scripts/lib/webuploader/webuploader.js
/Scripts/lib/webuploader/powerWebUpload.js
/Scripts/ECross/amazon/SellerUploadImaging.js
```

另有卖家后台共享布局、Kendo UI、语言和水印资源。

## 4. 当前证据边界

已确认图片要求、动态文件控件边界和提交入口。文件格式错误、命名错误、尺寸/大小校验和上传后的业务回读需要用户明确提供测试文件与范围后单独验证；本次不把静态说明当作实际校验协议。
