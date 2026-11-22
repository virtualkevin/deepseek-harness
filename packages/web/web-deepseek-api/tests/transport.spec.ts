import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { DeepSeekAuthCandidate } from '@deepseek-ai/dsh-deepseek-auth'
import { WebError } from '@deepseek-ai/dsh-web'
import { customGuidance } from './guidance.ts'
import {
  dispatchDeepSeekWeb, hasDeepSeekWebCredential, isDeepSeekWebAuthReady, type DeepSeekWebAuthSource,
} from '../src/transport.ts'
const API_BASE = 'https://api.deepseek.test/v1/tools'
const KEY_REF = credentialRef('TEST_KEY')
/** The presence check and the read of one referenced key. */
interface KeyRead {
  configured: () => Promise<boolean>
  resolve: () => Promise<string | undefined>
}
/** A referenced key whose presence check and read are the given functions. */
function keyRef(resolve: () => Promise<string | undefined>, configured: () => Promise<boolean> = async () => true): KeyRead {
  return { configured, resolve }
}
/**
 * An API-key candidate bound to the Search endpoint under {@link API_BASE}, as `ctx.deepseekAuth` binds one: it
 * releases the read key as a bearer token and releases nothing without a key.
 */
function keySource(key: KeyRead = keyRef(async () => 'ds-key')): DeepSeekAuthCandidate {
  const endpoint = `${API_BASE}/search`
  return {
    kind: 'api-key', endpoint, reference: KEY_REF, configured: key.configured,
    resolve: async () => {
      const value = await key.resolve()
      if (value === undefined) return undefined
      return { kind: 'api-key', endpoint, reference: KEY_REF, headers: { authorization: `Bearer ${value}` } }
    },
  }
}
const misconfigured: DeepSeekWebAuthSource = { kind: 'misconfigured', message: 'route settings do not resolve' }
/** Search once with the given sources, in order. */
function search(
  sources: readonly DeepSeekWebAuthSource[], signal?: AbortSignal,
  extra: { recordRequest?: (endpoint: string) => void; missingCredentialMessage?: string } = {},
) {
  const { recordRequest, missingCredentialMessage } = extra
  return dispatchDeepSeekWeb({ sources, ...missingCredentialMessage === undefined ? {} : { missingCredentialMessage } }, {
    body: { query: 'q' }, decode: value => value,
    ...recordRequest === undefined ? {} : { recordRequest },
    guidance: customGuidance('search'),
  }, signal)
}
function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}
async function rejectedWebError(operation: Promise<unknown>): Promise<WebError> {
  try { await operation } catch (error) { if (error instanceof WebError) return error; throw error }
  throw new Error('expected request to reject')
}
/** Stub fetch and read back the endpoint and headers of each call. */
function captureFetch(response: () => Response = () => jsonResponse({})) {
  // The provider always passes the endpoint as a string.
  const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => response())
  vi.stubGlobal('fetch', fetchMock)
  return {
    fetchMock,
    sent: () => fetchMock.mock.calls.map(([url, init]) => ({ url, headers: (init?.headers ?? {}) as Record<string, string> })),
  }
}
afterEach(() => vi.unstubAllGlobals())

describe('DeepSeek web API credentials', () => {
  it('sends the key only to its bound endpoint', async () => {
    const { sent } = captureFetch()
    const resolve = vi.fn(async () => 'resolved-key')
    const configured = vi.fn(async () => true)
    await search([keySource(keyRef(resolve, configured))])
    expect(sent()).toHaveLength(1)
    expect(sent()[0]?.url).toBe(`${API_BASE}/search`)
    expect(sent()[0]?.headers).toMatchObject({ authorization: 'Bearer resolved-key' })
    expect(sent()[0]?.headers).not.toHaveProperty('x-dsh-auth-token')
    expect(resolve).toHaveBeenCalledOnce()
    expect(configured).not.toHaveBeenCalled()
  })

  it.each<[string, readonly DeepSeekWebAuthSource[]]>([
    ['no sources', []],
    ['a missing key', [keySource(keyRef(async () => undefined))]],
  ])('fails with the caller diagnostic and sends nothing for %s', async (_label, sources) => {
    const { fetchMock } = captureFetch()
    await expect(search(sources, undefined, { missingCredentialMessage: 'no credential for this search' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING', message: 'no credential for this search' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('names no credential without a caller diagnostic', async () => {
    const { fetchMock } = captureFetch()
    await expect(search([])).rejects.toMatchObject({
      code: 'WEB_PROVIDER_CREDENTIAL_MISSING', message: 'DeepSeek web access has no credential to send',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails before dispatch when the endpoint settings do not resolve', async () => {
    const { fetchMock } = captureFetch()
    await expect(search([misconfigured])).rejects.toMatchObject({
      code: 'WEB_PROVIDER_MISCONFIGURED', message: 'route settings do not resolve',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps a key read failure as the cause without dispatching', async () => {
    const { fetchMock } = captureFetch()
    const failure = new WebError('malformed key', 'WEB_PROVIDER_MISCONFIGURED')
    const error = await rejectedWebError(search([keySource(keyRef(() => Promise.reject(failure)))]))
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: `DeepSeek web credential resolution failed: ${String(failure)}` })
    expect(error.cause).toBe(failure)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('DeepSeek web credential availability and readiness', () => {
  it.each<[boolean, readonly DeepSeekWebAuthSource[]]>([
    [false, []],
    [true, [keySource()]],
    [true, [misconfigured]],
  ])('reports a source to try as %s without reading credentials', (expected, sources) => {
    expect(hasDeepSeekWebCredential({ sources })).toBe(expected)
  })

  it('checks a key for presence without reading it', async () => {
    const { fetchMock } = captureFetch()
    const resolve = vi.fn(async () => 'resolved-key')
    const configured = vi.fn(async () => true)
    expect(await isDeepSeekWebAuthReady({ sources: [keySource(keyRef(resolve, configured))] })).toBe(true)
    expect(configured).toHaveBeenCalledOnce()
    expect(resolve).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each<[string, readonly DeepSeekWebAuthSource[]]>([
    ['no sources', []],
    ['an unconfigured key', [keySource(keyRef(async () => undefined, async () => false))]],
    ['a misconfigured source', [misconfigured]],
    ['an unreadable credential store', [keySource(keyRef(async () => 'key', () => Promise.reject(new Error('store locked'))))]],
  ])('answers false with %s', async (_label, sources) => {
    expect(await isDeepSeekWebAuthReady({ sources })).toBe(false)
  })
})

describe('DeepSeek web cancellation and failures', () => {
  it('does not start credential resolution or dispatch for a pre-aborted call', async () => {
    const resolve = vi.fn(async () => 'late-key')
    const recordRequest = vi.fn()
    const { fetchMock } = captureFetch()
    await expect(search([keySource(keyRef(resolve))], AbortSignal.abort(new Error('caller stopped')), { recordRequest }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    expect(resolve).not.toHaveBeenCalled()
    expect(recordRequest).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aborts while an uncooperative credential resolver remains pending', async () => {
    const resolve = vi.fn(() => new Promise<string>(() => {}))
    const recordRequest = vi.fn()
    const { fetchMock } = captureFetch()
    const controller = new AbortController()
    const pending = search([keySource(keyRef(resolve))], controller.signal, { recordRequest })
    controller.abort(new Error('deadline'))
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    expect(resolve).toHaveBeenCalledOnce()
    expect(recordRequest).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves credentials under an active cancellation signal', async () => {
    const { sent } = captureFetch(() => jsonResponse({ truncated: false }))
    await expect(search([keySource(keyRef(async () => 'resolved-key'))], new AbortController().signal))
      .resolves.toMatchObject({ truncated: false })
    expect(sent()[0]?.headers.authorization).toBe('Bearer resolved-key')
  })

  it('maps a credential resolver rejection under an active signal to WEB_PROVIDER_ERROR', async () => {
    await expect(search([keySource(keyRef(() => Promise.reject(new Error('credential backend failed'))))], new AbortController().signal))
      .rejects.toThrow(expect.objectContaining({
        code: 'WEB_PROVIDER_ERROR',
        message: 'DeepSeek web credential resolution failed: Error: credential backend failed',
      }))
  })

  it('maps a non-Error credential rejection under an active signal to WEB_PROVIDER_ERROR with the value as its cause', async () => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the non-Error arm is the case under test.
    const rejectString = () => Promise.reject('backend down')
    const error = await rejectedWebError(search([keySource(keyRef(rejectString))], new AbortController().signal))
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'DeepSeek web credential resolution failed: Error: backend down' })
    expect(error.cause).toMatchObject({ cause: 'backend down' })
  })

  it('observes cancellation triggered synchronously by credential resolution', async () => {
    const controller = new AbortController()
    const { fetchMock } = captureFetch()
    await expect(search([keySource(keyRef(() => {
      controller.abort(new Error('resolver cancelled caller'))
      return Promise.resolve('unused-key')
    }))], controller.signal)).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps endpoint guidance when the API rejects a key', async () => {
    const { fetchMock } = captureFetch(() => jsonResponse({ error: 'invalid key' }, { status: 401 }))
    const error = await rejectedWebError(search([keySource()]))
    expect(error.message).toContain('DeepSeek API error (HTTP 401): invalid key')
    expect(error.message).toContain('If that endpoint is not intended')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('maps an HTTP error to WEB_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'rate limited' } }, { status: 429 })))
    await expect(search([keySource()]))
      .rejects.toThrow(expect.objectContaining({
        code: 'WEB_PROVIDER_ERROR',
        message: 'DeepSeek API error (HTTP 429): rate limited\n\n'
          + 'The web request used endpoint "https://api.deepseek.test/v1/tools/search". '
          + 'Search sends the API key under web-deepseek-api.searchApiKeyEnv to web-deepseek-api.searchBaseURL. If that '
          + 'endpoint is not intended, guide the user to correct web-deepseek-api.searchBaseURL and '
          + 'web-deepseek-api.searchApiKeyEnv, or to remove both so Search uses the DeepSeek credential of the conversation. '
          + 'Only the user should choose or change the endpoint.',
      }))
  })

  it('handles a string-form error body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'bad request' }, { status: 400 })))
    const error = await rejectedWebError(search([keySource()]))
    expect(error.message).toContain('DeepSeek API error (HTTP 400): bad request')
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream error', { status: 503 })))
    const error = await rejectedWebError(search([keySource()]))
    expect(error.message).toContain('DeepSeek API error (HTTP 503)')
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    const error = await rejectedWebError(search([keySource()]))
    expect(error.message).toContain('DeepSeek API error (HTTP 500)')
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(search([keySource()]))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps a custom abort reason to WEB_ABORTED', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new Error('custom abort reason')) }, { once: true })
      })))
    const pending = search([keySource()], controller.signal)
    controller.abort(new Error('timeout reason'))
    await expect(pending).rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(search([keySource()]))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED', async () => {
    const body = new Response('', { status: 200 })
    vi.spyOn(body, 'json').mockRejectedValue(new DOMException('aborted', 'AbortError'))
    vi.stubGlobal('fetch', vi.fn(async () => body))
    await expect(search([keySource()]))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = new Response('', { status: 500 })
    vi.spyOn(body, 'json').mockRejectedValue(new DOMException('aborted', 'AbortError'))
    vi.stubGlobal('fetch', vi.fn(async () => body))
    await expect(search([keySource()]))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    const error = await rejectedWebError(search([keySource()]))
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(error.message).toContain('The web request used endpoint "https://api.deepseek.test/v1/tools/search".')
  })
})
