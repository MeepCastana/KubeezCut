/**
 * Resolves the auth token KubeezCut should send to api.kubeez.com.
 *
 * Priority:
 *   1. Live Supabase session → `session.access_token` (a JWT). The REST API
 *      auto-detects the JWT shape on `Authorization: Bearer …` and validates
 *      against `SUPABASE_JWT_SECRET`.
 *   2. User-pasted API key from settings (legacy / OSS standalone path).
 *
 * Callers pass `token` straight into the existing `apiKey` parameter on the
 * REST helpers — the wire-level `Authorization: Bearer ${token}` header
 * works for both `eyJ…` JWTs and `sk_live_…` keys.
 */

import { useSettingsStore } from '@/features/settings/stores/settings-store';
import { useKubeezSession } from './use-kubeez-session';

export type KubeezAuthSource = 'session' | 'api-key' | null;

export interface EffectiveKubeezToken {
  /** Empty string when no auth is available (callers can guard with `hasAuth`). */
  token: string;
  source: KubeezAuthSource;
  /** True iff token is non-empty (session JWT or pasted key). */
  hasAuth: boolean;
  /** Convenience: true while we're waiting for the first auth-state event. */
  loading: boolean;
}

export function useEffectiveKubeezToken(): EffectiveKubeezToken {
  const storedApiKey = useSettingsStore((s) => s.kubeezApiKey);
  const { session, loading } = useKubeezSession();

  const sessionToken = session?.access_token;
  if (sessionToken) {
    return { token: sessionToken, source: 'session', hasAuth: true, loading: false };
  }

  const trimmed = storedApiKey?.trim() ?? '';
  if (trimmed) {
    return { token: trimmed, source: 'api-key', hasAuth: true, loading };
  }

  return { token: '', source: null, hasAuth: false, loading };
}
