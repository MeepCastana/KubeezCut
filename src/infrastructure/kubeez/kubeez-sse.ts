/**
 * Kubeez GET .../stream endpoints: Server-Sent Events (text/event-stream).
 * Wait for `event: result` (same JSON as matching GET status) or `event: error`.
 * @see OpenAPI Streaming tag — heartbeat / ping events ignored.
 */

function extractStreamErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const o = data as Record<string, unknown>;
  if (typeof o.message === 'string') return o.message;
  if (typeof o.error === 'string') return o.error;
  const detail = o.detail;
  if (typeof detail === 'string') return detail;
  return undefined;
}

type BlockParse =
  | { kind: 'result'; data: unknown }
  | { kind: 'error'; message: string }
  | { kind: 'ignore' };

function parseSseEventBlock(block: string): BlockParse {
  let eventName = '';
  const dataLines: string[] = [];

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  const ev = (eventName || 'message').trim().toLowerCase();
  const payload = dataLines.join('\n');

  if (ev === 'heartbeat' || ev === 'ping' || payload === '' && ev === 'message') {
    return { kind: 'ignore' };
  }

  if (ev === 'error') {
    let msg = payload.trim() || 'Generation stream error';
    try {
      const parsed = JSON.parse(payload) as unknown;
      msg = extractStreamErrorMessage(parsed) ?? msg;
    } catch {
      /* keep msg */
    }
    return { kind: 'error', message: msg };
  }

  if (ev === 'result') {
    try {
      return { kind: 'result', data: JSON.parse(payload) as unknown };
    } catch {
      return { kind: 'error', message: 'Invalid stream result payload (expected JSON)' };
    }
  }

  return { kind: 'ignore' };
}

/**
 * Reads an SSE response until `event: result` and returns parsed `data` JSON.
 * @throws On `event: error`, non-OK response, malformed result, or stream end without result.
 */
export async function readKubeezSseUntilResult(params: {
  url: string;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<unknown> {
  const { url, apiKey, signal } = params;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${apiKey}`,
      'Cache-Control': 'no-store',
    },
    signal,
  });

  if (!res.ok) {
    let msg = `Stream open failed (${res.status})`;
    try {
      const text = await res.text();
      if (text) {
        try {
          const j = JSON.parse(text) as unknown;
          msg = extractStreamErrorMessage(j) ?? msg;
        } catch {
          msg = text.slice(0, 200) || msg;
        }
      }
    } catch {
      /* keep msg */
    }
    throw new Error(msg);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Stream has no body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      }

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseSseEventBlock(block);
        if (parsed.kind === 'result') {
          await reader.cancel().catch(() => {});
          return parsed.data;
        }
        if (parsed.kind === 'error') {
          throw new Error(parsed.message);
        }
      }

      if (done) {
        break;
      }
    }
  } finally {
    await reader.releaseLock();
  }

  const tail = buffer.trim();
  if (tail.length > 0) {
    const parsed = parseSseEventBlock(tail);
    if (parsed.kind === 'result') {
      return parsed.data;
    }
    if (parsed.kind === 'error') {
      throw new Error(parsed.message);
    }
  }

  throw new Error('Stream ended without a result event');
}
