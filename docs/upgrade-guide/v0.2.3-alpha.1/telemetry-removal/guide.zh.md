---
kind: upgrade-guide
description: "移除了遥测、产品分析和 DeepSeek 请求元数据收集。"
---

# 遥测移除后的升级

[English](guide.md) | 中文

## 变更

随附 profile 不再导出产品使用情况、会话日志、反馈或插件清单。DeepSeek API 适配器发送模型请求时不再附带 Harness 安装标识和会话 id。反馈保存在本地会话日志中，`/feedback` 显示接收反馈的会话 id。已有会话仍可读取。

## 迁移

1. 从自定义补丁中删除 `otel`、`session-telemetry-otel`、`session-log-deepseek`、`deepseek-llm-api-extensions`、`plugin-package-inventory-deepseek`、`desktop-product-telemetry`、`product-analytics` 和 `ui-settings-session-log` 的条目或覆盖项。从启动环境中删除无用的 `DSH_TELEMETRY_*` 和 `DSH_PRODUCT_ANALYTICS_*` 变量。
2. 删除插件对已移除的遥测包和请求扩展包的引用。将 `SessionInput.submit(mode, source)` 和 `ComposerKeyboard.submit(mode, source)` 调用改为只传入 `mode`。删除 `SidebarRootInjected.trackEntryClick` 回调及 `feedback/committed` 监听器。
3. 运行 `dsh --profile web --dump-config`，确认 profile 可在没有这些条目的情况下完成组合。打开已有会话或记录本地反馈，验证会话仍可访问。
