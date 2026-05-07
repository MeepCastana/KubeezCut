import {
  KUBEEZ_API_PROXY_PATH_PREFIX,
  kubeezBrowserDirectApiOrigin,
  rewriteKubeezMediaCdnUrlForFetch,
} from '@/infrastructure/kubeez/kubeez-cdn-fetch-url';
import { readKubeezSseUntilResult } from '@/infrastructure/kubeez/kubeez-sse';
import { extractKubeezPollStatus, isKubeezPlainObject } from '@/infrastructure/kubeez/kubeez-poll-status';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('Kubeez');

/** Same-origin API prefix when using a reverse proxy (default). See `VITE_KUBEEZ_BROWSER_API_URL` for direct API. */
export const KUBEEZ_BROWSER_PROXY_BASE = KUBEEZ_API_PROXY_PATH_PREFIX;
export const KUBEEZ_MODEL_NANO_BANANA_2 = 'nano-banana-2';

/**
 * Resolves API base for `fetch()`.
 *
 * - **Default (browser):** same-origin `/api/kubeez` (Vite proxy or your nginx / edge rewrites).
 * - **`VITE_KUBEEZ_BROWSER_API_URL`:** e.g. `https://api.kubeez.com` for self-hosted editors (Hetzner, etc.)
 *   without `/api/kubeez` proxy — needs CORS on the Kubeez API for your editor origin.
 * - Same-origin settings URL that is **not** `/api/kubeez` (e.g. editor homepage) → uses default base above
 *   so `POST …/v1/generate/media` does not hit the static app (405).
 */
export function resolveKubeezApiBaseUrl(configured: string | undefined): string {
  const trimmed = (configured ?? '').trim();
  const proxy = KUBEEZ_BROWSER_PROXY_BASE.replace(/\/$/, '');
  const direct = kubeezBrowserDirectApiOrigin();
  const browserDefault = direct || proxy;

  if (typeof window === 'undefined') {
    return trimmed || browserDefault;
  }

  // Same-origin absolute URLs (e.g. http://localhost:5173/api/kubeez) → relative `/api/kubeez`
  // so dev always goes through the Vite proxy; avoids misconfigured full URLs.
  if (trimmed) {
    try {
      const u = new URL(trimmed, window.location.origin);
      if (u.origin === window.location.origin) {
        const path = u.pathname.replace(/\/$/, '') || '/';
        if (path === proxy || path.startsWith(`${proxy}/`)) {
          return proxy;
        }
        // Same host as the app but not the API proxy (e.g. https://editor…/ pasted as base).
        return browserDefault;
      }
    } catch {
      /* ignore */
    }
  }

  if (!trimmed || trimmed === proxy || trimmed === `${proxy}/`) {
    return browserDefault;
  }

  try {
    const u = new URL(trimmed, window.location.origin);
    if (u.origin === 'https://api.kubeez.com') {
      return direct ? trimmed.replace(/\/$/, '') : proxy;
    }
  } catch {
    /* relative e.g. /api/kubeez */
  }

  return trimmed.replace(/\/$/, '');
}

/** Appended when POST /v1/generate/* returns 405 (SPA/static host). Shared by media, music, dialogue. */
export const KUBEEZ_CLIENT_HTTP_405_HINT =
  ' (405: API POST hit the wrong route. Use nginx /api/kubeez → api.kubeez.com (see deploy/), set VITE_KUBEEZ_BROWSER_API_URL=https://api.kubeez.com, or leave defaults: production builds for editor.kubeez.com infer direct API when that env is unset.)';

/** After the first immediate poll, use this interval while the job is likely still in flight. */
const POLL_INTERVAL_FAST_MS = 1000;
/** Back off for long-running generations to avoid hammering the API. */
const POLL_INTERVAL_SLOW_MS = 2000;
/** Switch to slow interval after this many completed poll attempts (still fast early). */
const POLL_ATTEMPTS_BEFORE_SLOW_POLL = 25;
const MAX_POLL_ATTEMPTS = 150;
const MEDIA_DOWNLOAD_RETRIES = 10;
const MEDIA_DOWNLOAD_RETRY_MS = 1000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

/** POST responses may nest `id` / `generation_id` under `data` or `result`. */
function collectEnvelopeRoots(data: unknown): Record<string, unknown>[] {
  if (!isKubeezPlainObject(data)) return [];
  const roots: Record<string, unknown>[] = [data];
  for (const k of ['data', 'result', 'payload', 'generation', 'job'] as const) {
    const v = data[k];
    if (isKubeezPlainObject(v)) roots.push(v);
  }
  return roots;
}

function extractIdFromRoot(o: Record<string, unknown>): string | null {
  const id = o.generation_id ?? o.id ?? o.generationId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function extractGenerationId(data: unknown): string | null {
  for (const root of collectEnvelopeRoots(data)) {
    const id = extractIdFromRoot(root);
    if (id) return id;
  }
  return null;
}

function mediaTypeMatches(mt: string, prefer: 'video' | 'image'): boolean {
  const m = mt.toLowerCase();
  if (prefer === 'video') return m.startsWith('video');
  return m.startsWith('image') || m === '' || !m;
}

/** Prefer signed / download URLs when the API also exposes a path-only `url` before CDN is ready. */
const OUTPUT_URL_KEYS = [
  'signed_url',
  'download_url',
  'file_url',
  'public_url',
  'media_url',
  'url',
  'optimized_url',
  'href',
  'src',
] as const;

/**
 * Resolves a fetchable URL from an output row. Kubeez may return root-relative CDN paths
 * (e.g. `/images/<id>.jpg`) only in `outputs[].url`; those must be picked so
 * `rewriteKubeezMediaCdnUrlForFetch` can map them to `/api/kubeez/cdn/...`.
 */
function pickHttpUrlFromRecord(entry: Record<string, unknown>): string | null {
  for (const k of OUTPUT_URL_KEYS) {
    const v = entry[k];
    if (typeof v === 'string' && v.trim().length > 0) {
      const t = v.trim();
      if (t.startsWith('//')) return `https:${t}`;
      if (/^https?:\/\//i.test(t)) return t;
      if (t.startsWith('/') && t.length > 1) return t;
    }
  }
  return null;
}

function collectMediaRoots(data: unknown): Record<string, unknown>[] {
  return collectEnvelopeRoots(data);
}

/** Picks an output URL from completed generation; prefers video or image when requested. */
function firstOutputMediaUrl(data: unknown, prefer: 'video' | 'image'): string | null {
  const roots = collectMediaRoots(data);
  if (roots.length === 0) return null;

  let preferMatch: string | null = null;
  let fallbackUrl: string | null = null;

  const consider = (url: string | undefined, mt: string) => {
    if (!url) return;
    if (!fallbackUrl) fallbackUrl = url;
    if (mediaTypeMatches(mt, prefer)) {
      preferMatch = url;
    }
  };

  for (const o of roots) {
    const outputs = o.outputs ?? o.media_outputs;
    if (Array.isArray(outputs)) {
      for (const entry of outputs) {
        if (!isKubeezPlainObject(entry)) continue;
        const mt = typeof entry.media_type === 'string' ? entry.media_type : '';
        const url = pickHttpUrlFromRecord(entry) ?? undefined;
        consider(url, mt);
        if (preferMatch) return preferMatch;
      }
    }

    const singleOutput = o.output;
    if (isKubeezPlainObject(singleOutput)) {
      const mt = typeof singleOutput.media_type === 'string' ? singleOutput.media_type : '';
      const url = pickHttpUrlFromRecord(singleOutput) ?? undefined;
      consider(url, mt);
    }

    if (preferMatch) return preferMatch;
  }

  if (preferMatch) return preferMatch;
  if (fallbackUrl) return fallbackUrl;

  for (const o of roots) {
    const direct = o.output_url ?? o.image_url ?? o.video_url ?? o.url ?? o.optimized_url;
    if (typeof direct === 'string' && direct.length > 0) return direct;
  }
  return null;
}

/**
 * OpenAPI: GET /v1/generate/media/{id} — `outputs[].optimization_status` may be `failed`
 * while the job is otherwise finished.
 */
function hasFailedOutputOptimization(data: unknown): boolean {
  for (const o of collectMediaRoots(data)) {
    const outputs = o.outputs ?? o.media_outputs;
    if (!Array.isArray(outputs)) continue;
    for (const entry of outputs) {
      if (!isKubeezPlainObject(entry)) continue;
      const os = entry.optimization_status;
      if (typeof os === 'string' && os.toLowerCase() === 'failed') return true;
    }
  }
  return false;
}

/**
 * OpenAPI: `cdn_ready` on the job and/or per output. When URLs are still null, wait for CDN.
 *
 * Important: some responses expose a fetchable `https://media.kubeez.com/...` URL while a nested
 * `cdn_ready` flag is still `false`. Treat "has URL" as ready so we actually run the download.
 */
function outputsAwaitingCdn(data: unknown): boolean {
  const hasUrl =
    firstOutputMediaUrl(data, 'video') ?? firstOutputMediaUrl(data, 'image');
  if (hasUrl) return false;

  for (const o of collectMediaRoots(data)) {
    if (o.cdn_ready === false) return true;
    const outputs = o.outputs ?? o.media_outputs;
    if (!Array.isArray(outputs)) continue;
    for (const entry of outputs) {
      if (!isKubeezPlainObject(entry)) continue;
      if (entry.cdn_ready === false) return true;
    }
  }
  return false;
}

function extractErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const o = data as Record<string, unknown>;
  if (typeof o.error === 'string') return o.error;
  if (typeof o.message === 'string') return o.message;
  const detail = o.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail) && detail[0] && typeof detail[0] === 'object') {
    const d0 = detail[0] as Record<string, unknown>;
    if (typeof d0.msg === 'string') return d0.msg;
  }
  return undefined;
}

async function parseJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

/**
 * After SSE `result` or terminal poll payload: resolve CDN/output URLs and download (with GET refresh on 404).
 */
async function finalizeMediaGenerationFromStatus(
  statusBody: unknown,
  ctx: {
    root: string;
    apiKey: string;
    generationId: string;
    preferVideoOutput: boolean;
    signal?: AbortSignal;
  }
): Promise<Blob> {
  const { root, apiKey, generationId, preferVideoOutput, signal } = ctx;

  const status = extractKubeezPollStatus(statusBody);
  if (status === 'failed' || status === 'error') {
    throw new Error(extractErrorMessage(statusBody) ?? 'Media generation failed');
  }
  if (hasFailedOutputOptimization(statusBody)) {
    throw new Error(extractErrorMessage(statusBody) ?? 'Media output optimization failed');
  }

  let body: unknown = statusBody;
  const statusUrl = `${root}/v1/generate/media/${encodeURIComponent(generationId)}`;

  for (let d = 0; d < MEDIA_DOWNLOAD_RETRIES; d++) {
    if (outputsAwaitingCdn(body)) {
      if (import.meta.env.DEV && d === 0) {
        logger.debug('Kubeez — waiting for cdn_ready after completion');
      }
      await sleep(MEDIA_DOWNLOAD_RETRY_MS, signal);
      const r = await fetch(statusUrl, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
      if (r.ok) {
        body = await parseJsonResponse(r);
      }
      continue;
    }

    const prefer = preferVideoOutput ? 'video' : 'image';
    const mediaUrl =
      firstOutputMediaUrl(body, prefer) ?? firstOutputMediaUrl(body, prefer === 'video' ? 'image' : 'video');
    if (!mediaUrl) {
      await sleep(MEDIA_DOWNLOAD_RETRY_MS, signal);
      const r = await fetch(statusUrl, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
      if (r.ok) {
        body = await parseJsonResponse(r);
      }
      continue;
    }

    const fetchUrl = rewriteKubeezMediaCdnUrlForFetch(mediaUrl);
    const mediaRes = await fetch(fetchUrl, { mode: 'cors', signal });
    if (mediaRes.ok) {
      const rawCt = mediaRes.headers.get('content-type');
      const ct = (rawCt ?? '').toLowerCase();
      if (ct.includes('text/html')) {
        throw new Error(
          'Media download returned HTML (CDN proxy misconfigured). Map GET /api/kubeez/cdn/* to https://media.kubeez.com/* before /api/kubeez → api (see vercel.json).'
        );
      }
      const blob = await mediaRes.blob();
      const mime = rawCt?.split(';')[0]?.trim();
      if (mime && !blob.type) {
        return new Blob([blob], { type: mime });
      }
      return blob;
    }
    if (mediaRes.status === 404 && d < MEDIA_DOWNLOAD_RETRIES - 1) {
      await sleep(MEDIA_DOWNLOAD_RETRY_MS, signal);
      const r = await fetch(statusUrl, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
      if (r.ok) {
        body = await parseJsonResponse(r);
      }
      continue;
    }

    throw new Error(`Failed to download media (${mediaRes.status})`);
  }

  throw new Error('Media output not available after completion');
}

export interface GenerateTextToImageParams {
  apiKey: string;
  baseUrl?: string;
  prompt: string;
  aspectRatio?: string;
  model?: string;
  signal?: AbortSignal;
  /** Public URLs from POST /v1/upload/media — passed as `source_media_urls` on generate. */
  sourceMediaUrls?: string[];
  /**
   * When omitted: `image-to-image` if `sourceMediaUrls` is non-empty, else `text-to-image`.
   * Use `image-to-video` / `text-to-video` for video models when those flows are enabled.
   */
  generationType?: string;
  /** When false, `aspect_ratio` is omitted (e.g. fixed-aspect video models). Default true. */
  includeAspectRatio?: boolean;
  /** Passed to API when set (video models). */
  duration?: string;
  /** After completion, prefer downloading a video output vs an image. */
  preferVideoOutput?: boolean;
  /** Optional body field for models that accept it (e.g. P Image Edit `turbo`). */
  quality?: string;
  /** Optional body field for models that accept it (e.g. GPT Image 2 `1K|2K|4K`). */
  resolution?: string;
  /**
   * Body field `sound: boolean` for video models whose Kubeez `video_audio` capability is
   * `toggle_via_sound_param` (e.g. Seedance 2). Omitted when `undefined`.
   */
  sound?: boolean;
}

/**
 * Starts a Kubeez media job, prefers `GET /v1/generate/media/{id}/stream` (SSE), then polls GET status
 * if the stream fails, until complete — downloads primary output as a Blob.
 *
 * Contract (see https://api.kubeez.com/openapi.json):
 * - SSE: `event: result` carries the same JSON as GET /v1/generate/media/{id}.
 * - Poll: until outputs URLs are non-null (CDN). Same-origin `/api/kubeez/cdn/...` for downloads.
 */
export async function generateKubeezMediaBlob(params: GenerateTextToImageParams): Promise<Blob> {
  const {
    apiKey,
    baseUrl,
    prompt,
    aspectRatio = '1:1',
    model = KUBEEZ_MODEL_NANO_BANANA_2,
    signal,
    sourceMediaUrls,
    generationType: generationTypeParam,
    includeAspectRatio = true,
    duration,
    preferVideoOutput = false,
    quality,
    resolution,
    sound,
  } = params;

  const root = resolveKubeezApiBaseUrl(baseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const urls = sourceMediaUrls?.filter((u) => typeof u === 'string' && u.trim().length > 0) ?? [];
  const generationType =
    generationTypeParam ??
    (urls.length > 0 ? 'image-to-image' : 'text-to-image');

  // `model` must be the catalog’s concrete provider id. Image “quality” tiers (e.g. Nano Banana 2K/4K)
  // are separate model_ids in this API — not a shared base model plus a resolution body field.
  const body: Record<string, unknown> = {
    prompt,
    model,
    generation_type: generationType,
  };
  if (includeAspectRatio) {
    body.aspect_ratio = aspectRatio;
  }
  if (urls.length > 0) {
    body.source_media_urls = urls;
  }
  if (duration !== undefined && duration !== '') {
    body.duration = duration;
  }
  if (quality !== undefined && quality !== '') {
    body.quality = quality;
  }
  if (resolution !== undefined && resolution !== '') {
    body.resolution = resolution;
  }
  if (sound !== undefined) {
    body.sound = sound;
  }

  const startRes = await fetch(`${root}/v1/generate/media`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  const startBody = await parseJsonResponse(startRes);
  if (!startRes.ok) {
    const msg = extractErrorMessage(startBody) ?? `Kubeez request failed (${startRes.status})`;
    throw new Error(msg + (startRes.status === 405 ? KUBEEZ_CLIENT_HTTP_405_HINT : ''));
  }

  const generationId = extractGenerationId(startBody);
  if (!generationId) {
    logger.error('Unexpected Kubeez start response', startBody);
    throw new Error('Kubeez did not return a generation id');
  }

  if (import.meta.env.DEV) {
    logger.debug('Kubeez generation started', { generationId });
  }

  const streamUrl = `${root}/v1/generate/media/${encodeURIComponent(generationId)}/stream`;
  try {
    const streamedBody = await readKubeezSseUntilResult({ url: streamUrl, apiKey, signal });
    return await finalizeMediaGenerationFromStatus(streamedBody, {
      root,
      apiKey,
      generationId,
      preferVideoOutput,
      signal,
    });
  } catch (e) {
    if (import.meta.env.DEV) {
      logger.debug('Kubeez media SSE unavailable or failed; falling back to poll', e);
    }
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delay = attempt < POLL_ATTEMPTS_BEFORE_SLOW_POLL ? POLL_INTERVAL_FAST_MS : POLL_INTERVAL_SLOW_MS;
      await sleep(delay, signal);
    }

    const statusRes = await fetch(`${root}/v1/generate/media/${encodeURIComponent(generationId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    const statusBody = await parseJsonResponse(statusRes);
    if (!statusRes.ok) {
      // GET /v1/generate/media/{id} can return 404 until the job is visible; keep polling.
      if (statusRes.status === 404) {
        if (import.meta.env.DEV && attempt % 5 === 0) {
          logger.debug('Kubeez poll 404 — status not yet available', { generationId, attempt });
        }
        continue;
      }
      const msg = extractErrorMessage(statusBody) ?? `Status check failed (${statusRes.status})`;
      throw new Error(msg);
    }

    const status = extractKubeezPollStatus(statusBody);
    if (import.meta.env.DEV && attempt % 5 === 0) {
      logger.debug('Kubeez poll', { generationId, status, attempt });
    }

    if (status === 'failed' || status === 'error') {
      throw new Error(extractErrorMessage(statusBody) ?? 'Media generation failed');
    }

    if (hasFailedOutputOptimization(statusBody)) {
      throw new Error(extractErrorMessage(statusBody) ?? 'Media output optimization failed');
    }

    const terminalComplete =
      status === 'completed' ||
      status === 'complete' ||
      status === 'success' ||
      status === 'succeeded' ||
      status === 'ready' ||
      status === 'done' ||
      status === 'finished';

    if (terminalComplete) {
      try {
        return await finalizeMediaGenerationFromStatus(statusBody, {
          root,
          apiKey,
          generationId,
          preferVideoOutput,
          signal,
        });
      } catch (finalizeErr) {
        const msg = finalizeErr instanceof Error ? finalizeErr.message : '';
        const maybeRetry =
          msg.includes('not available after completion') || msg.includes('Failed to download media');
        if (!maybeRetry) {
          throw finalizeErr instanceof Error ? finalizeErr : new Error(String(finalizeErr));
        }
        if (import.meta.env.DEV && attempt % 3 === 0) {
          logger.debug('Kubeez poll — finalize retry (CDN / download)', { generationId, attempt });
        }
        continue;
      }
    }
  }

  throw new Error('Media generation timed out. Try again later.');
}

/** @deprecated Prefer `generateKubeezMediaBlob` */
export const generateTextToImageBlob = generateKubeezMediaBlob;

export function extensionFromMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'video/mp4') return 'mp4';
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/quicktime') return 'mov';
  return 'bin';
}
