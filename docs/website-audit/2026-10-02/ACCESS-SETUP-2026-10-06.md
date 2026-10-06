# 云端平台访问配置说明（2026-10-06）

本文件只说明团队如何配置访问信息，不保存真实账号、密码、Cookie、Token 或完整认证参数。

## 访问入口

```text
BJYSOFT_BASE_URL=http://www.bjysoft.cn:8730/User/Welcome6
BJYSOFT_USERNAME=<从团队密码管理器获取>
BJYSOFT_PASSWORD=<从团队密码管理器获取>
```

## 团队使用方式

1. 由项目负责人通过团队密码管理器或一次性安全渠道单独分发账号和密码。
2. 每位成员只在自己的本地密码管理器、系统凭据或未提交的 `.env.local` 中保存变量。
3. 不要把真实值写入 Markdown、GitHub Issue、Pull Request、提交信息、截图或聊天记录。
4. 使用完毕后关闭浏览器会话；不要保存 Cookie、Authorization 或带认证上下文的完整 URL。
5. 如果密码曾经被写入 Git、公开仓库、截图或群聊，应立即更换密码，再继续采集。

仓库的 `.gitignore` 已忽略 `.env.local`、`.env.*.local` 和常见凭据文件。当前审计资料只记录入口、页面结构和脱敏证据，不包含真实访问值。

## 与当前审计范围的关系

登录本身不代表可以执行业务写入。后续继续采集时仍按 `operation-readiness-map-2026-10-06.md` 的页面上下文、对象、回读和人工确认闸门执行；改价、建货件、发消息、上传图片和真实发货必须另行确认。
