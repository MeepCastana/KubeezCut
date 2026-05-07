/**
 * Shared HTTP header construction for outgoing API calls.
 *
 * Adds an opaque trace tag and a build identifier alongside Authorization so
 * the gateway can correlate requests for diagnostics. Centralizing this avoids
 * drift between request sites.
 */

const CLIENT_TRACE_TOKEN = '9c2e7a3f-1b8d';

// Vite-injected build-time constant. Falls back to '0.0.0' if the define
// somehow doesn't run (test envs, SSR, etc.) so requests always carry a value.
const CLIENT_BUILD =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__.length > 0
    ? __APP_VERSION__
    : '0.0.0';

export interface BuildKubeezHeadersOptions {
  apiKey: string;
  /** Extra headers to merge in (e.g. Content-Type for POST, Accept for SSE). */
  extra?: Record<string, string>;
}

/**
 * Standard authenticated headers for an outgoing API call. Pass `extra` for
 * per-call additions like Content-Type, Accept, or Cache-Control.
 */
export function buildKubeezApiHeaders(options: BuildKubeezHeadersOptions): Record<string, string> {
  const { apiKey, extra } = options;
  return {
    Authorization: `Bearer ${apiKey}`,
    'X-Client-Trace': CLIENT_TRACE_TOKEN,
    'X-Client-Build': CLIENT_BUILD,
    ...extra,
  };
}

/** Exported for tests so they can assert on the literal value. */
export const CLIENT_TRACE_HEADER_VALUE = CLIENT_TRACE_TOKEN;
