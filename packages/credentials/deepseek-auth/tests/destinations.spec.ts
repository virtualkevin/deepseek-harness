/** Where the API key may be sent, with or without a connected model route. */
import { afterEach, describe, expect, it } from 'vitest'
import { disposeMounted, mount, request, summary } from './harness.ts'

afterEach(disposeMounted)

describe('absolute destinations', () => {
  const ROUTE = 'https://route.deepseek.test/anthropic'

  it('offers a kind for a URL under the origin of its deployment', async () => {
    const ctx = await mount()
    ctx.effect(() => ctx.deepseekAuth.connect('api-key', 'deepseek-official', () => ({ baseURL: ROUTE })))
    const url = 'https://route.deepseek.test/anthropic/v1/models'
    expect(summary(ctx.deepseekAuth.candidates(request({ billing: 'api-key', destination: { url } })))).toEqual([`api-key ${url}`])
  })

  it.each([
    'https://other.deepseek.test/anthropic/v1/models',
    'http://route.deepseek.test/anthropic/v1/models',
    'https://user:secret@route.deepseek.test/anthropic/v1/models',
  ])('offers no kind for %s, which is outside the deployment or embeds credentials', async (url) => {
    const ctx = await mount()
    ctx.effect(() => ctx.deepseekAuth.connect('api-key', 'deepseek-official', () => ({ baseURL: ROUTE })))
    expect(ctx.deepseekAuth.candidates(request({ billing: 'api-key', destination: { url } }))).toEqual([])
  })

  it('marks a kind unresolved for a destination that is no URL', async () => {
    const ctx = await mount()
    expect(ctx.deepseekAuth.candidates(request({ billing: 'api-key', destination: { url: 'not a url' } })))
      .toMatchObject([{ kind: 'api-key', unresolved: 'connection' }])
  })
})

it('uses the official API when no model route is connected', async () => {
  const ctx = await mount({ environment: { DEEPSEEK_BASE_URL: 'https://gateway.deepseek.test/anthropic' } })
  expect(summary(ctx.deepseekAuth.candidates(request()))).toEqual(['api-key https://api.deepseek.com/v1/tools/search'])
})
