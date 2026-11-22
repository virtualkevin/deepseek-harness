/** SDK fixture for native registry changes and unmodified DeepSeek request observation. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { appendFile } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'sdk-dynamic-tool-cache-fixture'
export const inject = ['tools', 'systemPrompt', 'llm']

/** Observe each request and let the model add or remove a scoped tool. */
export function apply(ctx, config) {
  const states = new Map()
  ctx.on('session/event', (session, event) => {
    const state = states.get(session.id)
    if (state !== undefined && event.type === 'step/start') {
      state.turn = event.data.turn
      state.step = event.data.step
    }
  })
  const observation = new AsyncLocalStorage()
  ctx.effect(() => {
    const fetch = globalThis.fetch
    const observeFetch = async (input, init) => {
      const state = observation.getStore()
      if (state !== undefined && typeof input === 'string' && new URL(input).pathname.endsWith('/messages')
          && typeof init?.body === 'string') {
        await appendFile(config.evidencePath, `${JSON.stringify({ ...state, body: JSON.parse(init.body) })}\n`)
      }
      return fetch(input, init)
    }
    globalThis.fetch = observeFetch
    return () => {
      if (globalThis.fetch === observeFetch) globalThis.fetch = fetch
    }
  })
  ctx.on('llm/stream', (request, next) => {
    const stream = next()
    const state = request.purpose === undefined ? states.get(request.sessionId) : undefined
    if (state === undefined) return stream
    return (async function* () {
      const iterator = stream[Symbol.asyncIterator]()
      try {
        while (true) {
          const result = await observation.run(state, () => iterator.next())
          if (result.done) return
          yield result.value
        }
      } finally {
        await iterator.return?.()
      }
    })()
  })
  ctx.on('agent/created', ({ agent }) => {
    const scope = agent.ctx
    const state = { stage: 'initial', turn: 0, step: 0 }
    states.set(agent.id, state)
    scope.effect(() => () => { states.delete(agent.id) })
    scope.effect(() => scope.tools.restrict({ allow: [] }))
    let guidance = ''
    scope.systemPrompt.section({ name: 'sdk:dynamic-tool-guidance', order: 400, text: () => guidance })
    let removeTool
    scope.effect(() => scope.tools.register(defineTool({
      name: 'cache_tool_control',
      description: 'Add or remove the temporary cache_sample tool. It becomes available on the model step after add returns.',
      parameters: { action: { type: 'string', enum: ['add', 'remove'], required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute({ action }) {
        if (action === 'add') {
          if (removeTool !== undefined) throw new Error('The sample tool is already registered.')
          if (config.updatePrompt) guidance = 'Place each generated sample label on its own line.'
          removeTool = scope.effect(() => scope.tools.register(defineTool({
            name: 'cache_sample',
            description: 'Read a randomly generated sample label created for this example run.',
            parameters: {},
            output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
            async execute() {
              await appendFile(config.callsPath, 'sample\n')
              return config.sampleLabel
            },
          })))
          state.stage = 'added'
          await appendFile(config.callsPath, 'add\n')
          return 'Tool added. Call cache_sample on the next model step to obtain the generated sample label.'
        }
        if (removeTool === undefined) throw new Error('The sample tool is not registered.')
        await removeTool()
        removeTool = undefined
        state.stage = 'removed'
        await appendFile(config.callsPath, 'remove\n')
        return 'Tool removed. The sample tool is unavailable.'
      },
    })))
  })
}
