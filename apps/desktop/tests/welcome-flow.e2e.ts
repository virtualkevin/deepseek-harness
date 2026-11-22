/** Built Desktop Host acceptance; run after the repository build, without provider credentials. */

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopHostProcess } from '../src/host-process.ts'
import { connectDesktopWelcome, type DesktopWelcomeBackend } from '../src/welcome-backend.ts'
import { builtHost, prepareDesktopHome } from './harness.ts'

afterEach(() => { vi.unstubAllEnvs() })

describe.skipIf(!existsSync(builtHost))('built Desktop welcome flow', () => {
  it('persists explicit API keys across Host restarts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-welcome-'))
    let host: DesktopHostProcess | undefined
    try {
      const { home, project, paths } = await prepareDesktopHome(root)
      const nodeBin = join(root, 'runtime/primary-runtime/dependencies/node/bin')
      mkdirSync(nodeBin, { recursive: true })
      cpSync(process.execPath, join(nodeBin, process.platform === 'win32' ? 'node.exe' : 'node'))
      writeFileSync(join(paths.profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n')
      let backend: DesktopWelcomeBackend
      const restart = async (): Promise<void> => {
        await host?.stop()
        host = new DesktopHostProcess(process.execPath, project, paths.profile, undefined,
          process.env, undefined, join(root, 'runtime', 'primary-runtime'))
        const { url, authenticationCookie } = await host.start()
        backend = connectDesktopWelcome(url, authenticationCookie)
      }
      const status = async () => backend.read()
      const fingerprint = (): string => createHash('sha256')
        .update(readFileSync(join(home, '.credentials.yaml'))).digest('hex')
      await restart()
      expect(await status()).toMatchObject({ hasApiKey: false, localePreference: null })
      const before = fingerprint()
      await host!.stop()
      writeFileSync(join(paths.profile, 'cordis.patch.yml'),
        readFileSync(join(paths.profile, 'cordis.patch.yml'), 'utf8') + '- id: locale\n  config:\n    preference: zh\n')
      await restart()
      expect(await status()).toMatchObject({ hasApiKey: false, localePreference: 'zh' })
      expect(fingerprint()).toBe(before)
      expect(await backend!.save('sk-local-onboarding-test')).toEqual({ ok: true })
      expect(await status()).toMatchObject({ hasApiKey: true, localePreference: 'zh' })
      await restart()
      expect(await status()).toMatchObject({ hasApiKey: true })
      // A handle left open after acknowledged teardown must not fail the update handoff.
      vi.stubEnv('NODE_OPTIONS', `--import=data:text/javascript,${encodeURIComponent(
        "process.on('message', message => { if (message?.type === 'shutdown') setInterval(() => {}, 1000) })")}`)
      await restart()
      await host!.stop(true)
    } finally {
      await host?.stop()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
