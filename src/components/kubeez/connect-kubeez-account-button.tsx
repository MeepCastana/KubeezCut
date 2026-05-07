/**
 * "Connect Kubeez account" — primary sign-in CTA shown wherever the editor
 * needs a Kubeez session (settings panel, generate dialog gate, etc.).
 *
 * Architecture (the OAuth-popup pattern, adapted for Kubeez):
 *
 *   1. Click → open `kubeez.com/auth?redirect_to=https://<editor>/auth-popup-callback`
 *      in a small popup window. Popup-not-iframe because the editor sets
 *      `Cross-Origin-Embedder-Policy: require-corp` for SharedArrayBuffer
 *      (used by the export pipeline), which blocks any cross-origin
 *      iframe whose response doesn't carry CORP. Popups are top-level
 *      windows and aren't subject to that constraint.
 *
 *   2. User signs in / signs up on real kubeez.com. The cookie kubeez.com
 *      sets is `Domain=.kubeez.com`, so it's already visible to the
 *      editor's origin too.
 *
 *   3. kubeez.com redirects the popup to our callback page
 *      (`/auth-popup-callback`). That page lives on the EDITOR'S OWN
 *      ORIGIN, so it can use `window.opener.postMessage` to notify us
 *      reliably — no third-party-cookie or cross-window-event quirks.
 *
 *   4. We catch the message, read the freshly-written session out of the
 *      cross-subdomain storage adapter directly, and call
 *      `supabase.auth.setSession(...)` to push it into the SDK. That
 *      fires `SIGNED_IN`, which propagates to every `useKubeezSession`
 *      subscriber — the editor unlocks without any reload.
 *
 *   5. We close the popup as part of the same handler. (The callback
 *      page also closes itself as a backup, in case the parent's message
 *      listener was torn down before delivery.)
 *
 * Defense in depth: a `popup.closed` poll handles the user closing the
 * popup themselves without finishing sign-in (we just reset the button
 * label). And on every `message` from this origin we also try the cookie
 * read path even if the message body is unexpected — keeps us resilient
 * to small protocol drift.
 *
 * The editor itself stays free and account-less. This CTA only runs when
 * the user opts into AI generation (which spends Kubeez credits).
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { KUBEEZ_BRAND_LOGO_URL } from '@/components/brand/kubeez-cut-logo';
import { supabase } from '@/infrastructure/supabase/client';
import { createCrossSubdomainStorage } from '@/infrastructure/supabase/cross-subdomain-storage';
import { buildKubeezSignInUrl, useKubeezSession } from '@/shared/state/kubeez-account';
import { cn } from '@/shared/ui/cn';
import { createLogger } from '@/shared/logging/logger';

const logger = createLogger('ConnectKubeezAccount');

/** Popup window dimensions — wide enough for the kubeez.com auth form, short enough to feel like a modal. */
const POPUP_FEATURES = 'width=520,height=720,menubar=no,toolbar=no,location=yes,resizable=yes,scrollbars=yes';
const POPUP_NAME = 'kubeez-auth';
/** How often we check `popup.closed`. Browsers don't fire any event for it — polling is the only signal. */
const POPUP_CLOSED_POLL_MS = 500;
/**
 * Periodic safety-net poll of the auth cookie while the popup is open.
 * Three independent detection paths fire `finishAuth`:
 *   1. postMessage from the callback page (instant — when COOP is set
 *      to `same-origin-allow-popups` so the opener isn't severed)
 *   2. This periodic cookie poll (~1s — works regardless of COOP /
 *      whether the popup successfully reaches the callback page)
 *   3. The popup-closed poll above (when the user closes manually)
 * One ALWAYS wins. The user's editor unlocks even if the others fail.
 */
const COOKIE_POLL_MS = 1000;

/** postMessage payload type — must match `KUBEEZ_AUTH_COMPLETE_MESSAGE` in `routes/auth-popup-callback.tsx`. */
const AUTH_COMPLETE_MESSAGE = 'kubeez:auth-complete';

/**
 * Cross-subdomain auth-storage adapter. We call `getItem` on this
 * directly to read the cookie the popup just wrote — bypassing the
 * SDK's in-memory cache, which holds the pre-popup `null` and never
 * re-reads storage on subsequent `getSession()` calls.
 */
const sharedAuthStorage = createCrossSubdomainStorage();

/**
 * Storage key supabase-js v2 uses: `sb-${ref}-auth-token`, where `ref` is
 * the leading hostname label of the configured Supabase URL
 * (`connect.kubeez.com` → `connect`). We compute it once at module load
 * from the same env var the Supabase client reads, so the key always
 * matches what the popup wrote.
 */
const SUPABASE_STORAGE_KEY = (() => {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
  if (!url) return null;
  try {
    const ref = new URL(url).hostname.split('.')[0];
    if (!ref) return null;
    return `sb-${ref}-auth-token`;
  } catch {
    return null;
  }
})();

interface PersistedSupabaseSession {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

function readPersistedSession(): PersistedSupabaseSession | null {
  if (!SUPABASE_STORAGE_KEY) return null;
  const raw = sharedAuthStorage.getItem(SUPABASE_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedSupabaseSession;
    if (!parsed.access_token || !parsed.refresh_token) return null;
    if (parsed.expires_at && parsed.expires_at * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildPopupSignInUrl(): string {
  if (typeof window === 'undefined') return buildKubeezSignInUrl();
  const callback = `${window.location.origin}/auth-popup-callback`;
  return buildKubeezSignInUrl(callback);
}

type ButtonElementProps = React.ComponentProps<typeof Button>;

export interface ConnectKubeezAccountButtonProps
  extends Omit<ButtonElementProps, 'onClick' | 'children'> {
  /** Override the default label ("Connect Kubeez account"). */
  label?: string;
  /** Hide the small Kubeez logo. */
  hideIcon?: boolean;
}

export function ConnectKubeezAccountButton({
  label = 'Connect Kubeez account',
  hideIcon = false,
  className,
  ...buttonProps
}: ConnectKubeezAccountButtonProps) {
  const { isConfigured, loading } = useKubeezSession();
  const popupRef = React.useRef<Window | null>(null);
  const [popupOpen, setPopupOpen] = React.useState(false);

  const finishAuth = React.useCallback(async () => {
    const persisted = readPersistedSession();
    if (!persisted) {
      logger.warn('Auth-complete message received but no session in cookies');
      return;
    }
    try {
      popupRef.current?.close();
    } catch {
      /* ignore — cross-origin close throws on some browsers; popup callback also closes itself */
    }
    popupRef.current = null;
    setPopupOpen(false);
    if (!supabase) return;
    try {
      // Push the tokens into the SDK so it fires SIGNED_IN. That
      // propagates to every onAuthStateChange subscriber (useKubeezSession
      // and friends), which causes this button to unmount and the rest
      // of the editor to flip into its signed-in state without a reload.
      await supabase.auth.setSession({
        access_token: persisted.access_token!,
        refresh_token: persisted.refresh_token!,
      });
      logger.debug('Auth complete — session broadcast');
    } catch (e) {
      logger.warn('setSession broadcast failed', { error: String(e) });
    }
  }, []);

  // Listen for the callback page's postMessage. Only accept messages
  // from our own origin (security: a malicious site otherwise could
  // post `kubeez:auth-complete` from a hidden iframe and we'd try to
  // upgrade with whatever's in our cookies — same outcome but better to
  // be explicit about the trust boundary).
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: unknown } | null;
      if (!data || typeof data !== 'object' || data.type !== AUTH_COMPLETE_MESSAGE) return;
      void finishAuth();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [finishAuth]);

  // If the user closes the popup without signing in, reset the button.
  // Browsers don't fire any event for this — polling is the only signal.
  React.useEffect(() => {
    if (!popupOpen) return;
    const interval = window.setInterval(() => {
      const popup = popupRef.current;
      if (!popup || popup.closed) {
        // One last cookie check on close in case the popup completed
        // sign-in but the postMessage was missed (e.g. the user closed
        // the callback page faster than the message could deliver).
        if (readPersistedSession()) {
          void finishAuth();
        } else {
          popupRef.current = null;
          setPopupOpen(false);
        }
      }
    }, POPUP_CLOSED_POLL_MS);
    return () => window.clearInterval(interval);
  }, [popupOpen, finishAuth]);

  // Safety-net cookie poll: detects auth completion even when postMessage
  // was severed by COOP (or the user is on a stale dev server that hasn't
  // picked up the `same-origin-allow-popups` change yet) AND while the
  // popup window is still open. Without this, broken postMessage means
  // the editor stays on "Waiting for sign-in…" forever.
  React.useEffect(() => {
    if (!popupOpen) return;
    const interval = window.setInterval(() => {
      if (readPersistedSession()) {
        void finishAuth();
      }
    }, COOKIE_POLL_MS);
    return () => window.clearInterval(interval);
  }, [popupOpen, finishAuth]);

  if (!isConfigured) return null;

  const handleClick = () => {
    // Re-focus an existing popup if one is already open.
    const existing = popupRef.current;
    if (existing && !existing.closed) {
      try {
        existing.focus();
      } catch {
        /* ignore */
      }
      return;
    }

    const url = buildPopupSignInUrl();
    const popup = window.open(url, POPUP_NAME, POPUP_FEATURES);
    if (!popup) {
      // Popup blocked. Fall back to full-window navigation so the user
      // still has a way to sign in. They'll come back to the editor via
      // the same redirect_to (the callback page closes itself if it's
      // a popup, otherwise it sits there briefly before the next nav).
      logger.warn('Popup blocked — falling back to full-window navigation');
      window.location.href = url;
      return;
    }

    popupRef.current = popup;
    setPopupOpen(true);
    try {
      popup.focus();
    } catch {
      /* ignore */
    }
  };

  return (
    <Button
      type="button"
      onClick={handleClick}
      disabled={loading || buttonProps.disabled}
      className={cn('gap-2', className)}
      {...buttonProps}
    >
      {!hideIcon && (
        <img
          src={KUBEEZ_BRAND_LOGO_URL}
          alt=""
          aria-hidden="true"
          className="h-4 w-4 object-contain"
        />
      )}
      {popupOpen ? 'Waiting for sign-in…' : label}
    </Button>
  );
}
