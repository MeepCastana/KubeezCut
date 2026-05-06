/**
 * Kubeez credits balance — fetch, cache, and React hook.
 *
 * Caching strategy: stale-while-revalidate with two tiers:
 * - Fresh (< 60 s): serve from localStorage, skip network.
 * - Stale (60 s – 10 min): serve from localStorage, revalidate in background.
 * - Expired (> 10 min): fetch from network, block until response.
 *
 * The dialog polls every 60 s while open so the balance stays up-to-date
 * after a generation deducts credits on the server.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveKubeezApiBaseUrl } from './kubeez-text-to-image';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('KubeezCredits');

// ---------------------------------------------------------------------------
// Cache constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'kubeezcut:kubeez-credits:v1';
/** Serve from cache without a network hit. */
const FRESH_MS = 60_000; // 1 min
/** Maximum age before the cached value is discarded entirely. */
const MAX_AGE_MS = 10 * 60_000; // 10 min
/** Polling interval while the dialog is open. */
const POLL_MS = 60_000; // 1 min

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

interface CreditsCacheEntry {
  credits: number;
  savedAt: number;
}

function readCache(): CreditsCacheEntry | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as CreditsCacheEntry).credits === 'number' &&
      typeof (parsed as CreditsCacheEntry).savedAt === 'number'
    ) {
      return parsed as CreditsCacheEntry;
    }
  } catch { /* ignore */ }
  return null;
}

function writeCache(credits: number): void {
  try {
    const entry: CreditsCacheEntry = { credits, savedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch { /* quota / private mode */ }
}

function isCacheFresh(): boolean {
  const entry = readCache();
  return entry != null && Date.now() - entry.savedAt < FRESH_MS;
}

function isCacheUsable(): boolean {
  const entry = readCache();
  return entry != null && Date.now() - entry.savedAt < MAX_AGE_MS;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/**
 * Set to true after the first 404 so we stop hitting an endpoint that doesn't exist.
 * Resets on page reload. Once the API adds a credits endpoint, this naturally clears.
 */
let endpointMissing = false;

export async function fetchKubeezCredits(params: {
  apiKey: string;
  baseUrl?: string;
  signal?: AbortSignal;
}): Promise<number | null> {
  if (endpointMissing) return null;

  const root = resolveKubeezApiBaseUrl(params.baseUrl);
  const url = `${root}/v1/balance`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${params.apiKey}` },
      signal: params.signal,
    });

    if (!res.ok) {
      if (res.status === 404) endpointMissing = true;
      return null;
    }

    const body = (await res.json()) as unknown;
    if (body && typeof body === 'object') {
      const credits =
        (body as Record<string, unknown>).credits ??
        (body as Record<string, unknown>).balance ??
        (body as Record<string, unknown>).total;
      if (typeof credits === 'number' && Number.isFinite(credits)) {
        writeCache(credits);
        return credits;
      }
    }

    logger.debug('Credits response missing numeric credits field', body);
    return null;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    logger.debug('Credits fetch error', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export function useKubeezCredits(params: {
  apiKey: string | undefined;
  baseUrl: string | undefined;
  enabled: boolean;
}): { credits: number | null; loading: boolean; refresh: () => void; deduct: (amount: number) => void } {
  const { apiKey, baseUrl, enabled } = params;
  const [credits, setCredits] = useState<number | null>(() => readCache()?.credits ?? null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const doFetch = useCallback(
    async (background: boolean) => {
      if (!apiKey) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      if (!background) setLoading(true);

      const result = await fetchKubeezCredits({
        apiKey,
        baseUrl: baseUrl?.trim() || undefined,
        signal: ac.signal,
      });

      if (!ac.signal.aborted) {
        if (result != null) setCredits(result);
        if (!background) setLoading(false);
      }
    },
    [apiKey, baseUrl]
  );

  const refresh = useCallback(() => void doFetch(false), [doFetch]);

  /** Optimistically deduct credits and schedule a background refresh to sync with the server. */
  const deduct = useCallback((amount: number) => {
    setCredits((prev) => (prev != null ? Math.max(0, prev - amount) : prev));
    // Sync with server after a short delay (gives the backend time to process)
    setTimeout(() => void doFetch(true), 3000);
  }, [doFetch]);

  // Initial fetch + polling
  useEffect(() => {
    if (!enabled || !apiKey) return;

    // Hydrate from cache immediately
    const cached = readCache();
    if (cached != null) {
      setCredits(cached.credits);
    }

    // If cache is fresh, skip the initial network call
    if (!isCacheFresh()) {
      void doFetch(!isCacheUsable()); // block UI only if cache is unusable
    }

    // Poll while the dialog is open
    const interval = setInterval(() => {
      void doFetch(true); // always background for polls
    }, POLL_MS);

    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [enabled, apiKey, doFetch]);

  return { credits, loading, refresh, deduct };
}
