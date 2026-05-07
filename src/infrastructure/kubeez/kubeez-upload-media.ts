import { createLogger } from '@/shared/logging/logger';
import { resolveKubeezApiBaseUrl } from './kubeez-text-to-image';
import { buildKubeezApiHeaders } from './kubeez-client-headers';

const logger = createLogger('KubeezUpload');

function extractErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const o = data as Record<string, unknown>;
  if (typeof o.error === 'string') return o.error;
  if (typeof o.message === 'string') return o.message;
  const detail = o.detail;
  if (typeof detail === 'string') return detail;
  return undefined;
}

/** Collect public URLs returned by POST /v1/upload/media (shape may vary slightly). */
export function extractUploadedMediaUrls(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const o = body as Record<string, unknown>;

  const asUrl = (v: unknown): string | null =>
    typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : null;

  const singleKeys = ['url', 'media_url', 'public_url', 'file_url', 'src', 'uploaded_url'] as const;
  for (const key of singleKeys) {
    const u = asUrl(o[key]);
    if (u) return [u];
  }

  const arrayKeys = ['urls', 'media_urls', 'public_urls', 'files'] as const;
  for (const key of arrayKeys) {
    const arr = o[key];
    if (!Array.isArray(arr)) continue;
    const out = arr.map(asUrl).filter((x): x is string => x !== null);
    if (out.length > 0) return out;
  }

  if (o.data && typeof o.data === 'object') {
    return extractUploadedMediaUrls(o.data);
  }

  return [];
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

export interface UploadKubeezMediaFileParams {
  apiKey: string;
  baseUrl?: string;
  file: File;
  signal?: AbortSignal;
  /** Query param; default matches Kubeez API. */
  bucket?: string;
}

/**
 * Uploads one file to Kubeez (POST /v1/upload/media). Returns public URL(s) for use as
 * `source_media_urls` on POST /v1/generate/media.
 */
export async function uploadKubeezMediaFile(params: UploadKubeezMediaFileParams): Promise<string[]> {
  const { apiKey, baseUrl, file, signal, bucket } = params;
  const root = resolveKubeezApiBaseUrl(baseUrl);

  const form = new FormData();
  form.append('file', file);

  const q = new URLSearchParams();
  if (bucket?.trim()) q.set('bucket', bucket.trim());

  const url = `${root}/v1/upload/media${q.toString() ? `?${q}` : ''}`;

  const res = await fetch(url, {
    method: 'POST',
    // FormData sets its own Content-Type w/ boundary — don't override.
    headers: buildKubeezApiHeaders({ apiKey }),
    body: form,
    signal,
  });

  const body = await parseJsonResponse(res);
  if (!res.ok) {
    const msg = extractErrorMessage(body) ?? `Upload failed (${res.status})`;
    throw new Error(msg);
  }

  const urls = extractUploadedMediaUrls(body);
  if (urls.length === 0) {
    if (import.meta.env.DEV) {
      logger.debug('Unexpected upload response shape', body);
    }
    throw new Error('Upload succeeded but no media URL was returned.');
  }

  return urls;
}
