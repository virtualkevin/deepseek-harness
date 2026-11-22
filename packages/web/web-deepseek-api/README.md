---
description: "DeepSeek Search and Fetch API providers, their shared authentication and transport, endpoint configuration, and normalized results."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-deepseek-api

English | [中文](README.zh.md)

## Summary

The plugin registers `deepseek-search-api` and `deepseek-fetch-api`. Each operation makes one direct request using a DeepSeek API key. Search returns titles, URLs, snippets, summaries, and dates. Fetch returns page Markdown. The model-facing tools live in `dsh-tool-web`. [Legacy Messages search](../web-search-deepseek/README.md) remains a separate provider.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin alongside `dsh-web` and [`dsh-deepseek-auth`](../../credentials/deepseek-auth/README.md), which resolves its key. Shipped profiles mount it, select local HTTP fetch, and use the route-based [search preference](../web/README.md#provider-selection). In **Plugins > Built-in plugin settings > Web search and fetch**, choose **DeepSeek Search API** for **Search** or **DeepSeek Fetch API** for **Fetch**. Each selection applies independently from the next operation.

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

| Field | Default | Meaning |
|---|---|---|
| `count` | `10` | Search API results per search, an integer from 1 to 50; a smaller `maxResults` on the request wins |
| `searchRequestsPerSecond` | `5` | Most Search requests this plugin instance sends in any one-second window, matching the service's account-wide 5 QPS limit; later searches wait, and the wait counts against the caller's timeout |
| `sendOriginalQuestion` | `true` | Send the triggering human prompt, cut to 128 characters, as the Search API's `ori_question` |
| `searchBaseURL` | omitted | Search API base including its path prefix; `/search` is appended. Set alone, `searchApiKeyEnv` defaults to `DEEPSEEK_API_KEY` ([authentication](#authentication)) |
| `searchApiKeyEnv` | omitted | Search credential reference. Set alone, `searchBaseURL` defaults to `https://api.deepseek.com/v1/tools` |
| `fetchBaseURL` | omitted | Fetch API base including its path prefix; `/fetch` is appended, with the same defaults |
| `fetchApiKeyEnv` | omitted | Fetch credential reference, with the same defaults |

A capability without its own base URL or key reference uses the origin of the DeepSeek API-key model provider and appends `/v1/tools/search` or `/v1/tools/fetch`. The `dsh` launcher accepts `DEEPSEEK_BASE_URL` for the model provider from the launching environment or `$DSH_HOME/.env` ([app-boot](../../boot/app-boot/README.md)). For a capability-specific base URL, set the complete API base in YAML, including any path prefix such as `/api/v1/tools` and excluding the operation name. An empty field counts as unset.

Run the real API tests with `DEEPSEEK_API_KEY` and `DEEPSEEK_SEARCH_API_TEST_BASE_URL`; both are required, and the latter includes the API path prefix.

<a id="authentication"></a>
### Authentication

Search and Fetch each resolve their endpoint and API key from one settings snapshot per operation. A saved setting or a rotated key applies to the next operation.

- **Own settings.** Setting a non-empty `*BaseURL` or `*ApiKeyEnv` sends that reference’s key as `Authorization: Bearer` to the configured endpoint. When the other field is unset, the defaults are `DEEPSEEK_API_KEY` and `https://api.deepseek.com/v1/tools`. A missing key diagnostic names its reference and `*ApiKeyEnv` field.
- **Model provider settings.** When the `deepseek-official` model provider is mounted, a capability without its own settings uses that provider’s `apiKeyEnv` and base origin. When the provider is absent, it uses `DEEPSEEK_API_KEY` and `https://api.deepseek.com/v1/tools`. A mounted provider whose settings fail to resolve stops any operation that relies on it before a key is read.

A missing key diagnostic names its reference and where to configure it.

`ctx.deepseekAuth` reads every key, the API-key route's, `DEEPSEEK_API_KEY` without that route, and the own `*ApiKeyEnv`, through the credential reference helpers of [`dsh-credentials`](../../credentials/credentials/README.md): `ctx.credentials` is authoritative, with launch-environment lookup only when that service is absent. Every key receives the same whitespace normalization and format validation as model requests; malformed keys fail before dispatch.

Each provider’s `ready()` checks whether its applicable key is configured. A failed credential-store read or invalid model-provider settings answer false. While these providers are selected, [`dsh-tool-web`](../tool-web/README.md#search-readiness) withholds the corresponding tools and prompt guidance when readiness answers false. Readiness checks presence, so a wrong key counts as ready and fails when sent.

### Results and failures

The Search API receives `query`, `count` (the configured count, or the request's smaller `maxResults`), `need_content: false`, and, unless `sendOriginalQuestion` is off, `ori_question`: the text of the initiating Session's latest human prompt with whitespace collapsed and cut to 128 characters. A search outside a Session or without such a prompt omits it. The provider maps `results[].snippet` as the display excerpt and `results[].summary` as the model-facing excerpt, and maps nullable `date` to optional `publishedAt`; `dsh-tool-web` caps each summary. An empty results array is successful. Fetch sends `url` and returns the original Markdown as a text body with HTTP status 200, because the API answers with an error status when the target yields no usable content. Its URL is the requested URL: the API reports no final redirected URL.

A capability’s own base URL makes the provider unavailable if the URL fails to parse or embeds credentials. A `count` outside 1 to 50 makes Search unavailable. A missing key uses `WEB_PROVIDER_CREDENTIAL_MISSING`. Unresolved model provider settings use `WEB_PROVIDER_MISCONFIGURED` and name the resolver failure, Models page, and capability settings. Cancellation uses `WEB_ABORTED`. Transport, HTTP, and malformed response failures use `WEB_PROVIDER_ERROR`. Redirects fail before reaching their target. Fetch API failures report retrieval failures. Dispatch errors identify the endpoint and settings that produced it. The providers send one request per operation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [plugin](src/index.ts) reads settings once per operation and asks [`ctx.deepseekAuth`](../../credentials/deepseek-auth/README.md) for a key bound to the selected endpoint. The [Search provider](src/search.ts) validates response JSON before returning service results. The [Fetch provider](src/fetch.ts) validates the Markdown body. The [transport](src/transport.ts) resolves the key and owns cancellation, redirect rejection, and failure guidance. The [Messages search provider](../web-search-deepseek/README.md) owns its `web/deepseek-search-llm-request` Session event. Search and Fetch API tool calls and results use regular Session logging.

See the [web subsystem](../../../docs/subsystems/web.md) for service types and [tool-web](../tool-web/README.md) for bounded model output.

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Conversation tool results

#### What the model sees

The `web_search` and `web_fetch` tools render sources or Markdown with an external-content notice. Fetch results carry the requested URL and HTTP 200. Errors include credentials or endpoint guidance. Search sends the query and triggering question directly to the Search API.

#### Token effect

No auxiliary model tokens are consumed. Conversation result tokens scale with returned summaries, snippets, or Markdown and are bounded by the consumer. API retrieval billing is independent of model tokens.

#### KV Cache effect

Tool results append after the existing conversation prefix. Provider registration adds no model context.

### Conversation tool list, indirectly

#### What the model sees

While these providers are selected, a conversation request for which one is not ready carries neither its tool's schema, `web_search` or `web_fetch`, nor that tool's prompt guidance; [`dsh-tool-web`](../tool-web/README.md#search-readiness) owns that effect.

#### Token effect

Withholding removes the tool's schema and its prompt guidance from the request.

#### KV Cache effect

A returning or removed web tool changes the declared tools as [`dsh-tool-web`](../tool-web/README.md#search-readiness) describes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The shared search request does not expose `localization`; the provider does not request full search content or consume `site_name`, `site_icon`, `rerank_score`, or `authority`. Returned summaries measured 1,000–2,300 characters on 2026-10-16, above the consumer's default cap.
- In 2026-10-16 probes, different `ori_question` values left result order, scores, and summaries unchanged; the provider still sends it because the guide documents it as an intent signal.
- API query and URL constraints are enforced by the remote service. An unresolvable Fetch target returned HTTP 500 rather than the documented 404 on 2026-10-16, and its failure carries the same endpoint guidance as an endpoint failure. Fetch exposes neither the target status nor the final redirect URL, so results report HTTP 200 and the requested URL; the provider discards the API's page title.
- `available()` cannot query asynchronous credential stores; `ready()` does, so model steps withhold the tools when the store lacks the key. A direct `ctx.web.search()` or `ctx.web.fetch()` call can still fail with a missing-credential error.
- Search pacing limits send times within one plugin instance. Other processes and clients on the same account share the account-wide 5 QPS limit without coordination, and network jitter can still bunch arrivals; an HTTP 429 fails that search, and `dsh-tool-web` then fails the whole multi-query call. Fetch is not paced, so parallel `web_fetch` calls can exceed the Fetch limit.
- The default endpoint and key reference come from the deployment that `llm-deepseek-api-key` registers with `ctx.deepseekAuth`. Adapters that register the same provider ID without connecting a deployment use the official endpoint and `DEEPSEEK_API_KEY` for Search and Fetch.

<a id="dev-note"></a>
### Dev Note

None.
