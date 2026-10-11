# KST website visual direction

The website uses the existing KST SVG identity, a three-part pain-point layout and code-native before/after action comparisons. It does not load a generated hero bitmap or copy a live application workspace.

## 场景识别素材

- `amazon-simulation-icon.png`：2026-10-09 从官方课程平台获取的原始图标，替换用户截图。来源 http://www.bjysoft.cn:8730/Images/User/Welcome6/24/bright/01.png ，由官方 Welcome6 页面脚本引用；原图 120×120 px，以 60 CSS px 展示，保留 2 倍像素密度。未重绘或 AI 修复。
- `contest-listing-source.png`：用户提供的数字贸易系列赛事列表原图，仅作来源留档，不直接展示。
- `contest-crossborder-crop.png`：旧版低清局部裁切，保留留档，官网不再引用或放大展示。
- `contest-crossborder-2026-4x.png`：2026-10-09 从 https://www.idtrade.cn/User/Contest 重新截取“第九届全国数字贸易技能大赛 / 跨境电商数字化运营技能大赛”单张真实卡片。Edge 视口 1920×1200，设备像素密度 4；原始元素 240×176 CSS px，输出 960×704 px。等待网页字体加载后截图，未 AI 修复、重绘或拼接；详情页展示不超过 288px，保留原比例。日期为截取时官方页面显示内容，不代表未来实时赛程。

赛事卡按用户要求仅用于场景识别；图片旁提供官方来源。不表示官方合作、指定工具或赛事背书，也未将可公开访问视为开放使用许可。本轮仅本地预览，正式发布前仍需确认素材公开使用条件。

这些图片只用于说明访客正在看的场景，不承载账号、成绩、订单或业务运行数据。

- One light visual system: white surfaces, navy headings, neutral body text, blue actions and orange pain-point emphasis.
- Course and competition pages contrast human decisions and repeated operations with bounded tool assistance, not live execution or customer results.
- Scenario buttons only switch local presentation content. No account data or business operations are requested.
- Short one-time entrance and interaction transitions respect the operating-system reduced-motion preference. No mock execution progress.
- Layout references: https://linear.app/now/behind-the-latest-design-refresh (hierarchy), https://www.raycast.com/ (short purpose statements), https://www.junglescout.com/ (adjacent user goals and product assistance). Their imagery and brand styles are not copied.
- The rejected generated sculpture, its prompt, and previous landing source are preserved outside the repository in `D:/AmazonToolboxData/deliverables/kst-brand-redesign-20260920/before/`. The original PNG remains in the previous delivery's `source-art/` folder.

## 用户授权的历史证书（2026-10-09）

- `competition-award-2025-redacted.jpg`：用户提供并授权脱敏展示的 2025 年第六届全国数字贸易技能大赛跨境电商赛全国总决赛一等奖证书。保留赛事、年份、奖项与印章；参赛成员、指导老师、院校、证书编号和二维码用不透明米白遮挡条覆盖。公开副本 1600×2263；不是第九届赛事获奖材料。
- `team-qualification-redacted.jpg`：用户提供并授权使用的“跨境电子商务师（中级）职业能力证书”，发证日期 2025-05-25。姓名、性别、身份证号与证书编号完整遮挡；公开副本 1400×1992。仅作比赛页次级证书查看入口，不设团队专业能力板块、不表示课赛通获官方认证。
- 两张图片均为固定像素遮挡后扁平化的 JPEG，不依赖 CSS 覆盖，不使用 AI 重绘，不携带原图 EXIF、缩略图或定位信息。原图不复制到仓库，不修改原文件，不在公开说明中记录原图路径或私人字段。赛事和奖项文字未改写。
- 脱敏处理、源文件 SHA 与遮挡区域检查记录保存在私有验收目录 `D:/AmazonToolboxData/acceptance/kst-award-evidence-20261009/`。两人分别查看完整公开图，确认隐私区域无残字/二维码碎片。图片与用户口述属于用户提供材料，未宣称第三方查验或工具单独导致获奖。
