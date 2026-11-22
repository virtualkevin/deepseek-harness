/** Reading and releasing the API key. */
import { afterEach, describe, expect, it } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { DeepSeekAuthError } from '@deepseek-ai/dsh-deepseek-auth'
import { candidate, disposeMounted, mount, request } from './harness.ts'

afterEach(disposeMounted)

const SEARCH = 'https://api.deepseek.com/v1/tools/search'
const key = request({ billing: 'api-key' })

describe('the API key', () => {
  it('is read under DEEPSEEK_API_KEY and sent as a bearer token by default', async () => {
    const ctx = await mount({ stored: { DEEPSEEK_API_KEY: ' sk-stored ' } })
    const [entry] = ctx.deepseekAuth.candidates(key)
    expect(await candidate(entry).configured()).toBe(true)
    expect(await ctx.deepseekAuth.authorize(key)).toEqual({
      kind: 'api-key', endpoint: SEARCH, reference: 'DEEPSEEK_API_KEY', headers: { authorization: 'Bearer sk-stored' },
    })
  })

  it.each([
    [['x-api-key'], { 'x-api-key': 'sk-stored' }],
    [['x-api-key', 'authorization'], { 'x-api-key': 'sk-stored', 'authorization': 'Bearer sk-stored' }],
  ] as const)('is sent in the headers the request names: %j', async (apiKeyHeaders, headers) => {
    const ctx = await mount({ stored: { DEEPSEEK_API_KEY: 'sk-stored' } })
    expect((await ctx.deepseekAuth.authorize({ ...key, apiKeyHeaders }))?.headers).toEqual(headers)
  })

  it('is read under the reference of its connection', async () => {
    const ctx = await mount({ stored: { DEEPSEEK_API_KEY: 'sk-default', ROUTE_KEY: 'sk-route' } })
    ctx.effect(() => ctx.deepseekAuth.connect('api-key', 'deepseek-official', () => ({ baseURL: 'https://route.deepseek.test', reference: credentialRef('ROUTE_KEY') })))
    expect(await ctx.deepseekAuth.authorize(key)).toMatchObject({ reference: 'ROUTE_KEY', headers: { authorization: 'Bearer sk-route' } })
  })

  it('is read from the launch environment only without a credentials service', async () => {
    const ambient = await mount({ environment: { DEEPSEEK_API_KEY: 'sk-ambient' } })
    expect((await ambient.deepseekAuth.authorize(key))?.headers).toEqual({ authorization: 'Bearer sk-ambient' })
    const authoritative = await mount({ environment: { DEEPSEEK_API_KEY: 'sk-ambient' }, stored: {} })
    expect(await candidate(authoritative.deepseekAuth.candidates(key)[0]).configured()).toBe(false)
    expect(await authoritative.deepseekAuth.authorize(key)).toBeUndefined()
  })

  it.each([
    [
      '   ', undefined,
      'web-test: the API key resolved from DEEPSEEK_API_KEY is blank; set DEEPSEEK_API_KEY to the raw key'
      + ' (the web Models page writes it) or export it in the launching environment',
    ],
    [
      'sk-你好', 'llm-deepseek',
      'llm-deepseek: the API key resolved from DEEPSEEK_API_KEY contains characters no HTTP header can carry;'
      + ' set DEEPSEEK_API_KEY to the raw key alone (the web Models page writes it)',
    ],
  ])('refuses the unusable key %j, naming its owner and reference and never the key', async (value, owner, message) => {
    const ctx = await mount({ stored: { DEEPSEEK_API_KEY: value } })
    const connections = { 'api-key': { baseURL: 'https://api.deepseek.com', ...owner === undefined ? {} : { owner } } }
    const failure = await ctx.deepseekAuth.authorize({ ...key, connections }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DeepSeekAuthError)
    expect(failure).toMatchObject({ code: 'INVALID_CREDENTIAL', message })
  })

  it('starts no read for a cancelled lookup', async () => {
    const ctx = await mount({ stored: { DEEPSEEK_API_KEY: 'sk-stored' } })
    const reason = new Error('cancelled')
    await expect(ctx.deepseekAuth.authorize(key, AbortSignal.abort(reason))).rejects.toBe(reason)
  })

  it('propagates a credential store failure', async () => {
    const ctx = await mount()
    const failure = new Error('store unreadable')
    ctx.provide('credentials', { resolve: () => Promise.reject(failure) } as never)
    await expect(ctx.deepseekAuth.authorize(key)).rejects.toBe(failure)
  })
})
