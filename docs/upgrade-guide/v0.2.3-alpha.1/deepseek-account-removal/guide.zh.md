---
kind: upgrade-guide
description: "移除 DeepSeek 账号登录、账号模型路由及相关设置和 API。"
---

# 从 DeepSeek 账号登录迁移

[English](guide.md) | 中文

## 变更

Web 和桌面客户端通过配置 DeepSeek API Key 使用 DeepSeek 模型。本版本移除了 DeepSeek 账号登录、账号模型、通知、余额和计费界面，`account` RPC 命名空间，以及桌面端的 `dshPlatform` 和 `dshOnboarding` 账号桥接。DeepSeek 提供的网页搜索和获取功能使用 API Key。已有的会话历史仍可显示过去请求所用的模型。

## 迁移

1. 打开**设置 → 模型**并保存 DeepSeek API Key，或在启动 dsh 的环境中设置 `DEEPSEEK_API_KEY`。如果会话此前使用账号模型，请先从 **DeepSeek API** 中选择一个模型，再继续会话。
2. 在自定义配置补丁中，移除 `deepseek-account`、`llm-deepseek-account`、`ui-settings-account` 和 `ui-account-notifications` 条目或覆盖项。通过 `llm-deepseek-api-key` 配置 API Key 提供方。将提供方选择中的 `deepseek-account` 替换为 `deepseek-official`，并选择 API 列出的模型。
3. 从 `web-deepseek-api` 的覆盖项中移除 `searchBilling` 和 `fetchBilling`。仍可单独配置 `searchBaseURL`、`searchApiKeyEnv`、`fetchBaseURL` 和 `fetchApiKeyEnv`。如果此前使用 DeepSeek 账号路由进行翻译，请改用其他翻译提供方。
4. 移除对 `account` RPC 命名空间及登录专用 `session/initializeDefaultModel` 方法的调用。自定义 `DeepSeekAuthRequest` 调用应使用 API Key 鉴权，并移除账号路由和连接字段。按常规模型选择流程配置提供方并选择模型，然后发送一条请求验证。
