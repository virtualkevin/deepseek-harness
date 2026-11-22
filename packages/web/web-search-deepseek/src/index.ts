/**
 * Register a DeepSeek-backed provider in `ctx.web`. It calls the Anthropic-compatible Messages API
 * with native `web_search_20250305`. It resolves its own API key and endpoint for each search.
 * @module @deepseek-ai/dsh-web-search-deepseek
 */
import type { Volatile } from '@deepseek-ai/cordis'

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { DeepSeekAuthRequest } from '@deepseek-ai/dsh-deepseek-auth'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import {
  DeepSeekSearchProvider,
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
} from './provider.ts'
import type { DeepSeekSearchProviderOptions } from './provider.ts'

export {
  DeepSeekSearchProvider,
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_PROVIDER_ID,
} from './provider.ts'
export type { DeepSeekSearchLlmRequest, DeepSeekSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-deepseek'

/** The web seam this provider registers into, and the DeepSeek authentication its searches ask for credentials. */
export const inject = ['web', 'deepseekAuth']

const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal DeepSeek API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey: Volatile<string | undefined>
  /** Credential reference resolved for each search; defaults to `DEEPSEEK_API_KEY`. */
  apiKeyEnv: Volatile<string>
  /** Anthropic-compatible endpoint base; `/messages` is appended. */
  baseURL: Volatile<string | undefined>
  /** Anthropic-format model name. Defaults to `deepseek-v4-flash`. */
  model: Volatile<string>
  /** `anthropic-version` header value. Defaults to `2023-06-01`. */
  apiVersion: Volatile<string>
  /** Upper bound on generated tokens for the Messages request. Defaults to 4096. */
  maxTokens: Volatile<number>
  /** Maximum `web_search` server-tool uses per request. Defaults to 5. */
  maxUses: Volatile<number>
}

export const Config = z.object({
  apiKey: z.string().role('secret').volatile(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry reads
  // there as no value at all.
  baseURL: z.string().volatile(),
  model: z.string().default(DEEPSEEK_DEFAULT_MODEL).volatile(),
  apiVersion: z.string().default(DEEPSEEK_DEFAULT_API_VERSION).volatile(),
  maxTokens: z.number().step(1).min(1).default(DEEPSEEK_DEFAULT_MAX_TOKENS).volatile(),
  maxUses: z.number().step(1).min(1).default(DEEPSEEK_DEFAULT_MAX_USES).volatile(),
})

/**
 * Auxiliary-search endpoint, independent of the conversation adapter's
 * `$DEEPSEEK_BASE_URL` and selected protocol.
 */
const SEARCH_BASE_URL_ENV = 'DEEPSEEK_SEARCH_BASE_URL'

/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export const WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE = 'web-search-deepseek'

/** Options for one search and the credential request readiness checks. */
type SearchOptions = DeepSeekSearchProviderOptions & {
  readonly authRequest?: DeepSeekAuthRequest
}

/**
 * Project one resolved section into the options the provider serves its next
 * search with. Environment fallbacks stay here rather than in the provider:
 * every value it reads is already fully defaulted.
 * @param ctx - plugin context supplying the DeepSeek authentication, the Agent registry, and the environment.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(
  ctx: Context, config: { [K in keyof Config]: ReturnType<Config[K]['get']> },
): SearchOptions {
  const reference = credentialRef(config.apiKeyEnv)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  const baseURL = config.baseURL
    ?? launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value
    ?? DEEPSEEK_DEFAULT_BASE_URL
  const authRequest: DeepSeekAuthRequest = {
    consumer: name,
    accepts: ['api-key'],
    billing: 'api-key',
    destination: { url: `${baseURL}/messages` },
    connections: { 'api-key': { baseURL, reference } },
    apiKeyHeaders: ['x-api-key', 'authorization'],
  }
  return {
    ...literalApiKey !== undefined
      ? { apiKey: literalApiKey }
      : { authRequest, authorize: (_endpoint, signal) => ctx.deepseekAuth.authorize(authRequest, signal) },
    apiKeyEnv: reference,
    baseURL,
    model: config.model,
    apiVersion: config.apiVersion,
    maxTokens: config.maxTokens,
    maxUses: config.maxUses,
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append(
        'web/deepseek-search-llm-request',
        request,
      )
    },
  }
}

/**
 * Check whether a key is configured without reading it or contacting the search endpoint.
 * @param ctx - plugin context supplying the DeepSeek authentication.
 * @param options - options the next search would use.
 * @returns whether the search has a literal or configured API key.
 */
async function searchConfigured(ctx: Context, options: SearchOptions): Promise<boolean> {
  if (options.authRequest === undefined) return options.apiKey !== undefined
  const [candidate] = ctx.deepseekAuth.candidates(options.authRequest)
  if (candidate === undefined || 'unresolved' in candidate) return false
  try { return await candidate.configured() }
  catch (_unreadableCredential) { return false /* The search cannot read its credential. */ }
}

/**
 * Register the DeepSeek search provider with `ctx.web`.
 * @param ctx - plugin context owning the registration.
 * @param config - live provider settings, read once per operation.
 */
export function apply(ctx: Context, config: Config): void {
  const options = () => resolveOptions(ctx, {
    apiKey: config.apiKey.get(), apiKeyEnv: config.apiKeyEnv.get(), baseURL: config.baseURL.get(), model: config.model.get(),
    apiVersion: config.apiVersion.get(), maxTokens: config.maxTokens.get(), maxUses: config.maxUses.get(),
  })
  const provider = new DeepSeekSearchProvider(options)
  ctx.web.registerSearchProvider({
    id: provider.id,
    description: provider.description,
    available: () => provider.available(),
    ready: () => searchConfigured(ctx, options()),
    search: (request, signal) => provider.search(request, signal),
  })
}
