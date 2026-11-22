/**
 * Register the DeepSeek Search and Fetch APIs as `deepseek-search-api` and `deepseek-fetch-api`.
 * Each operation uses the API key and origin of the mounted DeepSeek API-key model route, or
 * `DEEPSEEK_API_KEY` and the official endpoint when that route is absent. Setting a capability's
 * `*BaseURL` or `*ApiKeyEnv` gives that capability its own endpoint and key. A provider is ready
 * when its next operation has a configured key.
 * @module @deepseek-ai/dsh-web-deepseek-api
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { DeepSeekAuthCandidate, DeepSeekAuthUnresolved } from '@deepseek-ai/dsh-deepseek-auth'
import { extractTextContent } from '@deepseek-ai/dsh-llm/message'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import { DeepSeekFetchApiProvider } from './fetch.ts'
import {
  DEEPSEEK_DEFAULT_COUNT, DEEPSEEK_SEARCH_REQUESTS_PER_SECOND, DEEPSEEK_WEB_API_BASE_URL, DeepSeekSearchApiProvider,
} from './search.ts'
import {
  isDeepSeekWebAuthReady, type DeepSeekWebAuth, type DeepSeekWebAuthSource, type DeepSeekWebGuidance,
} from './transport.ts'

export { DEEPSEEK_FETCH_API_PROVIDER_ID, DeepSeekFetchApiProvider } from './fetch.ts'
export type { DeepSeekFetchApiOptions } from './fetch.ts'
export {
  DEEPSEEK_DEFAULT_COUNT, DEEPSEEK_SEARCH_API_PROVIDER_ID, DEEPSEEK_SEARCH_REQUESTS_PER_SECOND, DEEPSEEK_WEB_API_BASE_URL,
  DeepSeekSearchApiProvider, mapSearchResponse,
} from './search.ts'
export type { DeepSeekSearchApiOptions } from './search.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-deepseek-api'

/** The web seam both providers register into, and the DeepSeek authentication their operations ask for credentials. */
export const inject = ['web', 'deepseekAuth']

/**
 * Settings read by the next search or fetch without re-registering either provider. A non-empty `*BaseURL` or
 * `*ApiKeyEnv` gives that capability its own endpoint and key. Otherwise it uses the DeepSeek API-key model route.
 */
export interface Config {
  /** Search API results per search, from 1 through 50; a smaller request bound wins. Defaults to 10. */
  count: Volatile<number>
  /**
   * Most Search requests this plugin instance sends in any one-second window; later searches wait,
   * and the wait counts against the caller's timeout. Other processes and clients that share the
   * upstream rate limit are not coordinated. Defaults to 5.
   */
  searchRequestsPerSecond: Volatile<number>
  /** Send the triggering user question, bounded to 128 characters, as `ori_question`. Defaults to true. */
  sendOriginalQuestion: Volatile<boolean>
  /**
   * Own Search API base including its path prefix; `/search` is appended. With only {@link searchApiKeyEnv} set, the
   * official base applies.
   */
  searchBaseURL: Volatile<string | undefined>
  /** Own Search API credential reference. With only {@link searchBaseURL} set, `DEEPSEEK_API_KEY` applies. */
  searchApiKeyEnv: Volatile<string | undefined>
  /**
   * Own Fetch API base including its path prefix; `/fetch` is appended. With only {@link fetchApiKeyEnv} set, the
   * official base applies.
   */
  fetchBaseURL: Volatile<string | undefined>
  /** Own Fetch API credential reference. With only {@link fetchBaseURL} set, `DEEPSEEK_API_KEY` applies. */
  fetchApiKeyEnv: Volatile<string | undefined>
}

export const Config = z.object({
  count: z.number().step(1).min(1).max(50).default(DEEPSEEK_DEFAULT_COUNT).volatile(),
  searchRequestsPerSecond: z.number().step(1).min(1).default(DEEPSEEK_SEARCH_REQUESTS_PER_SECOND).volatile(),
  sendOriginalQuestion: z.boolean().default(true).volatile(),
  searchBaseURL: z.string().volatile(),
  searchApiKeyEnv: z.string().role('credential-ref').volatile(),
  fetchBaseURL: z.string().volatile(),
  fetchApiKeyEnv: z.string().role('credential-ref').volatile(),
})

/** A capability that resolves its endpoint and credential independently of the other. */
type Capability = 'search' | 'fetch'

/** Path prefix of the Search and Fetch APIs under a DeepSeek origin. */
const TOOLS_PATH = '/v1/tools'

/** Credential reference of the official DeepSeek API key. */
const DEEPSEEK_API_KEY = credentialRef('DEEPSEEK_API_KEY')

/** Display names, configuration prefix, and operation path of each capability. */
const CAPABILITY = {
  search: { subject: 'Search', prefix: 'search', path: '/search' },
  fetch: { subject: 'Fetch', prefix: 'fetch', path: '/fetch' },
} as const satisfies Record<Capability, { subject: DeepSeekWebGuidance['subject']; prefix: string; path: '/search' | '/fetch' }>

/**
 * Read the text of the latest human prompt, the question that triggered the
 * current turn. Injected user-role context carries another source kind.
 * @param session - the initiating Session, when the search runs inside one.
 * @returns the prompt's joined text blocks, or undefined without a prompt.
 */
function latestUserQuestion(session: Session | undefined): string | undefined {
  const prompt = session?.deriveMessages().findLast(message => message.role === 'user' && message.source.kind === 'user')
  if (prompt === undefined) return undefined
  return extractTextContent(prompt.content, { separator: '\n' })
}

/**
 * Register the Search API and Fetch API providers over one live settings section. Readiness and dispatch
 * resolve the key from the current settings.
 * @param ctx - plugin context owning both registrations.
 * @param config - live settings, read once per operation.
 */
export function apply(ctx: Context, config: Config): void {
  const target = (capability: Capability) => resolveTarget(ctx, capability, capability === 'search'
    ? { baseURL: config.searchBaseURL.get(), ref: config.searchApiKeyEnv.get() }
    : { baseURL: config.fetchBaseURL.get(), ref: config.fetchApiKeyEnv.get() })
  const searchApi = new DeepSeekSearchApiProvider(() => ({
    ...target('search'),
    count: config.count.get(),
    requestsPerSecond: config.searchRequestsPerSecond.get(),
    ...config.sendOriginalQuestion.get() ? {
      originalQuestion: () => latestUserQuestion(ctx.get('agents')?.currentInitiator()?.session),
    } : {},
  }))
  const fetchApi = new DeepSeekFetchApiProvider(() => target('fetch'))
  ctx.web.registerSearchProvider({
    id: searchApi.id,
    description: searchApi.description,
    available: () => searchApi.available(),
    ready: () => isDeepSeekWebAuthReady(target('search').auth),
    search: (request, signal) => searchApi.search(request, signal),
  })
  ctx.web.registerFetchProvider({
    id: fetchApi.id,
    description: fetchApi.description,
    available: () => fetchApi.available(),
    ready: () => isDeepSeekWebAuthReady(target('fetch').auth),
    fetch: (request, signal) => fetchApi.fetch(request, signal),
  })
}

/**
 * Bind the capability's key to its destination without reading the credential.
 * @param ctx - context with the DeepSeek authentication service.
 * @param capability - the capability being resolved.
 * @param own - capability-specific base URL and credential reference, with empty values treated as unset.
 * @returns the authentication sources and the settings endpoint failures name.
 */
function resolveTarget(
  ctx: Context, capability: Capability,
  own: { baseURL: string | undefined; ref: string | undefined },
): { auth: DeepSeekWebAuth; guidance: DeepSeekWebGuidance } {
  const { subject, prefix, path } = CAPABILITY[capability]
  const guidance = (custom: boolean): DeepSeekWebGuidance =>
    ({ subject, plugin: name, custom, baseURLField: `${prefix}BaseURL`, apiKeyEnvField: `${prefix}ApiKeyEnv` })
  const ownBaseURL = nonEmpty(own.baseURL), ownRef = nonEmpty(own.ref)
  if (ownBaseURL !== undefined || ownRef !== undefined) {
    const reference = ownRef === undefined ? DEEPSEEK_API_KEY : credentialRef(ownRef)
    const baseURL = ownBaseURL ?? DEEPSEEK_WEB_API_BASE_URL
    const json = JSON.stringify(reference)
    // A base URL that does not parse, or that embeds credentials, leaves no source, so the provider is unavailable.
    const sources = ctx.deepseekAuth.candidates({
      consumer: name, accepts: ['api-key'], billing: 'api-key',
      destination: { url: `${baseURL.replace(/\/+$/u, '')}${path}` }, connections: { 'api-key': { baseURL, reference } },
    }).filter(isCandidate)
    return { guidance: guidance(true), auth: {
      sources,
      missingCredentialMessage: `DeepSeek ${subject} API sends the API key under ${json} to its own endpoint, and no key is`
        + ` configured for ${json}. Guide the user to export ${json} in the launching environment, or to correct`
        + ` ${name}.${prefix}ApiKeyEnv.`,
    } }
  }
  const candidates = ctx.deepseekAuth.candidates({
    consumer: name, accepts: ['api-key'], billing: 'api-key', destination: { path: `${TOOLS_PATH}${path}` },
  })
  const candidate = candidates.find(isCandidate)
  const reference = JSON.stringify(candidate?.reference ?? DEEPSEEK_API_KEY)
  return { guidance: guidance(false), auth: {
    sources: candidates.map(source => isCandidate(source) ? source : misconfigured(capability, source.error)),
    missingCredentialMessage: `DeepSeek ${subject} API uses the DeepSeek API key, and no key is configured for ${reference}. Guide the user`
      + ` to add the DeepSeek API key on the Models page or export ${reference} in the launching environment.`,
  } }
}

/** Whether `ctx.deepseekAuth` bound a credential kind to its endpoint, as opposed to a kind whose settings do not resolve. */
function isCandidate(candidate: DeepSeekAuthCandidate | DeepSeekAuthUnresolved): candidate is DeepSeekAuthCandidate {
  return !('unresolved' in candidate)
}

/** Describe the model provider settings that prevent operation dispatch. */
function misconfigured(capability: Capability, error: unknown): DeepSeekWebAuthSource {
  const { subject, prefix } = CAPABILITY[capability]
  return { kind: 'misconfigured', message: `DeepSeek ${subject} API sends the API key to the origin of the DeepSeek API-key model`
    + ` provider, and that provider's settings do not resolve: ${errorMessage(error)}. ${subject} did not send the request. Guide the`
    + ' user to correct that provider\'s settings on the Models page or in the deployment configuration, or to set'
    + ` ${name}.${prefix}BaseURL and ${name}.${prefix}ApiKeyEnv so ${subject} uses its own endpoint.` }
}

/** The message of a thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A string with content, or undefined for an absent or empty value. */
function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined
}
