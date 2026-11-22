/**
 * DeepSeek request authentication. Bind an API key to its deployment and resolve it into request headers.
 * @module @deepseek-ai/dsh-deepseek-auth
 */
import { Context, Service } from '@deepseek-ai/cordis'
import { credentialRef, credentialRefConfigured, normalizeApiKey, resolveCredentialRef } from '@deepseek-ai/dsh-credentials'
import type { ApiKeyRejection } from '@deepseek-ai/dsh-credentials'
import { HarnessError } from '@deepseek-ai/dsh-error'
import type {
  DeepSeekAuthCandidate, DeepSeekAuthConnection, DeepSeekAuthKind, DeepSeekAuthRequest, DeepSeekAuthUnresolved,
  DeepSeekAuthorization,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { deepseekAuth: DeepSeekAuth }
}

/** Base URL of the official DeepSeek API, where `DEEPSEEK_API_KEY` is sent without a connected API-key route. */
const OFFICIAL_BASE_URL = 'https://api.deepseek.com'

/** Credential reference of the official DeepSeek API key. */
const DEEPSEEK_API_KEY = credentialRef('DEEPSEEK_API_KEY')

/** Failure codes of {@link DeepSeekAuthError}. */
export type DeepSeekAuthErrorCode =
  /** A second model route attempted to connect an API-key deployment. */
  | 'DUPLICATE_CONNECTION'
  /** The configured API key is blank or cannot travel in an HTTP header. */
  | 'INVALID_CREDENTIAL'
  /** The connection does not resolve. */
  | 'UNRESOLVED_CONNECTION'

/** A DeepSeek authentication failure; `message` never contains a credential. */
export class DeepSeekAuthError extends HarnessError {
  declare readonly code: DeepSeekAuthErrorCode

  /**
   * @param message - what failed and what to change.
   * @param code - the failure class.
   * @param options - the underlying failure.
   */
  constructor(message: string, code: DeepSeekAuthErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    // Consumers quote this name in their own diagnostics, so it does not follow a bundler's class renaming.
    this.name = 'DeepSeekAuthError'
  }
}

/**
 * The diagnostic for a configured API key that cannot be sent. The key never enters the text: `reference` names where to
 * fix it. The Models page is named as the writer it usually is, not as the only one, because the same value can arrive
 * from a hand-edited `.env` or a shell export in a composition that mounts no credentials service.
 * @param reason - why the key cannot be sent.
 * @param owner - settings namespace or plugin name prefixed to the text.
 * @param reference - the credential reference the key was read under.
 * @returns the message of the `INVALID_CREDENTIAL` failure.
 */
function unusableKey(reason: ApiKeyRejection, owner: string, reference: string): string {
  const defect: Record<ApiKeyRejection, string> = {
    empty: `is blank; set ${reference} to the raw key (the web Models page writes it) or export it in the launching`
      + ' environment',
    illegalCharacters: `contains characters no HTTP header can carry; set ${reference} to the raw key alone (the web Models`
      + ' page writes it)',
  }
  return `${owner}: the API key resolved from ${reference} ${defect[reason]}`
}

/** `ctx.deepseekAuth`: resolves the DeepSeek API key for a request. */
export class DeepSeekAuth extends Service {
  private connected: { route: string; connection: () => DeepSeekAuthConnection } | undefined

  /** @param ctx - Host context, which may provide a credentials service. */
  constructor(ctx: Context) {
    super(ctx, 'deepseekAuth')
  }

  /**
   * Connect the API-key deployment a model route's settings name. Call it from within `ctx.effect()`.
   * @param kind - the kind the plugin's route bills.
   * @param route - provider route the plugin registers; {@link routeKind} answers `kind` for it while connected.
   * @param connection - reads the plugin's current settings; a throw marks the kind unresolved for that operation.
   * @returns the disposer removing the connection.
   * @throws {DeepSeekAuthError} code `DUPLICATE_CONNECTION` when the kind is already connected.
   */
  connect(kind: DeepSeekAuthKind, route: string, connection: () => DeepSeekAuthConnection): () => void {
    if (this.connected !== undefined) {
      throw new DeepSeekAuthError(`deepseek-auth: the ${kind} deployment is already connected`, 'DUPLICATE_CONNECTION')
    }
    this.connected = { route, connection }
    return () => { this.connected = undefined }
  }

  /**
   * The kind that bills a conversation on one model route.
   * @param route - provider route of a model request; undefined names none.
   * @returns the kind connected under that route, or undefined for a route no plugin connected.
   */
  routeKind(route: string | undefined): DeepSeekAuthKind | undefined {
    return this.connected !== undefined && this.connected.route === route ? 'api-key' : undefined
  }

  /**
   * Resolve the connection and destination without reading the API key.
   * @param request - the request.
   * @returns one candidate or connection failure, or an empty array when the destination cannot receive the key.
   */
  candidates(request: DeepSeekAuthRequest): (DeepSeekAuthCandidate | DeepSeekAuthUnresolved)[] {
    if (!request.accepts.includes('api-key')
      || (request.billing !== undefined && request.billing !== 'api-key' && request.billing !== 'auto')) return []
    return this.candidate(request)
  }

  /**
   * Release the API key bound to the request's destination.
   * @param request - the request.
   * @param signal - cancellation for the lookups.
   * @returns the authorization, or undefined when the destination cannot receive the key or no key is available.
   * @throws {DeepSeekAuthError} code `UNRESOLVED_CONNECTION` for an unresolved connection, `INVALID_CREDENTIAL` for an
   *   unusable API key; store failures propagate.
   */
  async authorize(request: DeepSeekAuthRequest, signal?: AbortSignal): Promise<DeepSeekAuthorization | undefined> {
    const [candidate] = this.candidates(request)
    if (candidate === undefined) return undefined
    if ('unresolved' in candidate) {
      throw new DeepSeekAuthError(
        `deepseek-auth: the ${candidate.kind} ${candidate.unresolved} does not resolve: ${String(candidate.error)}`,
        'UNRESOLVED_CONNECTION', { cause: candidate.error },
      )
    }
    return candidate.resolve(signal)
  }

  /** Bind the API key to the requested destination, when it lies within the deployment origin. */
  private candidate(request: DeepSeekAuthRequest): (DeepSeekAuthCandidate | DeepSeekAuthUnresolved)[] {
    let connection: DeepSeekAuthConnection
    const kind = 'api-key'
    try { connection = request.connections?.[kind] ?? this.connected?.connection() ?? { baseURL: OFFICIAL_BASE_URL } }
    catch (error: unknown) { return [{ kind, unresolved: 'connection', error }] }
    let endpoint: string
    try {
      const deployment = new URL(connection.baseURL)
      if (!['http:', 'https:'].includes(deployment.protocol) || deployment.username !== '' || deployment.password !== '') return []
      const destination = 'path' in request.destination
        ? new URL(request.destination.path, deployment.origin)
        : new URL(request.destination.url)
      if (destination.origin !== deployment.origin || destination.username !== '' || destination.password !== '') return []
      endpoint = 'url' in request.destination ? request.destination.url : destination.href
    } catch (error: unknown) { return [{ kind, unresolved: 'connection', error }] }
    return [this.apiKey(connection, endpoint, request)]
  }

  /** The API key read under the connection's reference, sent in the headers the request names. */
  private apiKey(connection: DeepSeekAuthConnection, endpoint: string, request: DeepSeekAuthRequest): DeepSeekAuthCandidate {
    const { ctx } = this
    const reference = connection.reference ?? DEEPSEEK_API_KEY
    const owner = connection.owner ?? request.consumer
    return {
      kind: 'api-key', endpoint, reference,
      configured: () => credentialRefConfigured(ctx, reference),
      resolve: async (signal) => {
        signal?.throwIfAborted()
        const raw = await resolveCredentialRef(ctx, reference)
        if (raw === undefined) return undefined
        const checked = normalizeApiKey(raw)
        if (!checked.ok) throw new DeepSeekAuthError(unusableKey(checked.reason, owner, reference), 'INVALID_CREDENTIAL')
        const headers: Record<string, string> = {}
        for (const header of request.apiKeyHeaders ?? ['authorization']) {
          headers[header] = header === 'authorization' ? `Bearer ${checked.value}` : checked.value
        }
        return { kind: 'api-key', endpoint, reference, headers }
      },
    }
  }
}

export default DeepSeekAuth
