---
description: "Resolve the DeepSeek API key for the deployment that receives a request."
kind: "package-reference"
---

# @deepseek-ai/dsh-deepseek-auth

English | [中文](README.zh.md)

## Summary

`ctx.deepseekAuth` resolves a DeepSeek API key and returns request headers for its deployment. The model adapter and DeepSeek web providers use it. The service stores no keys.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount `@deepseek-ai/dsh-deepseek-auth` before a DeepSeek provider that injects `deepseekAuth`. The service has no configuration.

### Authorizing a request

A caller supplies the API-key credential kind and the destination. A destination can be a path under the deployment origin or an absolute URL at that origin. Callers must reject redirects on the resulting request so the headers stay at that origin.

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

The authorization includes the absolute `endpoint` and `headers`. The default header is `authorization` with a Bearer key. Set `apiKeyHeaders` to include `x-api-key` for APIs that expect the bare key in that header.

### Deployment and key

The caller's `connections['api-key']` takes precedence over a mounted model route's connection. With neither, the service looks up `DEEPSEEK_API_KEY` for `https://api.deepseek.com`. It uses the [credential service](../credentials/README.md) when mounted and the launch environment otherwise.

A missing key or a destination outside the deployment yields `undefined`. An invalid key or unresolved connection rejects with `DeepSeekAuthError`. Credential-store failures propagate. `candidates()` resolves deployment settings without reading the key. Call the candidate's `configured()` to check presence without validating the key or contacting the endpoint.

<a id="understand-the-implementation"></a>
## Understand the implementation

Providers call `connect('api-key', route, connection)` inside `ctx.effect()` to publish live deployment settings and an optional key reference. The effect's disposer removes the connection. The service validates the destination before looking up any key and normalizes the key before placing it in headers.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Credential service](../credentials/README.md) explains how the key reference resolves.
- [DeepSeek API provider](../../llm/llm-deepseek-api-key/README.md) describes model configuration.

-----

<a id="model-experience"></a>
## Model Experience

None, as the service supplies only HTTP authentication headers.

#### KV Cache effect

None. The service does not serialize model input.

## Known Limitations and Deferred Work

One model route can connect a deployment at a time. A provider that needs its own endpoint or key must supply them with its request.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
