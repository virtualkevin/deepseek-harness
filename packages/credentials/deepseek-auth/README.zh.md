---
description: "为接收请求的部署解析 DeepSeek API 密钥。"
kind: "package-reference"
---

# @deepseek-ai/dsh-deepseek-auth

[English](README.md) | 中文

## 概述

`ctx.deepseekAuth` 解析 DeepSeek API 密钥并返回发往其部署的请求头。模型适配器和 DeepSeek Web 提供方使用此服务。该服务不存储密钥。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在注入 `deepseekAuth` 的 DeepSeek 提供方之前挂载 `@deepseek-ai/dsh-deepseek-auth`。该服务无需配置。

### 请求鉴权

调用方指定 API 密钥凭据类型和请求目的地。目的地可以是相对于部署 origin 的路径，也可以是属于该 origin 的绝对 URL。调用方必须拒绝重定向，避免将请求头发往其他 origin。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-deepseek-auth'

declare const ctx: Context
declare const signal: AbortSignal

const authorization = await ctx.deepseekAuth.authorize({
  consumer: 'my-plugin',
  accepts: ['api-key'],
  destination: { path: '/v1/tools/search' },
}, signal)
if (authorization === undefined) throw new Error('Missing DeepSeek API key')
await fetch(authorization.endpoint, { method: 'POST', headers: authorization.headers, redirect: 'error', signal })
```

鉴权结果包含绝对地址 `endpoint` 和请求头 `headers`。默认以 Bearer 格式发送 `authorization`。如果 API 要求在 `x-api-key` 头内发送原始密钥，在 `apiKeyHeaders` 中包含该请求头。

### 部署与密钥

调用方的 `connections['api-key']` 优先于已挂载模型路由的连接。如果两者均未提供，服务为 `https://api.deepseek.com` 查找 `DEEPSEEK_API_KEY`。挂载了[凭据服务](../credentials/README.zh.md)时从该服务读取，否则使用启动环境。

缺少密钥或目的地不属于部署时，返回 `undefined`。密钥无效或连接无法解析时，以 `DeepSeekAuthError` 失败。凭据存储的错误直接传递。`candidates()` 仅解析部署设置。候选项的 `configured()` 检查凭据是否已配置，无需验证密钥或访问端点。

<a id="understand-the-implementation"></a>
## 了解实现

提供方在 `ctx.effect()` 内调用 `connect('api-key', route, connection)`，发布实时部署设置与可选密钥引用。撤销该 effect 时移除连接。服务先验证目的地再查找密钥，并在设置请求头之前规范化密钥。

-----

<a id="further-exploration"></a>
## 进一步阅读

- [凭据服务](../credentials/README.zh.md)说明密钥引用的解析规则。
- [DeepSeek API 提供方](../../llm/llm-deepseek-api-key/README.zh.md)说明模型配置。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该服务仅提供 HTTP 鉴权请求头。

#### KV Cache 影响

无。此服务不序列化模型输入。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

同一时间只能有一个模型路由登记部署。需要自定义端点或密钥的提供方必须在请求中传入配置。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景，点击展开</summary>

无。

</details>
