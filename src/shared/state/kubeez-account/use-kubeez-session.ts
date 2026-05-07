/**
 * Kubeez account session — single hook the editor uses to gate AI features.
 *
 * Subscribes to Supabase auth state. Hydrates synchronously from the
 * persisted session so users coming from kubeez.com via the `.kubeez.com`
 * cookie don't flash an "Sign in" CTA before recognising the session.
 *
 * `signIn()` bounces to kubeez.com/auth?redirect_to=<here> — kubeez handles
 * the actual login (email/password, Google, etc.) and sends the user back.
 *
 * `signOut()` clears the session locally AND wipes the cross-subdomain
 * cookie so kubeez.com gets signed out too — that's what users expect
 * from a "Sign out" affordance on a sibling app.
 */

import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/infrastructure/supabase/client';
import { clearAllSupabaseAuthStorage } from '@/infrastructure/supabase/cross-subdomain-storage';
import { createLogger } from '@/shared/logging/logger';
import { clearKubeezProfileCache } from './use-kubeez-profile';

const logger = createLogger('KubeezSession');

const KUBEEZ_AUTH_URL = 'https://kubeez.com/auth';

export interface KubeezSessionState {
  session: Session | null;
  user: User | null;
  /** True until the first auth-state event resolves (or immediately when unconfigured). */
  loading: boolean;
  /** False when env vars are missing — UI should hide sign-in and fall back to OSS flow. */
  isConfigured: boolean;
  /** Redirects the browser to kubeez.com/auth with a sanitized return URL. */
  signIn: () => void;
  /** Signs out locally and on every *.kubeez.com origin (clears the shared cookie). */
  signOut: () => Promise<void>;
}

/**
 * Build the kubeez.com sign-in URL with a return path back to this exact
 * editor location. The kubeez.com Auth page validates `redirect_to` against
 * its `*.kubeez.com` allow-list before honoring it, so passing
 * `window.location.href` here is safe.
 */
export function buildKubeezSignInUrl(returnTo?: string): string {
  if (typeof window === 'undefined') return KUBEEZ_AUTH_URL;
  const target = returnTo ?? window.location.href;
  const url = new URL(KUBEEZ_AUTH_URL);
  url.searchParams.set('redirect_to', target);
  return url.toString();
}

export function useKubeezSession(): KubeezSessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        logger.warn('Initial session read failed', { error: error.message });
      }
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      logger.debug('Auth state change', { event, hasSession: Boolean(next) });
      setSession(next ?? null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signIn = () => {
    if (typeof window === 'undefined') return;
    window.location.href = buildKubeezSignInUrl();
  };

  const signOut = async () => {
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch (e) {
        logger.warn('signOut error (continuing with local clear)', { error: String(e) });
      }
    }
    clearAllSupabaseAuthStorage();
    clearKubeezProfileCache();
    setSession(null);
  };

  return {
    session,
    user: session?.user ?? null,
    loading,
    isConfigured: isSupabaseConfigured,
    signIn,
    signOut,
  };
}
