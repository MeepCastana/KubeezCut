import { rewriteKubeezMediaCdnUrlForFetch } from '@/infrastructure/kubeez/kubeez-cdn-fetch-url';
import { extractKubeezPollStatus, isKubeezPlainObject } from '@/infrastructure/kubeez/kubeez-poll-status';
import { readKubeezSseUntilResult } from '@/infrastructure/kubeez/kubeez-sse';
import { createLogger } from '@/shared/logging/logger';
import { DEFAULT_VOICE_ID, TEXT_TO_DIALOGUE_VOICES, type VoiceCategory } from '@/infrastructure/kubeez/kubeez-dialogue-voices';
import { KUBEEZ_CLIENT_HTTP_405_HINT, resolveKubeezApiBaseUrl } from './kubeez-text-to-image';

const logger = createLogger('KubeezAudio');

/** Voice ids/labels/categories from `kubeez-dialogue-voices.ts`. */
export const KUBEEZ_DIALOGUE_VOICE_OPTIONS: { id: string; label: string; category?: VoiceCategory }[] =
  TEXT_TO_DIALOGUE_VOICES.map(({ id, label, category }) => ({ id, label, category }));

/** Default voice id for speech generation (first entry in website catalog). */
export const KUBEEZ_DEFAULT_DIALOGUE_VOICE_ID = DEFAULT_VOICE_ID;

export const KUBEEZ_DIALOGUE_LANGUAGE_OPTIONS: { id: string; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Spanish' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'ro', label: 'Romanian' },
  { id: 'it', label: 'Italian' },
  { id: 'pt', label: 'Portuguese' },
];

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 150;
const MUSIC_SSE_REFRESH_MS = 1000;
const MUSIC_STREAM_STATUS_RETRIES = 10;

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

function extractGenerationId(data: unknown): string | null {
  if (!isKubeezPlainObject(data)) return null;
  const pickId = (o: Record<string, unknown>): string | null => {
    const id = o.generation_id ?? o.id ?? o.generationId ?? o.task_id ?? o.taskId;
    return typeof id === 'string' && id.length > 0 ? id : null;
  };
  const top = pickId(data);
  if (top) return top;
  // Check nested wrappers (API may return { data: { generation_id: ... } })
  for (const k of ['data', 'result', 'generation', 'job'] as const) {
    const nested = data[k];
    if (isKubeezPlainObject(nested)) {
      const id = pickId(nested);
      if (id) return id;
    }
  }
  return null;
}

const URL_VALUE_KEYS = [
  'url',
  'audio_url',
  'file_url',
  'signed_url',
  'public_url',
  'download_url',
  'media_url',
  'href',
  'src',
  'output_url',
  'stream_url',
] as const;

function isLikelyHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function pickUrlFromObject(obj: Record<string, unknown>): string | null {
  for (const k of URL_VALUE_KEYS) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0 && isLikelyHttpUrl(v)) return v.trim();
  }
  return null;
}

/** Resolves URL on the object or nested file/asset/media/output shapes. */
function pickUrlDeep(obj: Record<string, unknown>): string | null {
  const direct = pickUrlFromObject(obj);
  if (direct) return direct;
  for (const nest of ['file', 'asset', 'media', 'output']) {
    const n = obj[nest];
    if (isKubeezPlainObject(n)) {
      const u = pickUrlFromObject(n);
      if (u) return u;
    }
  }
  return null;
}

/** Music API `songs[]`: `audio_url` when ready, else `stream_url` (often non-null while `audio_url` is null). */
function pickSongPlaybackUrl(song: Record<string, unknown>): string | null {
  const au = song.audio_url;
  if (typeof au === 'string' && au.length > 0 && isLikelyHttpUrl(au)) return au.trim();
  const su = song.stream_url;
  if (typeof su === 'string' && su.length > 0 && isLikelyHttpUrl(su)) return su.trim();
  return pickUrlDeep(song);
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

function collectCandidateRoots(data: unknown): Record<string, unknown>[] {
  if (!isKubeezPlainObject(data)) return [];
  const roots: Record<string, unknown>[] = [data];
  const nestedKeys = ['result', 'data', 'generation', 'job', 'payload'] as const;
  for (const k of nestedKeys) {
    const v = data[k];
    if (isKubeezPlainObject(v)) roots.push(v);
  }
  return roots;
}

function urlFromOutputEntry(entry: Record<string, unknown>): { url: string | null; mediaType: string } {
  const mt = typeof entry.media_type === 'string' ? entry.media_type.toLowerCase() : '';
  return { url: pickUrlDeep(entry), mediaType: mt };
}

function extractAudioUrlFromRoots(roots: Record<string, unknown>[]): string | null {
  let audioMatch: string | null = null;
  let anyHttp: string | null = null;

  const consider = (url: string | null, mediaType: string, treatAsAudio: boolean) => {
    if (!url) return;
    if (!anyHttp) anyHttp = url;
    if (treatAsAudio || mediaType.startsWith('audio')) {
      audioMatch = url;
    }
  };

  for (const root of roots) {
    const outputs = root.outputs ?? root.media_outputs;
    if (Array.isArray(outputs)) {
      for (const entry of outputs) {
        if (!isKubeezPlainObject(entry)) continue;
        const { url, mediaType } = urlFromOutputEntry(entry);
        consider(url, mediaType, false);
      }
    }

    const songs = root.songs;
    if (Array.isArray(songs)) {
      for (const s of songs) {
        if (!isKubeezPlainObject(s)) continue;
        const url = pickSongPlaybackUrl(s);
        consider(url, 'audio/unknown', true);
      }
    }

    if (isKubeezPlainObject(root.output)) {
      const url = pickUrlDeep(root.output);
      const mt =
        typeof root.output.media_type === 'string' ? root.output.media_type.toLowerCase() : '';
      consider(url, mt, false);
    }

    const top = pickUrlFromObject(root);
    consider(top, '', false);
  }

  return audioMatch ?? anyHttp;
}

/** First audio URL from Kubeez music / dialogue status or completion payloads. */
export function firstAudioOutputUrl(data: unknown): string | null {
  const roots = collectCandidateRoots(data);
  if (roots.length === 0) return null;
  return extractAudioUrlFromRoots(roots);
}

export function audioExtensionFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === 'audio/mpeg' || m === 'audio/mp3') return 'mp3';
  if (m === 'audio/wav' || m === 'audio/x-wav') return 'wav';
  if (m === 'audio/ogg' || m === 'audio/opus') return 'ogg';
  if (m === 'audio/aac' || m === 'audio/mp4' || m === 'audio/x-m4a') return 'aac';
  if (m === 'audio/flac') return 'flac';
  return 'mp3';
}

async function downloadAudioUrl(url: string, signal?: AbortSignal): Promise<Blob> {
  const fetchUrl = rewriteKubeezMediaCdnUrlForFetch(url);
  const mediaRes = await fetch(fetchUrl, { mode: 'cors', signal });
  if (!mediaRes.ok) {
    throw new Error(`Failed to download audio (${mediaRes.status})`);
  }
  return mediaRes.blob();
}

export interface KubeezMusicFileResult {
  blob: Blob;
  suggestedFileName: string;
}

function sanitizeMusicFileBase(title: string, index: number, runTs: number): string {
  const raw = (title || '').trim() || `variant-${index + 1}`;
  const safe = raw
    .replace(/[<>:"/\\|?*]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 48)
    .replace(/^-+|-+$/g, '');
  return `kubeez-music-${safe || `track-${index + 1}`}-${runTs}-${index + 1}`;
}

/**
 * True when every entry in `songs[]` has a final `audio_url` (not just a `stream_url`).
 * While the API is still rendering, some songs may only have `stream_url`; downloading those
 * yields an incomplete/streaming asset instead of the finished audio file.
 */
function allSongsHaveFinalAudioUrl(data: unknown): boolean {
  const roots = collectCandidateRoots(data);
  for (const root of roots) {
    const songs = root.songs;
    if (!Array.isArray(songs) || songs.length === 0) continue;
    for (const s of songs) {
      if (!isKubeezPlainObject(s)) return false;
      const au = s.audio_url;
      if (typeof au !== 'string' || au.length === 0 || !isLikelyHttpUrl(au)) return false;
    }
  }
  return true;
}

/** Collect one entry per `songs[]` row with a playable URL (`audio_url` or `stream_url`). */
function collectMusicSongSpecsFromPayload(data: unknown): { url: string; fileBase: string }[] {
  const runTs = Date.now();
  const roots = collectCandidateRoots(data);
  const out: { url: string; fileBase: string }[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    const songs = root.songs;
    if (!Array.isArray(songs)) continue;
    songs.forEach((s, index) => {
      if (!isKubeezPlainObject(s)) return;
      const url = pickSongPlaybackUrl(s);
      if (!url || seen.has(url)) return;
      seen.add(url);
      const title = typeof s.title === 'string' ? s.title : '';
      out.push({ url, fileBase: sanitizeMusicFileBase(title, index, runTs) });
    });
  }
  return out;
}

async function downloadMusicFileResultsFromSpecs(
  specs: { url: string; fileBase: string }[],
  signal?: AbortSignal
): Promise<KubeezMusicFileResult[]> {
  return Promise.all(
    specs.map(async ({ url, fileBase }) => {
      const blob = await downloadAudioUrl(url, signal);
      const ext = audioExtensionFromMime(blob.type || 'audio/mpeg');
      return { blob, suggestedFileName: `${fileBase}.${ext}` };
    })
  );
}

/**
 * When status is complete: download all `songs[]` variants or a single legacy output URL.
 *
 * @param acceptStreamUrls When false (default), only resolves when **all** songs have their
 *   final `audio_url`. Pass true as a last-resort fallback when the status is terminal but
 *   `audio_url` never appeared — in that case `stream_url` is accepted so we don't hang.
 */
async function tryResolveMusicCompletionPayload(
  body: unknown,
  signal?: AbortSignal,
  acceptStreamUrls = false,
): Promise<KubeezMusicFileResult[] | null> {
  // Only proceed when every song has its final `audio_url`; while the API is still
  // rendering, some songs may only carry a `stream_url` (incomplete / streaming asset).
  if (!acceptStreamUrls && !allSongsHaveFinalAudioUrl(body)) {
    return null;
  }

  const specs = collectMusicSongSpecsFromPayload(body);
  if (specs.length > 0) {
    return downloadMusicFileResultsFromSpecs(specs, signal);
  }
  const singleUrl = firstAudioOutputUrl(body);
  if (singleUrl) {
    const blob = await downloadAudioUrl(singleUrl, signal);
    const ext = audioExtensionFromMime(blob.type || 'audio/mpeg');
    return [{ blob, suggestedFileName: `kubeez-music-${Date.now()}.${ext}` }];
  }
  return null;
}

/**
 * Each poll tick: prefer `GET /v1/generate/music/{id}`; on 404 only, try unified media status.
 * Never permanently switch to only the media URL — early music 404 is often "not registered yet",
 * while later 200s (with songs) appear only on the music route for music jobs.
 */
async function fetchMusicJobStatusOr404Pair(params: {
  root: string;
  apiKey: string;
  generationId: string;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; body: unknown; via: 'music' | 'media' }
  | { ok: false; kind: 'not_ready' }
  | { ok: false; kind: 'error'; message: string }
> {
  const { root, apiKey, generationId, signal } = params;
  const musicUrl = `${root}/v1/generate/music/${encodeURIComponent(generationId)}`;
  const mediaUrl = `${root}/v1/generate/media/${encodeURIComponent(generationId)}`;
  const headers = { Authorization: `Bearer ${apiKey}` };

  const musicRes = await fetch(musicUrl, { headers, signal });
  const musicBody = await parseJsonResponse(musicRes);

  if (musicRes.ok) {
    return { ok: true, body: musicBody, via: 'music' };
  }

  if (musicRes.status === 404) {
    const mediaRes = await fetch(mediaUrl, { headers, signal });
    const mediaBody = await parseJsonResponse(mediaRes);
    if (mediaRes.ok) {
      return { ok: true, body: mediaBody, via: 'media' };
    }
    if (mediaRes.status === 404) {
      return { ok: false, kind: 'not_ready' };
    }
    const msg =
      extractErrorMessage(mediaBody) ?? `Music status check failed (${mediaRes.status})`;
    return { ok: false, kind: 'error', message: msg };
  }

  const msg =
    extractErrorMessage(musicBody) ?? `Music status check failed (${musicRes.status})`;
  return { ok: false, kind: 'error', message: msg };
}

async function pollKubeezMusicJob(params: {
  root: string;
  apiKey: string;
  generationId: string;
  signal?: AbortSignal;
}): Promise<KubeezMusicFileResult[]> {
  const { root, apiKey, generationId, signal } = params;
  const mediaUrl = `${root}/v1/generate/media/${encodeURIComponent(generationId)}`;
  const musicUrl = `${root}/v1/generate/music/${encodeURIComponent(generationId)}`;
  const musicStreamUrl = `${root}/v1/generate/music/${encodeURIComponent(generationId)}/stream`;

  try {
    const streamed = await readKubeezSseUntilResult({ url: musicStreamUrl, apiKey, signal });
    const fromStream = await tryResolveMusicCompletionPayload(streamed, signal);
    if (fromStream && fromStream.length > 0) {
      return fromStream;
    }
    for (let r = 0; r < MUSIC_STREAM_STATUS_RETRIES; r++) {
      await sleep(MUSIC_SSE_REFRESH_MS, signal);
      const polled = await fetchMusicJobStatusOr404Pair({ root, apiKey, generationId, signal });
      if (!polled.ok) {
        if (polled.kind === 'error') {
          throw new Error(polled.message);
        }
        continue;
      }
      const resolved = await tryResolveMusicCompletionPayload(polled.body, signal);
      if (resolved && resolved.length > 0) {
        return resolved;
      }
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      logger.debug('Kubeez music SSE failed or incomplete; using poll', e);
    }
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS, signal);

    const polled = await fetchMusicJobStatusOr404Pair({ root, apiKey, generationId, signal });

    if (!polled.ok) {
      if (polled.kind === 'not_ready') {
        if (import.meta.env.DEV && attempt % 5 === 0) {
          logger.debug('Kubeez music poll 404 — status not yet available (music + media)', {
            generationId,
            attempt,
          });
        }
        continue;
      }
      throw new Error(polled.message);
    }

    const { body: statusBody, via } = polled;
    const status = extractKubeezPollStatus(statusBody);
    if (import.meta.env.DEV && attempt % 5 === 0) {
      logger.debug('Kubeez music poll', { generationId, status, attempt, via });
    }

    if (status === 'failed' || status === 'error') {
      throw new Error(extractErrorMessage(statusBody) ?? 'Music generation failed');
    }

    const resolvedNow = await tryResolveMusicCompletionPayload(statusBody, signal);
    if (resolvedNow && resolvedNow.length > 0) {
      return resolvedNow;
    }

    // 'streaming' is intentionally NOT terminal — songs are still being rendered
    // and may only have stream_url (not the final audio_url) at this point.
    const terminalOk =
      status === 'completed' ||
      status === 'complete' ||
      status === 'success' ||
      status === 'succeeded' ||
      status === 'ready' ||
      status === 'done' ||
      status === 'finished';

    if (terminalOk) {
      // Terminal: try the other endpoint first (with final audio_url requirement)
      const otherUrl = via === 'music' ? mediaUrl : musicUrl;
      const otherRes = await fetch(otherUrl, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
      if (otherRes.ok) {
        const otherBody = await parseJsonResponse(otherRes);
        const resolvedOther = await tryResolveMusicCompletionPayload(otherBody, signal);
        if (resolvedOther && resolvedOther.length > 0) {
          return resolvedOther;
        }
      }
      // Last resort: accept stream_url when the status is terminal but audio_url never appeared.
      const resolvedFallback = await tryResolveMusicCompletionPayload(statusBody, signal, true);
      if (resolvedFallback && resolvedFallback.length > 0) {
        return resolvedFallback;
      }

      if (import.meta.env.DEV && attempt % 5 === 0) {
        logger.debug('Kubeez music poll — terminal but audio URLs not ready yet', {
          generationId,
          attempt,
          via,
        });
      }
      continue;
    }
  }

  throw new Error('Music generation timed out. Try again later.');
}

async function pollKubeezDialogueJob(params: {
  root: string;
  apiKey: string;
  generationId: string;
  signal?: AbortSignal;
}): Promise<Blob> {
  const { root, apiKey, generationId, signal } = params;
  /** OpenAPI: dialogue jobs track on **media** status / stream, not `/generate/dialogue/{id}`. */
  const pollUrl = `${root}/v1/generate/media/${encodeURIComponent(generationId)}`;
  const mediaStreamUrl = `${pollUrl}/stream`;

  try {
    const streamed = await readKubeezSseUntilResult({ url: mediaStreamUrl, apiKey, signal });
    const status = extractKubeezPollStatus(streamed);
    if (status === 'failed' || status === 'error') {
      throw new Error(extractErrorMessage(streamed) ?? 'Audio generation failed');
    }
    const audioUrl = firstAudioOutputUrl(streamed);
    if (audioUrl) {
      return downloadAudioUrl(audioUrl, signal);
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      logger.debug('Kubeez dialogue SSE failed; polling media status', e);
    }
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await sleep(POLL_INTERVAL_MS, signal);
    }

    const statusRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    const statusBody = await parseJsonResponse(statusRes);

    if (!statusRes.ok) {
      if (statusRes.status === 404) {
        if (import.meta.env.DEV && attempt % 5 === 0) {
          logger.debug('Kubeez dialogue poll 404 — status not yet available', {
            generationId,
            attempt,
          });
        }
        continue;
      }
      const msg = extractErrorMessage(statusBody) ?? `Status check failed (${statusRes.status})`;
      throw new Error(msg);
    }

    const status = extractKubeezPollStatus(statusBody);
    if (import.meta.env.DEV && attempt % 5 === 0) {
      logger.debug('Kubeez dialogue poll', { generationId, status, attempt });
    }

    if (status === 'failed' || status === 'error') {
      throw new Error(extractErrorMessage(statusBody) ?? 'Audio generation failed');
    }

    const terminalOk =
      status === 'completed' ||
      status === 'complete' ||
      status === 'success' ||
      status === 'succeeded' ||
      status === 'ready' ||
      status === 'done' ||
      status === 'finished';

    if (terminalOk) {
      const audioUrl = firstAudioOutputUrl(statusBody);
      if (audioUrl) {
        return downloadAudioUrl(audioUrl, signal);
      }

      if (import.meta.env.DEV && attempt % 5 === 0) {
        logger.debug('Kubeez dialogue poll — terminal but no audio URL yet', {
          generationId,
          attempt,
        });
      }
      continue;
    }
  }

  throw new Error('Audio generation timed out. Try again later.');
}

export interface GenerateKubeezMusicParams {
  apiKey: string;
  baseUrl?: string;
  prompt: string;
  instrumental?: boolean;
  /** Kubeez music engine id (e.g. V5, V4) — must match API. */
  model?: string;
  signal?: AbortSignal;
}

/**
 * POST /v1/generate/music, poll until complete, download every `songs[]` variant (or one legacy output).
 */
export async function generateKubeezMusicFiles(
  params: GenerateKubeezMusicParams
): Promise<KubeezMusicFileResult[]> {
  const { apiKey, baseUrl, prompt, instrumental = false, model = 'V5', signal } = params;

  const root = resolveKubeezApiBaseUrl(baseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const startRes = await fetch(`${root}/v1/generate/music`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt,
      instrumental,
      model,
    }),
    signal,
  });

  const startBody = await parseJsonResponse(startRes);
  if (!startRes.ok) {
    const msg = extractErrorMessage(startBody) ?? `Kubeez music request failed (${startRes.status})`;
    throw new Error(msg + (startRes.status === 405 ? KUBEEZ_CLIENT_HTTP_405_HINT : ''));
  }

  const immediate = await tryResolveMusicCompletionPayload(startBody, signal);
  if (immediate && immediate.length > 0) {
    if (import.meta.env.DEV) {
      logger.debug('Kubeez music completed inline', { count: immediate.length });
    }
    return immediate;
  }

  const generationId = extractGenerationId(startBody);
  if (!generationId) {
    logger.error('Unexpected Kubeez music start response', startBody);
    throw new Error('Kubeez did not return a music generation id');
  }

  if (import.meta.env.DEV) {
    logger.debug('Kubeez music generation started', { generationId });
  }

  return pollKubeezMusicJob({ root, apiKey, generationId, signal });
}

/** @deprecated Prefer `generateKubeezMusicFiles` when the API returns multiple `songs`. */
export async function generateKubeezMusicBlob(params: GenerateKubeezMusicParams): Promise<Blob> {
  const files = await generateKubeezMusicFiles(params);
  const first = files[0];
  if (!first) {
    throw new Error('No music file returned');
  }
  return first.blob;
}

export interface KubeezDialogueLine {
  text: string;
  voice?: string;
}

export interface GenerateKubeezDialogueParams {
  apiKey: string;
  baseUrl?: string;
  dialogue: KubeezDialogueLine[];
  stability?: number;
  language_code?: string;
  signal?: AbortSignal;
}

/**
 * POST /v1/generate/dialogue, poll GET /v1/generate/dialogue/{id} when async.
 * (Public OpenAPI lists only POST; status route follows the same pattern as music.)
 */
export async function generateKubeezDialogueBlob(params: GenerateKubeezDialogueParams): Promise<Blob> {
  const {
    apiKey,
    baseUrl,
    dialogue,
    stability = 0.5,
    language_code = 'auto',
    signal,
  } = params;

  if (!dialogue.length || !dialogue.some((d) => d.text.trim().length > 0)) {
    throw new Error('Add at least one line of dialogue text.');
  }

  const root = resolveKubeezApiBaseUrl(baseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const payload = {
    model: 'text-to-dialogue-v3',
    dialogue: dialogue.map((d) => ({
      text: d.text,
      ...(d.voice !== undefined && d.voice !== '' ? { voice: d.voice } : {}),
    })),
    stability,
    language_code,
  };

  const startRes = await fetch(`${root}/v1/generate/dialogue`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  const startBody = await parseJsonResponse(startRes);
  if (!startRes.ok) {
    const msg = extractErrorMessage(startBody) ?? `Kubeez dialogue request failed (${startRes.status})`;
    throw new Error(msg + (startRes.status === 405 ? KUBEEZ_CLIENT_HTTP_405_HINT : ''));
  }

  const immediateUrl = firstAudioOutputUrl(startBody);
  if (immediateUrl) {
    if (import.meta.env.DEV) {
      logger.debug('Kubeez dialogue completed inline', {});
    }
    return downloadAudioUrl(immediateUrl, signal);
  }

  const generationId = extractGenerationId(startBody);
  if (!generationId) {
    logger.error('Unexpected Kubeez dialogue start response', startBody);
    throw new Error('Kubeez did not return a dialogue generation id');
  }

  if (import.meta.env.DEV) {
    logger.debug('Kubeez dialogue generation started', { generationId });
  }

  return pollKubeezDialogueJob({ root, apiKey, generationId, signal });
}
