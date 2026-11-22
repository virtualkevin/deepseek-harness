/**
 * DeepSeek Fetch API provider: page Markdown through one direct request, without
 * a model request.
 * @module @deepseek-ai/dsh-web-deepseek-api/fetch
 */
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import {
  dispatchDeepSeekWeb, hasDeepSeekWebCredential, invalidResponse, isRecord,
  type DeepSeekWebAuth, type DeepSeekWebGuidance,
} from './transport.ts'

/** Stable id the Fetch API provider registers under in the fetch registry. */
export const DEEPSEEK_FETCH_API_PROVIDER_ID = 'deepseek-fetch-api'

/** Authentication and endpoint settings snapshotted for one fetch. */
export interface DeepSeekFetchApiOptions {
  /** Ordered authentication sources of the fetch, each bound to the Fetch endpoint its credential is sent to. */
  auth: DeepSeekWebAuth
  /** Settings that endpoint failures of the fetch name. */
  guidance: DeepSeekWebGuidance
}

/**
 * Fetch page Markdown through the DeepSeek Fetch API. The API reports neither the
 * target's status nor a final URL, and it fails when the target yields no usable
 * content, so a success is the requested page retrieved with HTTP 200.
 */
export class DeepSeekFetchApiProvider implements WebFetchProvider {
  readonly id = DEEPSEEK_FETCH_API_PROVIDER_ID
  /** Picker description: what this provider suits and what it costs or cannot do. */
  readonly description: NonNullable<WebFetchProvider['description']> = {
    en: "Can't reach intranet or local addresses. Incurs charges and requires a DeepSeek API key.",
    zh: '无法访问内网和本机。会产生费用，需要 DeepSeek API Key。',
    ja: 'イントラネットやローカルのアドレスにはアクセスできません。料金が発生し、DeepSeek API キーが必要です。',
    es: 'No puede acceder a direcciones de la intranet ni locales. Genera cargos y requiere una clave de API de DeepSeek.',
    fr: "N'accède pas aux adresses intranet ou locales. Entraîne des frais et nécessite une clé API DeepSeek.",
    de: 'Erreicht keine Intranet- oder lokalen Adressen. Verursacht Kosten und erfordert einen DeepSeek-API-Schlüssel.',
    ru: 'Адреса интрасети и локальные адреса недоступны. Услуга платная и требует ключ API DeepSeek.',
    pt: 'Não acessa endereços da intranet nem locais. Gera cobranças e requer uma chave de API da DeepSeek.',
  }

  /** @param resolveOptions - the options for the NEXT fetch, read once at each fetch's entry. */
  constructor(private readonly resolveOptions: () => DeepSeekFetchApiOptions) {}

  available(): boolean {
    return hasDeepSeekWebCredential(this.resolveOptions().auth)
  }

  fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const options = this.resolveOptions()
    return dispatchDeepSeekWeb(options.auth, {
      body: { url: request.url },
      decode: (payload): WebFetchResult => {
        if (!isRecord(payload) || typeof payload.content !== 'string') throw invalidResponse()
        return { url: request.url, statusCode: 200, body: { kind: 'text', content: payload.content }, truncated: false }
      },
      guidance: options.guidance,
    }, signal)
  }
}
