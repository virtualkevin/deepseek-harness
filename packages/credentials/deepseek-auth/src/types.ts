/**
 * Types of DeepSeek request authentication. Host-only: an authorization carries a secret, so none of these values
 * crosses a Remote boundary or enters a log.
 * @module @deepseek-ai/dsh-deepseek-auth/types
 */
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

/** Credential kind used for DeepSeek API requests. */
export type DeepSeekAuthKind = 'api-key'

/** API-key billing. Both values use the connected deployment when the request omits its own. */
export type DeepSeekAuthBilling = 'auto' | DeepSeekAuthKind

/** Request header an API key is sent in: `authorization` as `Bearer <key>`, `x-api-key` as the bare key. */
export type DeepSeekApiKeyHeader = 'authorization' | 'x-api-key'

/** The API-key deployment and the reference used to read the key. */
export interface DeepSeekAuthConnection {
  /** Base URL of the deployment; the credential is sent only to destinations under its origin. */
  readonly baseURL: string
  /** The credential reference the key is read under; `DEEPSEEK_API_KEY` when omitted. */
  readonly reference?: CredentialRef
  /**
   * The settings namespace or package name prefixed to the diagnostic of an unusable key; the
   * request's `consumer` when omitted.
   */
  readonly owner?: string
}

/**
 * A path relative to the deployment origin, or an absolute URL at that origin. The destination must not embed credentials.
 */
export type DeepSeekAuthDestination = { readonly path: string } | { readonly url: string }

/** One DeepSeek API request that needs authentication. */
export interface DeepSeekAuthRequest {
  /** Name of the requesting plugin, prefixed to the diagnostic of an unusable key whose connection names no owner. */
  readonly consumer: string
  /** Credential kinds the destination API accepts. Include `api-key` to authorize the request. */
  readonly accepts: readonly DeepSeekAuthKind[]
  /** API-key billing mode; `auto` when omitted. */
  readonly billing?: DeepSeekAuthBilling
  /** Where the request goes. */
  readonly destination: DeepSeekAuthDestination
  /**
   * The caller's own API-key connection, used in place of the connected or default one: the configuration
   * generation a model route captured for one request, or a consumer's own endpoint and key.
   */
  readonly connections?: Readonly<Partial<Record<DeepSeekAuthKind, DeepSeekAuthConnection>>>
  /** Headers an API key is sent in; `authorization` when omitted. */
  readonly apiKeyHeaders?: readonly DeepSeekApiKeyHeader[]
}

/** The API key formatted for one request. */
export interface DeepSeekAuthorization {
  /** Kind of the credential. */
  readonly kind: DeepSeekAuthKind
  /** Absolute URL the request is sent to. */
  readonly endpoint: string
  /** Request headers carrying the credential. */
  readonly headers: Readonly<Record<string, string>>
  /** The reference the key was read under, for diagnostics that tell the user where to configure it. */
  readonly reference?: CredentialRef
}

/** The API-key candidate for a request. Nothing is read until asked. */
export interface DeepSeekAuthCandidate {
  /** Kind of the credential. */
  readonly kind: DeepSeekAuthKind
  /** Absolute URL a request authenticated with this kind is sent to. */
  readonly endpoint: string
  /** The reference the key is read under. */
  readonly reference?: CredentialRef
  /**
   * Whether {@link resolve} would release a credential, checked without validating it or contacting the
   * destination. Store failures reject.
   * @returns whether a credential of this kind is configured for the endpoint.
   */
  configured(): Promise<boolean>
  /**
   * Release the credential, or `undefined` when none is configured. Store failures and an unusable key reject.
   * @param signal - cancellation for the lookup.
   * @returns the authorization, or `undefined`.
   */
  resolve(signal?: AbortSignal): Promise<DeepSeekAuthorization | undefined>
}

/** The connection needed to authorize a request did not resolve. */
export interface DeepSeekAuthUnresolved {
  /** Kind of the credential. */
  readonly kind: DeepSeekAuthKind
  /**
   * The connection a model route plugin connected or the caller supplied did not resolve.
   */
  readonly unresolved: 'connection'
  /** The failure. */
  readonly error: unknown
}
