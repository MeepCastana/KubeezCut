/**
 * Supabase client for KubeezCut.
 *
 * Uses the same Supabase project as kubeez.com so a session signed in on
 * the apex (or via the SSO bounceback flow) is automatically visible on
 * editor.kubeez.com. The cross-subdomain cookie storage adapter handles
 * the actual cookie/localStorage tradeoff per origin.
 *
 * Env vars (set in Vercel project settings + .env.local for dev):
 *   - VITE_SUPABASE_URL              same as kubeez.com
 *   - VITE_SUPABASE_PUBLISHABLE_KEY  same as kubeez.com
 *
 * If either is missing, the client falls back to a no-op shim so the
 * editor still loads (KubeezCut is local-first; AI features just stay
 * locked with a "configure to unlock Kubeez" hint).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createCrossSubdomainStorage } from './cross-subdomain-storage';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('SupabaseClient');

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_PUBLISHABLE_KEY =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

if (!isSupabaseConfigured) {
  logger.warn(
    'Supabase env not configured — Kubeez account features (sign-in, AI generation) will stay locked. ' +
      'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable.'
  );
}

// In-process serialization for GoTrue. Default `navigator.locks` has wedged
// before during cross-subdomain OAuth hops on kubeez.com — same-tab Promise
// chaining is all we actually need here.
let goTrueLockChain: Promise<unknown> = Promise.resolve();
const inProcessLock = <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
  const next = goTrueLockChain.catch(() => undefined).then(() => fn());
  goTrueLockChain = next.catch(() => undefined);
  return next;
};

function buildClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  return createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    auth: {
      storage: createCrossSubdomainStorage(),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      lock: inProcessLock,
    },
    global: {
      headers: {
        'x-client-info': 'kubeezcut-web',
      },
    },
  });
}

/**
 * Live client when env is configured, otherwise null. Callers should treat
 * `null` as "Kubeez account integration unavailable" and fall back to the
 * existing OSS local-only flow.
 */
export const supabase: SupabaseClient | null = buildClient();
