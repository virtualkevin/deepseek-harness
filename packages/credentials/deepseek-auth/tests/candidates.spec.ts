/** Bind the API key to its deployment and destination. */
import { afterEach, describe, expect, it } from 'vitest'
import { DeepSeekAuthError } from '@deepseek-ai/dsh-deepseek-auth'
import { disposeMounted, mount, request, summary } from './harness.ts'

const OFFICIAL = 'https://api.deepseek.com/v1/tools/search'
const ROUTE = 'https://route.deepseek.test/anthropic'

afterEach(disposeMounted)

describe('connections', () => {
  it('sends the API key to the origin of the deployment its model route plugin connected', async () => {
    const ctx = await mount()
    ctx.effect(() => ctx.deepseekAuth.connect('api-key', 'deepseek-official', () => ({ baseURL: ROUTE })))
    expect(summary(ctx.deepseekAuth.candidates(request()))).toEqual(['api-key https://route.deepseek.test/v1/tools/search'])
  })

  it('withholds the key for another origin or a URL with embedded credentials', async () => {
    const ctx = await mount({ stored: { DEEPSEEK_API_KEY: 'fixture-key' } })
    for (const url of ['https://elsewhere.test/v1/tools/search', 'https://user@api.deepseek.com/v1/tools/search']) {
      await expect(ctx.deepseekAuth.authorize(request({ destination: { url } }))).resolves.toBeUndefined()
    }
  })

  it('reads the connected settings for each request', async () => {
    const ctx = await mount()
    let baseURL = ROUTE
    ctx.effect(() => ctx.deepseekAuth.connect('api-key', 'deepseek-official', () => ({ baseURL })))
    baseURL = 'https://next.deepseek.test/anthropic'
    expect(summary(ctx.deepseekAuth.candidates(request({ billing: 'api-key' })))).toEqual(['api-key https://next.deepseek.test/v1/tools/search'])
  })

  it('removes a connection with the plugin that made it', async () => {
    const ctx = await mount()
    const plugin = await ctx.plugin({ name: 'route', inject: ['deepseekAuth'], apply: (scope: typeof ctx) => {
      scope.effect(() => scope.deepseekAuth.connect('api-key', 'deepseek-official', () => ({ baseURL: ROUTE })))
    } })
    expect(summary(ctx.deepseekAuth.candidates(request({ billing: 'api-key' })))).toEqual(['api-key https://route.deepseek.test/v1/tools/search'])
    await plugin.dispose()
    expect(summary(ctx.deepseekAuth.candidates(request({ billing: 'api-key' })))).toEqual([`api-key ${OFFICIAL}`])
  })

  it('refuses a second connection of one kind', async () => {
    const ctx = await mount()
    ctx.effect(() => ctx.deepseekAuth.connect('api-key', 'deepseek-official', () => ({ baseURL: ROUTE })))
    expect(() => ctx.deepseekAuth.connect('api-key', 'another-route', () => ({ baseURL: ROUTE })))
      .toThrow(expect.objectContaining({ constructor: DeepSeekAuthError, code: 'DUPLICATE_CONNECTION' }))
  })

  it('prefers the connection a request carries over the connected one', async () => {
    const ctx = await mount()
    ctx.effect(() => ctx.deepseekAuth.connect('api-key', 'deepseek-official', () => ({ baseURL: ROUTE })))
    const own = { 'api-key': { baseURL: 'https://own.deepseek.test/api/v1/tools' } }
    expect(summary(ctx.deepseekAuth.candidates(request({ billing: 'api-key', connections: own })))).toEqual(['api-key https://own.deepseek.test/v1/tools/search'])
  })

  it('reports a connection error when the connected settings do not resolve', async () => {
    const ctx = await mount()
    const failure = new Error('settings do not resolve')
    ctx.effect(() => ctx.deepseekAuth.connect('api-key', 'deepseek-official', () => { throw failure }))
    expect(ctx.deepseekAuth.candidates(request())).toEqual([{ kind: 'api-key', unresolved: 'connection', error: failure }])
    await expect(ctx.deepseekAuth.authorize(request())).rejects.toMatchObject({ code: 'UNRESOLVED_CONNECTION', cause: failure })
  })
})
