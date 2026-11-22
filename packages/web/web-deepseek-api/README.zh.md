---
description: "DeepSeek Search 与 Fetch API 提供者、共享的鉴权与传输层、端点配置及标准化结果。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-deepseek-api

[English](README.md) | 中文

## 概述

插件注册 `deepseek-search-api` 和 `deepseek-fetch-api`。每次操作使用 DeepSeek API 密钥直接发送一次请求。Search 返回标题、URL、snippet、summary 与发布时间。Fetch 返回页面 Markdown。面向模型的工具由 `dsh-tool-web` 提供。[旧版 Messages 搜索](../web-search-deepseek/README.zh.md)仍是独立提供方。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与待办工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

将插件与 `dsh-web` 和解析密钥的 [`dsh-deepseek-auth`](../../credentials/deepseek-auth/README.zh.md) 一起挂载。内置配置挂载此插件，选择本地 HTTP 抓取，并采用按路由决定的[搜索优先规则](../web/README.zh.md#provider-selection)。在**插件 > 内置插件配置 > 网页搜索与获取**中，为**搜索**选择 **DeepSeek Search API**，或为**获取**选择 **DeepSeek Fetch API**。两项选择各自从下一次操作起生效。

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: deepseek-search-api
    fetchProvider: deepseek-fetch-api
- name: '@deepseek-ai/dsh-deepseek-auth'
- name: '@deepseek-ai/dsh-web-deepseek-api'
  config:
    searchBaseURL: https://search.example.test/api/v1/tools
    searchApiKeyEnv: DEEPSEEK_SEARCH_API_KEY
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `count` | `10` | Search API 每次搜索的结果数，为 1 至 50 的整数；请求中更小的 `maxResults` 优先 |
| `searchRequestsPerSecond` | `5` | 本插件实例在任意一秒窗口内最多发送的 Search 请求数，与服务的账号级 5 QPS 限制一致；后续搜索排队等待，等待时间计入调用方的超时 |
| `sendOriginalQuestion` | `true` | 将触发搜索的用户提示截取至 128 个字符，作为 Search API 的 `ori_question` 发送 |
| `searchBaseURL` | 省略 | Search API 基础地址，包含路径前缀；追加 `/search`。只设置此项时，`searchApiKeyEnv` 默认为 `DEEPSEEK_API_KEY`（[鉴权](#authentication)） |
| `searchApiKeyEnv` | 省略 | Search 凭据引用。只设置此项时，`searchBaseURL` 默认为 `https://api.deepseek.com/v1/tools` |
| `fetchBaseURL` | 省略 | Fetch API 基础地址，包含路径前缀；追加 `/fetch`，默认值规则相同 |
| `fetchApiKeyEnv` | 省略 | Fetch 凭据引用，默认值规则相同 |

没有单独设置基础地址或密钥引用时，能力使用 DeepSeek API 密钥模型提供方的 origin，并追加 `/v1/tools/search` 或 `/v1/tools/fetch`。`dsh` 启动器从启动环境或 `$DSH_HOME/.env` 读取模型提供方的 `DEEPSEEK_BASE_URL`（[app-boot](../../boot/app-boot/README.zh.md)）。如需为能力单独配置基础地址，在 YAML 中填写完整的 API 基础地址，包含 `/api/v1/tools` 等路径前缀，末尾省略操作名。空字段视为未设置。

真实 API 测试要求同时设置 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_SEARCH_API_TEST_BASE_URL`，后者包含 API 路径前缀。

<a id="authentication"></a>
### 鉴权

Search 与 Fetch 每次操作各自从同一份设置快照解析端点和 API 密钥。保存设置或轮换密钥后，下一次操作便会采用新值。

- **单独配置。** 设置了非空 `*BaseURL` 或 `*ApiKeyEnv` 时，以 `Authorization: Bearer` 将引用的密钥发往配置的端点。另一个字段未设置时，默认使用 `DEEPSEEK_API_KEY` 或 `https://api.deepseek.com/v1/tools`。密钥缺失时，诊断信息点名其引用和 `*ApiKeyEnv` 字段。
- **模型提供方设置。** 已挂载 `deepseek-official` 模型提供方时，没有单独设置的能力使用该提供方的 `apiKeyEnv` 和基础地址的 origin。该提供方未挂载时，使用 `DEEPSEEK_API_KEY` 和 `https://api.deepseek.com/v1/tools`。已挂载的提供方设置无法解析时，依赖它的操作均在读取密钥前失败。

密钥缺失时，诊断信息点名其引用和配置位置。

`ctx.deepseekAuth` 读取每一把密钥——API 密钥路由的密钥、没有该路由时的 `DEEPSEEK_API_KEY` 和单独配置的 `*ApiKeyEnv`——都通过 [`dsh-credentials`](../../credentials/credentials/README.zh.md) 的凭据引用函数：`ctx.credentials` 具有权威性，仅在该服务缺席时读取启动环境。每把密钥均接受与模型请求相同的首尾空白规范化和格式校验；格式错误在发送请求前失败。

每个提供方的 `ready()` 检查适用的密钥是否已配置。读取凭据存储失败或模型提供方设置无效时，回答 false。选中这些提供方时，如果就绪判断回答 false，[`dsh-tool-web`](../tool-web/README.zh.md#search-readiness) 会撤下相应的工具及提示词指引。就绪判断只检查是否存在，因此错误的密钥也算就绪，发送后才会失败。

### 结果与失败

Search API 接收 `query`、`count`（配置的结果数，或请求中更小的 `maxResults`）、`need_content: false`，以及在 `sendOriginalQuestion` 未关闭时的 `ori_question`：发起会话中最近一条用户提示的文本，空白折叠后截取至 128 个字符。在会话之外或没有此类提示的搜索不发送该字段。提供者将 `results[].snippet` 映射为展示用摘录，将 `results[].summary` 映射为面向模型的摘录，并将可为 null 的 `date` 映射为可选的 `publishedAt`；`dsh-tool-web` 限制每条摘要的长度。空结果数组表示成功。Fetch 发送 `url`，以文本正文返回原始 Markdown，并报告 HTTP 状态 200，因为目标没有可用内容时 API 会返回错误状态。返回 URL 为请求 URL：API 不报告重定向后的最终 URL。

单独配置的基础地址无法解析或内嵌凭据时，该能力的提供方不可用。`count` 不在 1 至 50 之间时，Search 不可用。密钥缺失使用 `WEB_PROVIDER_CREDENTIAL_MISSING`。模型提供方的设置无法解析时使用 `WEB_PROVIDER_MISCONFIGURED`，并指出解析失败的原因、模型页面及该能力的设置。取消使用 `WEB_ABORTED`。传输、HTTP 和响应格式错误使用 `WEB_PROVIDER_ERROR`。重定向在联系目标前即被拒绝。Fetch API 失败表示抓取失败。发送错误指出使用的端点及其设置来源。每次操作只发送一条请求。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[插件](src/index.ts) 在每次操作时读取一次设置，并向 [`ctx.deepseekAuth`](../../credentials/deepseek-auth/README.zh.md) 获取绑定到所选端点的密钥。[Search 提供方](src/search.ts) 在返回服务结果前校验响应 JSON。[Fetch 提供方](src/fetch.ts) 校验 Markdown 正文。[传输层](src/transport.ts) 解析密钥，并负责取消、重定向拒绝和失败指引。[Messages 搜索提供方](../web-search-deepseek/README.zh.md) 保有自身的 `web/deepseek-search-llm-request` 会话事件。Search 与 Fetch API 工具调用和结果按常规记录到会话。

服务类型见 [Web 子系统](../../../docs/subsystems/web.zh.md)，受限的模型输出见 [tool-web](../tool-web/README.zh.md)。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 会话工具结果

#### 模型看到什么

`web_search` 和 `web_fetch` 工具在外部内容提示下呈现搜索来源或 Markdown。Fetch 结果包含请求 URL 和 HTTP 200。错误包含凭据或端点指引。Search 将查询连同触发问题直接发送给 Search API。

#### Token 影响

不消耗辅助模型 token。会话结果 token 随返回的 summary、snippet 或 Markdown 增长，并受消费方限制。API 抓取计费独立于模型 token。

#### KV Cache 影响

工具结果追加在已有会话前缀之后。提供者注册不增加模型上下文。

### 会话工具列表（间接）

#### 模型看到什么

这两个提供者被选中时，其中一个未就绪的会话请求既不包含对应工具（`web_search` 或 `web_fetch`）的 schema，也不包含该工具的提示词指引；该效果由 [`dsh-tool-web`](../tool-web/README.zh.md#search-readiness) 负责。

#### Token 影响

撤下时，请求中不再包含该工具的 schema 及其提示词指引。

#### KV Cache 影响

重新提供或移除 Web 工具会按 [`dsh-tool-web`](../tool-web/README.zh.md#search-readiness) 所述改变声明的工具。

## 已知限制与待办工作

<a id="known-limitations-and-deferred-work"></a>

- 共享搜索请求不暴露 `localization`；提供者不请求搜索全文，也不消费 `site_name`、`site_icon`、`rerank_score` 或 `authority`。2026-10-16 实测返回的 `summary` 长度为 1,000–2,300 个字符，超过消费方的默认上限。
- 2026-10-16 的探测中，不同的 `ori_question` 未改变结果顺序、评分或摘要；由于指南将其列为意图信号，提供者仍会发送。
- 查询和 URL 约束由远端服务执行。2026-10-16 抓取无法解析的目标域名时返回 HTTP 500，而非文档所述的 404，其失败信息与端点失败附带相同的端点指引。Fetch 既不暴露目标状态，也不暴露最终重定向 URL，因此结果报告 HTTP 200 和请求 URL；提供者丢弃 API 返回的页面标题。
- `available()` 无法查询异步凭据存储；`ready()` 可以，因此凭据存储缺少密钥时，模型步骤会撤下这两个工具。直接调用 `ctx.web.search()` 或 `ctx.web.fetch()` 仍可能因凭据缺失失败。
- Search 限速只约束单个插件实例内的发送时间。同一账号下的其他进程和客户端共享账号级 5 QPS 限制，彼此不协调，网络抖动也可能使请求集中到达；HTTP 429 会使该次搜索失败，随后 `dsh-tool-web` 会使整个多查询调用失败。Fetch 不限速，因此并行的 `web_fetch` 调用可能超过 Fetch 限制。
- 默认端点和密钥引用来自 `llm-deepseek-api-key` 在 `ctx.deepseekAuth` 注册的部署。其他适配器以相同提供方 ID 注册却未连接部署时，Search 与 Fetch 使用官方端点及 `DEEPSEEK_API_KEY`。

<a id="dev-note"></a>
### 开发备注

无。
