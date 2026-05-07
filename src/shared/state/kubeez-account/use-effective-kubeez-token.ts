/**
 * Resolves the auth token KubeezCut should send to api.kubeez.com.
 *
 * Always the live Supabase session JWT — there is no other path. Callers
 * pass `token` straight into the existing `apiKey` parameter on the REST
 * helpers; the wire-level `Authorization: Bearer eyJ…` header is what
 * api.kubeez.com auto-detects (`_validate_supabase_jwt`).
 */

import { useKubeezSession } from './use-kubeez-session';

export type KubeezAuthSource = 'session' | null;

export interface EffectiveKubeezToken {
  /** Empty string when no auth is available (callers can guard with `hasAuth`). */
  token: string;
  source: KubeezAuthSource;
  /** True iff token is non-empty. */
  hasAuth: boolean;
  /** True while we're waiting for the first auth-state event. */
  loading: boolean;
}

export function useEffectiveKubeezToken(): EffectiveKubeezToken {
  const { session, loading } = useKubeezSession();

  const sessionToken = session?.access_token;
  if (sessionToken) {
    return { token: sessionToken, source: 'session', hasAuth: true, loading: false };
  }

  return { token: '', source: null, hasAuth: false, loading };
}
