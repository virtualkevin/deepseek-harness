import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError, stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import {
  WebSearchCardController,
  type WebApiSettings, type WebLegacySettings, type WebProviderSelection,
} from '../src/client/web-search-card-controller.ts'

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites<T>(host: StubConfigForm<T>): void {
  const section = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().value as object })
  const layer = (): Record<string, unknown> => ({ ...host.scope.getSnapshot().user as object })
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value = { ...section() }
    const user = { ...layer() }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      } else {
        Reflect.deleteProperty(user, field)
        value[field] = (host.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]
      }
    }
    host.publish({ value: value as T, user })
    return Promise.resolve(true)
  })
}

/** The card plugin's context, scripted down to the namespaces a card reaches. */
function ctxWith(namespaces: object) {
  return { remote: namespaces } as never
}

/** Providers the shipped composition registers, in registration order. */
const SHIPPED_PROVIDERS = {
  search: [{ id: 'deepseek-search-api' }, { id: 'deepseek-official' }],
  fetch: [{ id: 'http' }, { id: 'deepseek-fetch-api' }],
}

type ProviderEntry = { id: string; title?: string; description?: { en: string; [locale: string]: string } }
type ProviderList = { search: ProviderEntry[]; fetch: ProviderEntry[] }
type ProviderResponse = { ok: true; value: ProviderList } | { ok: false; error: RemoteError }

/** The legacy key's default reference. */
const LEGACY_KEY = 'DEEPSEEK_API_KEY'

function remoteApi(configured: boolean | Record<string, boolean>) {
  const answer = (ref: string) => typeof configured === 'boolean' ? configured : configured[ref] ?? false
  const describe = vi.fn((refs: readonly string[]) => Promise.resolve({
    ok: true as const,
    value: Object.fromEntries(refs.map(ref => [ref, { configured: answer(ref), writable: true }])),
  }))
  const set = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }))
  const listProviders = vi.fn((): Promise<ProviderResponse> => Promise.resolve({ ok: true, value: SHIPPED_PROVIDERS }))
  return { ctx: ctxWith({ credentials: { describe, set }, web: { listProviders } }), describe, set, listProviders }
}

/** The shipped composition's selection: the DeepSeek Search API and local HTTP fetch. */
const SHIPPED_SELECTION = { searchProvider: 'deepseek-search-api', fetchProvider: 'http' }

/** Legacy Messages search with local HTTP fetch, the selection that shows the key control. */
const LEGACY_SELECTION = { searchProvider: 'deepseek-official', fetchProvider: 'http' }

/**
 * Mount the controller over three stub scopes.
 * @param options - whether each Host accepts writes, the credential answer, and a replacement context.
 * @returns the scopes, the controller, its face, and a state reader.
 */
function bench(options: { accept?: boolean; configured?: boolean | Record<string, boolean>; ctx?: never } = {}) {
  const web = stubConfigForm<WebProviderSelection>()
  const api = stubConfigForm<WebApiSettings>()
  const legacy = stubConfigForm<WebLegacySettings>()
  if (options.accept === true) {
    acceptWrites(web)
    acceptWrites(api)
    acceptWrites(legacy)
  }
  const remote = remoteApi(options.configured ?? true)
  const controller = new WebSearchCardController({ web: web.scope, api: api.scope, legacy: legacy.scope }, options.ctx ?? remote.ctx)
  const face = controller.inject()
  return {
    web, api, legacy, credentials: remote, controller, face, state: () => face.hooks.webSearchCard.getSnapshot(),
  }
}

/** Selection layers a scenario overrides. */
type SelectionLayers = { value?: WebProviderSelection; base?: WebProviderSelection; user?: WebProviderSelection }

/** The API section the shipped composition resolves: the schema defaults. */
const API_DEFAULTS: WebApiSettings = { count: 10 }

/**
 * Serve all three sections, with the shipped selection unless one is given,
 * the API section composed as `composed`, and the legacy section as `legacy`,
 * each with no user layer.
 */
function serve(
  b: ReturnType<typeof bench>, selection: SelectionLayers = {}, composed: WebApiSettings = API_DEFAULTS,
  legacy: WebLegacySettings = { maxUses: 5 },
): void {
  b.web.publish({ status: 'ready', writable: true, value: SHIPPED_SELECTION, base: SHIPPED_SELECTION, user: {}, ...selection })
  b.api.publish({ status: 'ready', writable: true, value: composed, base: composed, user: {} })
  b.legacy.publish({ status: 'ready', writable: true, value: legacy, base: legacy, user: {} })
}

/** Both DeepSeek API providers selected. */
const API_SELECTION = { searchProvider: 'deepseek-search-api', fetchProvider: 'deepseek-fetch-api' }

/** The shipped providers plus the plugin providers `exa` (Search) and `jina` (Fetch). */
const WITH_PLUGINS = {
  search: [...SHIPPED_PROVIDERS.search, { id: 'exa' }],
  fetch: [...SHIPPED_PROVIDERS.fetch, { id: 'jina' }],
}

/** Mount a Host that accepts writes, with legacy search selected and the legacy section carrying `legacy`. */
async function keyBench(legacy: WebLegacySettings = {}) {
  const b = bench({ accept: true })
  serve(b, { value: LEGACY_SELECTION }, API_DEFAULTS, legacy)
  await vi.waitFor(() => { expect(b.state().search.options).toHaveLength(2) })
  await Promise.resolve()
  return b
}

describe('WebSearchCardController legacy key', () => {
  it('reads the key reference once per settings publication wave after the eager read', async () => {
    const b = bench()
    try {
      expect(b.credentials.describe).toHaveBeenCalledTimes(1)
      serve(b)
      await Promise.resolve()
      expect(b.credentials.describe).toHaveBeenCalledTimes(2)
      serve(b)
      await Promise.resolve()
      expect(b.credentials.describe).toHaveBeenCalledTimes(3)
      for (const args of b.credentials.describe.mock.calls) expect(args).toEqual([[LEGACY_KEY]])
    } finally { b.controller.dispose() }
  })

  it('reads once when a settings publication wave renames the reference', async () => {
    const b = await keyBench()
    try {
      await vi.waitFor(() => { expect(b.state().legacyKey?.configured).toBe(true) })
      const count = b.credentials.describe.mock.calls.length
      b.legacy.publish({ value: { apiKeyEnv: 'RENAMED_KEY' } })
      expect(b.state().legacyKey?.configured).toBe(false)
      await Promise.resolve()
      expect(b.credentials.describe).toHaveBeenCalledTimes(count + 1)
      expect(b.credentials.describe).toHaveBeenLastCalledWith(['RENAMED_KEY'])
    } finally { b.controller.dispose() }
  })

  it.each(['before', 'after'])('keeps the credential update when the pending settings read finishes %s it', async (order) => {
    const b = bench({ configured: false })
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof b.credentials.describe>>>()
    const updated = Promise.withResolvers<Awaited<ReturnType<typeof b.credentials.describe>>>()
    try {
      await Promise.resolve()
      b.credentials.describe.mockImplementationOnce(() => pending.promise)
      serve(b, { value: LEGACY_SELECTION })
      await Promise.resolve()
      const count = b.credentials.describe.mock.calls.length
      b.credentials.describe.mockImplementationOnce(() => updated.promise)
      b.controller.refreshCredential(LEGACY_KEY)
      expect(b.credentials.describe).toHaveBeenCalledTimes(count + 1)
      if (order === 'before') {
        pending.resolve({ ok: true, value: { [LEGACY_KEY]: { configured: false, writable: true } } })
        await Promise.resolve()
      }
      updated.resolve({ ok: true, value: { [LEGACY_KEY]: { configured: true, writable: true } } })
      await vi.waitFor(() => { expect(b.state().legacyKey?.configured).toBe(true) })
      pending.resolve({ ok: true, value: { [LEGACY_KEY]: { configured: false, writable: true } } })
      await Promise.resolve()
      expect(b.state().legacyKey?.configured).toBe(true)
    } finally {
      b.controller.dispose()
      pending.resolve({ ok: true, value: {} })
      updated.resolve({ ok: true, value: {} })
      await Promise.all([pending.promise, updated.promise])
    }
  })

  it('discards queued reads and late answers after disposal', async () => {
    const b = bench({ configured: false })
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof b.credentials.describe>>>()
    const providers = Promise.withResolvers<ProviderResponse>()
    const publish = vi.fn()
    const off = b.face.hooks.webSearchCard.subscribe(publish)
    try {
      await Promise.resolve()
      serve(b, { value: LEGACY_SELECTION })
      await Promise.resolve()
      b.credentials.describe.mockImplementationOnce(() => pending.promise)
      b.controller.refreshCredential(LEGACY_KEY)
      b.credentials.listProviders.mockImplementationOnce(() => providers.promise)
      b.controller.refreshProviders()
      serve(b, { value: LEGACY_SELECTION })
      b.controller.dispose()
      const count = b.credentials.describe.mock.calls.length
      const listed = b.credentials.listProviders.mock.calls.length
      publish.mockClear()
      pending.resolve({ ok: true, value: { [LEGACY_KEY]: { configured: true, writable: true } } })
      providers.resolve({ ok: true, value: { search: [], fetch: [] } })
      await Promise.resolve()
      await Promise.resolve()
      expect(b.credentials.describe).toHaveBeenCalledTimes(count)
      expect(publish).not.toHaveBeenCalled()
      expect(b.state().legacyKey?.configured).toBe(false)
      b.controller.refreshCredential(LEGACY_KEY)
      b.controller.refreshProviders()
      serve(b)
      await Promise.resolve()
      expect(b.credentials.describe).toHaveBeenCalledTimes(count)
      expect(b.credentials.listProviders).toHaveBeenCalledTimes(listed)
    } finally {
      off()
      b.controller.dispose()
      pending.resolve({ ok: true, value: {} })
      providers.resolve({ ok: true, value: { search: [], fetch: [] } })
      await Promise.all([pending.promise, providers.promise])
    }
  })

  it('shows the key control only while legacy search is selected', async () => {
    const b = bench()
    try {
      serve(b, { value: API_SELECTION })
      await vi.waitFor(() => { expect(b.credentials.describe).toHaveBeenCalledTimes(2) })
      expect(b.state().legacyKey).toBeUndefined()
      b.face.selectProvider('searchProvider', 'deepseek-official')
      await vi.waitFor(() => { expect(b.state().legacyKey).toMatchObject({ text: '', overridden: false, ref: LEGACY_KEY, configured: true }) })
    } finally { b.controller.dispose() }
  })

  it('keeps an unknown credential reference writable and unconfigured', async () => {
    const b = await keyBench()
    try {
      await vi.waitFor(() => { expect(b.state().legacyKey?.configured).toBe(true) })
      b.credentials.describe.mockResolvedValue({ ok: true, value: {} })
      b.controller.refreshCredential(LEGACY_KEY)
      await vi.waitFor(() => { expect(b.state().legacyKey).toMatchObject({ configured: false, writable: true }) })
    } finally { b.controller.dispose() }
  })

  it('writes the staged key through the credentials domain, never a settings section', async () => {
    const b = bench()
    serve(b, { value: LEGACY_SELECTION })
    await vi.waitFor(() => { expect(b.state().legacyKey).toBeDefined() })
    b.face.edit('legacyApiKey', ' ds-secret ')
    expect(b.state().dirty).toBe(true)
    expect(b.credentials.set).not.toHaveBeenCalled()
    b.face.save()
    await vi.waitFor(() => { expect(b.credentials.set).toHaveBeenCalledWith(LEGACY_KEY, 'ds-secret') })
    for (const host of [b.web, b.api, b.legacy]) expect(host.mutate).not.toHaveBeenCalled()
    await vi.waitFor(() => { expect(b.state()).toMatchObject({ dirty: false, legacyKey: { configured: true } }) })
    b.controller.dispose()
  })

  it('accepts its successful key readback while a newer credential read is pending', async () => {
    const b = bench()
    const readback = Promise.withResolvers<Awaited<ReturnType<typeof b.credentials.describe>>>()
    const newer = Promise.withResolvers<Awaited<ReturnType<typeof b.credentials.describe>>>()
    try {
      serve(b, { value: LEGACY_SELECTION })
      await vi.waitFor(() => { expect(b.state().legacyKey).toBeDefined() })
      const count = b.credentials.describe.mock.calls.length
      b.credentials.describe.mockImplementationOnce(() => readback.promise)
      b.face.edit('legacyApiKey', 'ds-secret')
      b.face.save()
      await vi.waitFor(() => { expect(b.credentials.describe).toHaveBeenCalledTimes(count + 1) })
      b.credentials.describe.mockImplementationOnce(() => newer.promise)
      b.controller.refreshCredential(LEGACY_KEY)
      expect(b.credentials.describe).toHaveBeenCalledTimes(count + 2)
      readback.resolve({ ok: true, value: { [LEGACY_KEY]: { configured: true, writable: true } } })
      await vi.waitFor(() => { expect(b.state()).toMatchObject({ dirty: false, saving: false, failed: false }) })
      newer.resolve({ ok: true, value: { [LEGACY_KEY]: { configured: true, writable: true } } })
      await vi.waitFor(() => { expect(b.state().legacyKey?.configured).toBe(true) })
    } finally {
      b.controller.dispose()
      readback.resolve({ ok: true, value: {} })
      newer.resolve({ ok: true, value: {} })
      await Promise.all([readback.promise, newer.promise])
    }
  })

  it('keeps the stored key when the draft is left blank', async () => {
    const b = await keyBench()
    b.face.edit('legacyApiKey', '   ')
    expect(b.state().dirty).toBe(false)
    b.face.save()
    expect(b.credentials.set).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('re-reads only when the Host reports the watched reference changed', async () => {
    const b = bench({ configured: false })
    serve(b, { value: LEGACY_SELECTION })
    await vi.waitFor(() => { expect(b.credentials.describe).toHaveBeenCalled() })
    b.credentials.describe.mockClear()
    b.controller.refreshCredential('OTHER_KEY')
    expect(b.credentials.describe).not.toHaveBeenCalled()
    b.credentials.describe.mockImplementation((refs: readonly string[]) => Promise.resolve({
      ok: true as const, value: Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])),
    }))
    b.controller.refreshCredential(LEGACY_KEY)
    await vi.waitFor(() => { expect(b.state().legacyKey?.configured).toBe(true) })
    b.controller.dispose()
  })

  it('addresses the reference the legacy section declares', async () => {
    const b = await keyBench({ apiKeyEnv: 'TEAM_KEY' })
    await vi.waitFor(() => { expect(b.credentials.describe).toHaveBeenLastCalledWith(['TEAM_KEY']) })
    b.face.edit('legacyApiKey', 'ds-secret')
    b.face.save()
    await vi.waitFor(() => { expect(b.credentials.set).toHaveBeenCalledWith('TEAM_KEY', 'ds-secret') })
    b.controller.dispose()
  })

  it('reports a key the Host did not store as a failed save', async () => {
    const b = bench({ configured: false })
    serve(b, { value: LEGACY_SELECTION })
    b.face.edit('legacyApiKey', 'ds-secret')
    b.face.save()
    await vi.waitFor(() => { expect(b.state()).toMatchObject({ failed: true, dirty: true, selectionBlocked: true }) })
    b.controller.dispose()
  })

  it('keeps the card usable when the credential read and write are refused', async () => {
    const refusal = () => Promise.resolve({
      ok: false as const,
      error: new RemoteError('credential/rejected', 'offline', { ref: LEGACY_KEY }),
    })
    const describe = vi.fn(refusal)
    const set = vi.fn(refusal)
    const listProviders = vi.fn(refusal)
    const b = bench({ ctx: ctxWith({ credentials: { describe, set }, web: { listProviders } }) })
    await vi.waitFor(() => { expect(describe).toHaveBeenCalled() })
    serve(b, { value: LEGACY_SELECTION })
    b.face.edit('legacyApiKey', 'ds-secret')
    b.face.save()
    await vi.waitFor(() => { expect(set).toHaveBeenCalled() })
    expect(b.state()).toMatchObject({ available: true, search: { kind: 'legacy' }, legacyKey: { configured: false } })
    b.controller.dispose()
  })

  it('clears a changed reference immediately and drops its previous pending answer', async () => {
    const b = await keyBench()
    const previous = Promise.withResolvers<Awaited<ReturnType<typeof b.credentials.describe>>>()
    const renamed = Promise.withResolvers<Awaited<ReturnType<typeof b.credentials.describe>>>()
    try {
      await vi.waitFor(() => { expect(b.state().legacyKey?.configured).toBe(true) })
      b.credentials.describe.mockImplementationOnce(() => previous.promise)
      b.controller.refreshCredential(LEGACY_KEY)
      b.credentials.describe.mockImplementation(() => renamed.promise)
      b.legacy.publish({ value: { apiKeyEnv: 'RENAMED_KEY' } })
      expect(b.state().legacyKey?.configured).toBe(false)
      previous.resolve({ ok: true, value: { [LEGACY_KEY]: { configured: true, writable: true } } })
      await Promise.resolve()
      expect(b.state().legacyKey?.configured).toBe(false)
      renamed.resolve({ ok: true, value: { RENAMED_KEY: { configured: true, writable: false } } })
      await vi.waitFor(() => { expect(b.state().legacyKey).toMatchObject({ configured: true, writable: false }) })
    } finally {
      b.controller.dispose()
      previous.resolve({ ok: true, value: {} })
      renamed.resolve({ ok: true, value: {} })
      await Promise.all([previous.promise, renamed.promise])
    }
  })

  it('drops the answer for a reference renamed while the read was in flight', async () => {
    const b = await keyBench()
    const pending = Promise.withResolvers<Awaited<ReturnType<typeof b.credentials.describe>>>()
    try {
      b.credentials.describe.mockImplementationOnce(() => pending.promise)
      b.controller.refreshCredential(LEGACY_KEY)
      // Renames the reference without a publication, as a scope that changes outside its subscription would.
      const snapshot = b.legacy.scope.getSnapshot()
      vi.spyOn(b.legacy.scope, 'getSnapshot').mockReturnValue({ ...snapshot, value: { ...snapshot.value, apiKeyEnv: 'RENAMED_KEY' } })
      b.credentials.describe.mockImplementation((refs: readonly string[]) => Promise.resolve({
        ok: true as const, value: Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])),
      }))
      pending.resolve({ ok: true, value: { [LEGACY_KEY]: { configured: true, writable: false } } })
      await vi.waitFor(() => { expect(b.credentials.describe).toHaveBeenLastCalledWith(['RENAMED_KEY']) })
      await vi.waitFor(() => { expect(b.state().legacyKey).toMatchObject({ ref: 'RENAMED_KEY', configured: false, writable: true }) })
    } finally {
      b.controller.dispose()
      pending.resolve({ ok: true, value: {} })
    }
  })

  it('clears a reference renamed outside a publication when the next read starts', async () => {
    const b = await keyBench()
    try {
      await vi.waitFor(() => { expect(b.state().legacyKey?.configured).toBe(true) })
      const snapshot = b.legacy.scope.getSnapshot()
      vi.spyOn(b.legacy.scope, 'getSnapshot').mockReturnValue({ ...snapshot, value: { ...snapshot.value, apiKeyEnv: 'RENAMED_KEY' } })
      b.credentials.describe.mockImplementation(() => new Promise(() => {}))
      b.controller.refreshCredential(LEGACY_KEY)
      expect(b.credentials.describe).toHaveBeenLastCalledWith(['RENAMED_KEY'])
      expect(b.state().legacyKey?.configured).toBe(false)
    } finally { b.controller.dispose() }
  })

  it('reads the reference an already-served legacy section names on its first read', async () => {
    const web = stubConfigForm<WebProviderSelection>()
    const api = stubConfigForm<WebApiSettings>()
    const legacy = stubConfigForm<WebLegacySettings>()
    web.publish({ status: 'ready', writable: true, value: LEGACY_SELECTION, base: LEGACY_SELECTION, user: {} })
    legacy.publish({ status: 'ready', writable: true, value: { apiKeyEnv: 'SERVED_KEY' }, base: {}, user: {} })
    const remote = remoteApi({ SERVED_KEY: true })
    const controller = new WebSearchCardController({ web: web.scope, api: api.scope, legacy: legacy.scope }, remote.ctx)
    try {
      expect(remote.describe).toHaveBeenCalledExactlyOnceWith(['SERVED_KEY'])
      await vi.waitFor(() => { expect(controller.inject().hooks.webSearchCard.getSnapshot().legacyKey?.configured).toBe(true) })
    } finally { controller.dispose() }
  })
})

describe('WebSearchCardController legacy key drafts', () => {
  it('drops the draft once legacy search is deselected', async () => {
    const b = await keyBench()
    try {
      b.face.edit('legacyApiKey', 'draft')
      b.face.selectProvider('searchProvider', 'deepseek-search-api')
      expect(b.state()).toMatchObject({ dirty: false, legacyKey: undefined })
      b.face.selectProvider('searchProvider', 'deepseek-official')
      expect(b.state()).toMatchObject({ dirty: false, legacyKey: { text: '' } })
      b.face.save()
      await Promise.resolve()
      expect(b.credentials.set).not.toHaveBeenCalled()
    } finally { b.controller.dispose() }
  })

  it('drops the draft when the Host stops registering legacy search', async () => {
    const b = await keyBench()
    try {
      b.face.edit('legacyApiKey', 'draft')
      b.credentials.listProviders.mockResolvedValue({ ok: true, value: { search: [{ id: 'exa' }], fetch: [{ id: 'http' }] } })
      b.controller.refreshProviders()
      await vi.waitFor(() => { expect(b.state()).toMatchObject({ search: { kind: 'none' }, legacyKey: undefined }) })
      expect(b.state().dirty).toBe(false)
      b.credentials.listProviders.mockResolvedValue({ ok: true, value: WITH_PLUGINS })
      b.controller.refreshProviders()
      await vi.waitFor(() => { expect(b.state().legacyKey).toMatchObject({ text: '' }) })
    } finally { b.controller.dispose() }
  })

  it('drops the draft when the legacy section renames its reference', async () => {
    const b = await keyBench({ apiKeyEnv: 'TEAM_KEY' })
    try {
      b.face.edit('legacyApiKey', 'draft')
      b.legacy.publish({ value: { apiKeyEnv: 'RENAMED_KEY' } })
      expect(b.state()).toMatchObject({ dirty: false, legacyKey: { text: '', ref: 'RENAMED_KEY' } })
      b.face.save()
      await Promise.resolve()
      expect(b.credentials.set).not.toHaveBeenCalled()
    } finally { b.controller.dispose() }
  })

  it('ignores a draft for a key control the page does not show', async () => {
    const b = bench({ accept: true })
    try {
      serve(b, { value: API_SELECTION })
      b.face.edit('legacyApiKey', 'hidden-draft')
      expect(b.state()).toMatchObject({ dirty: false, legacyKey: undefined })
      b.face.selectProvider('searchProvider', 'deepseek-official')
      expect(b.state().legacyKey).toMatchObject({ text: '' })
    } finally { b.controller.dispose() }
  })

  it('completes a planned key write under its reference when its provider disappears during the save', async () => {
    const b = await keyBench({ apiKeyEnv: 'TEAM_KEY' })
    const first = Promise.withResolvers<{ ok: true; value: undefined }>()
    try {
      b.face.edit('legacyApiKey', 'draft')
      b.credentials.set.mockImplementationOnce(() => first.promise)
      b.face.save()
      await vi.waitFor(() => { expect(b.credentials.set).toHaveBeenCalledTimes(1) })
      b.credentials.listProviders.mockResolvedValue({ ok: true, value: { search: [{ id: 'exa' }], fetch: [{ id: 'http' }] } })
      b.controller.refreshProviders()
      await vi.waitFor(() => { expect(b.state()).toMatchObject({ search: { kind: 'none' }, legacyKey: undefined }) })
      first.resolve({ ok: true, value: undefined })
      await vi.waitFor(() => { expect(b.state().saving).toBe(false) })
      expect(b.credentials.set.mock.calls).toEqual([['TEAM_KEY', 'draft']])
      expect(b.credentials.describe).toHaveBeenLastCalledWith(['TEAM_KEY'])
      expect(b.state()).toMatchObject({ failed: false, dirty: false })
    } finally {
      first.resolve({ ok: true, value: undefined })
      b.controller.dispose()
    }
  })
})

describe('WebSearchCardController deployment defaults', () => {
  it('saves a typed value equal to the deployment default as an override', async () => {
    const b = bench({ accept: true })
    try {
      const composed = { baseURL: 'https://messages.test/v1', maxUses: 5 }
      serve(b, { value: LEGACY_SELECTION }, API_DEFAULTS, composed)
      b.api.publish({ value: { count: 20 }, user: { count: 20 } })
      const stored = { baseURL: 'https://custom.test/v1' }
      b.legacy.publish({ value: { ...composed, ...stored }, user: stored })
      b.face.edit('messagesBaseURL', ' https://messages.test/v1 ')
      b.face.edit('count', '10')
      expect(b.state()).toMatchObject({
        dirty: true, count: { text: '10', overridden: true }, messagesBaseURL: { text: ' https://messages.test/v1 ', overridden: true },
      })
      b.face.save()
      await vi.waitFor(() => { expect(b.state().dirty).toBe(false) })
      expect(b.api.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['count'], value: 10 }], undefined)
      expect(b.legacy.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['baseURL'], value: 'https://messages.test/v1' }], undefined)
      expect(b.legacy.scope.getSnapshot().user).toEqual({ baseURL: 'https://messages.test/v1' })
      expect(b.state()).toMatchObject({ count: { overridden: true }, messagesBaseURL: { overridden: true } })
    } finally { b.controller.dispose() }
  })

  it('writes nothing for a typed value equal to the composed one the user layer does not override', async () => {
    const b = bench({ accept: true })
    try {
      serve(b)
      b.face.edit('count', '11')
      expect(b.state().dirty).toBe(true)
      b.face.edit('count', '10')
      expect(b.state().dirty).toBe(false)
      b.face.save()
      await Promise.resolve()
      expect(b.api.mutate).not.toHaveBeenCalled()
    } finally { b.controller.dispose() }
  })

  it('marks a stored override as overridden even when it equals the deployment default', () => {
    const b = bench()
    try {
      serve(b, { value: LEGACY_SELECTION })
      const stored = { baseURL: 'https://messages.test/v1' }
      b.legacy.publish({ value: { maxUses: 5, ...stored }, base: { maxUses: 5, ...stored }, user: stored })
      expect(b.state()).toMatchObject({ dirty: false, messagesBaseURL: { text: stored.baseURL, overridden: true } })
      b.face.resetField('messagesBaseURL')
      expect(b.state()).toMatchObject({ dirty: true, messagesBaseURL: { overridden: false } })
    } finally { b.controller.dispose() }
  })
})

describe('WebSearchCardController sections', () => {
  it('stages and resets the legacy endpoint and search limit apart from the result count, clearing a blank limit', async () => {
    const b = bench({ accept: true })
    try {
      serve(b, { value: LEGACY_SELECTION })
      b.api.publish({ value: { count: 20 }, user: { count: 20 } })
      b.face.resetField('count')
      expect(b.state().count).toMatchObject({ text: '10', overridden: false })
      const stored = { baseURL: 'https://messages.test/v1', maxUses: 8 }
      b.legacy.publish({ value: stored, user: stored })
      b.face.resetField('maxUses')
      expect(b.state().maxUses).toMatchObject({ text: '5', overridden: false })
      b.face.edit('maxUses', '   ')
      b.face.resetField('messagesBaseURL')
      b.face.save()
      await vi.waitFor(() => { expect(b.state().dirty).toBe(false) })
      expect(b.legacy.mutate).toHaveBeenCalledExactlyOnceWith([
        { op: 'unset', path: ['maxUses'] }, { op: 'unset', path: ['baseURL'] },
      ], undefined)
      expect(b.api.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'unset', path: ['count'] }], undefined)
    } finally { b.controller.dispose() }
  })

  it.each(['0', '51', '1.5', 'many', 'Infinity'])('rejects an unsupported Search API result count: %s', (text) => {
    const b = bench()
    serve(b, { value: { searchProvider: 'deepseek-search-api' } })
    b.face.edit('count', text)
    expect(b.state()).toMatchObject({ invalid: true, selectionBlocked: true, count: { text, invalid: true } })
    b.face.save()
    expect(b.api.mutate).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it.each(['1', '50', '   '])('saves a supported Search API result count or restores its default: %j', async (text) => {
    const b = bench({ accept: true })
    serve(b, { value: { searchProvider: 'deepseek-search-api' } })
    b.api.publish({ value: { count: 20 }, base: { count: 10 }, user: { count: 20 } })
    b.face.edit('count', text)
    expect(b.state().invalid).toBe(false)
    b.face.save()
    await vi.waitFor(() => { expect(b.state().dirty).toBe(false) })
    expect(b.api.mutate).toHaveBeenCalledWith([
      text.trim() === '' ? { op: 'unset', path: ['count'] } : { op: 'set', path: ['count'], value: Number(text) },
    ], undefined)
    expect(b.state().count.text).toBe(text.trim() === '' ? '10' : text)
    b.controller.dispose()
  })
})
