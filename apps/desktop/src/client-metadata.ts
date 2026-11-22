/** Desktop client metadata for update-policy requests. */
export interface DesktopClientMetadata {
  readonly version: string
  readonly locale: string
  readonly timezoneOffsetSeconds: number
}

/**
 * Read the client build version inlined by the Desktop build.
 * @returns the version embedded in this application build.
 * @throws Error when the build carries no client version, instead of reporting a guessed one.
 */
export function desktopClientVersion(): string {
  const version = process.env.DSH_CLIENT_VERSION
  if (version === undefined || version === '') {
    throw new Error('desktop: this application build carries no DSH_CLIENT_VERSION')
  }
  return version
}

/**
 * Sample the Desktop client identity for one update-policy request.
 * @param locale - current resolved Desktop language.
 * @returns this call's build version, the raw active language, and the UTC offset in whole seconds east.
 */
export function desktopClientMetadata(locale: string): DesktopClientMetadata {
  return {
    version: desktopClientVersion(),
    locale,
    // Date.getTimezoneOffset reports minutes west of UTC; Platform wants seconds east.
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

/**
 * Build client identity headers for the update-policy endpoint.
 * @param platform - operating system supplied by the desktop composition.
 * @param client - installed client metadata sampled for the request.
 * @returns the five client headers, including the empty bundle ID expected by the endpoint.
 */
export function desktopClientHeaders(platform: 'darwin' | 'win32', client: DesktopClientMetadata): Record<string, string> {
  return {
    'x-client-bundle-id': '',
    'x-client-platform': platform === 'win32' ? 'desktop-win' : 'desktop-mac',
    'x-client-version': client.version,
    'x-client-locale': client.locale.toLowerCase().split(/[-_]/)[0] === 'zh' ? 'zh_CN' : 'en_US',
    'x-client-timezone-offset': String(client.timezoneOffsetSeconds),
  }
}
