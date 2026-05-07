/**
 * Popup callback for the Kubeez sign-in flow.
 *
 * The "Connect Kubeez account" button opens `kubeez.com/auth?redirect_to=
 * https://<this-editor>/auth-popup-callback`. After the user signs in,
 * kubeez.com sets the `.kubeez.com` cookie and redirects the popup here.
 *
 * Because this page lives on the EDITOR'S OWN ORIGIN, it can use
 * `window.opener.postMessage` to notify the parent reliably (same-origin
 * postMessage has no third-party-cookie / cross-window-event quirks).
 * The parent then reads the cookie via the cross-subdomain storage
 * adapter, calls `supabase.auth.setSession(...)` to broadcast SIGNED_IN,
 * and closes us.
 *
 * As a defense-in-depth, we also call `window.close()` ourselves so the
 * popup goes away even if the parent's listener is gone (rare — would
 * require navigation away while the popup is open).
 */

import * as React from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { KUBEEZ_BRAND_LOGO_URL } from '@/components/brand/kubeez-cut-logo';

export const KUBEEZ_AUTH_COMPLETE_MESSAGE = 'kubeez:auth-complete';

function PopupCallback() {
  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Notify the parent immediately. Same-origin postMessage is the
    //    fast path — the parent reads the cookie and updates its state.
    const opener = window.opener as Window | null;
    if (opener && !opener.closed) {
      try {
        opener.postMessage({ type: KUBEEZ_AUTH_COMPLETE_MESSAGE }, window.location.origin);
      } catch {
        /* opener severed or origin mismatch — popup will still close itself */
      }
    }

    // 2. Close ourselves. Chrome can be flaky about `window.close()` on a
    //    popup that navigated cross-origin and back — first attempt
    //    sometimes silently no-ops. Try multiple times on a fast cadence.
    const tryClose = () => {
      try {
        window.close();
      } catch {
        /* ignore — happens when window wasn't actually opened by JS */
      }
    };
    tryClose();
    const t1 = window.setTimeout(tryClose, 50);
    const t2 = window.setTimeout(tryClose, 300);
    const t3 = window.setTimeout(tryClose, 1000);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, []);

  // Minimal "if you're still seeing this" UI. In the happy path the
  // window closes within a few ms — this only shows if the browser
  // refused to close (extension, popup-keeper, etc.) and gives the user
  // somewhere to manually dismiss the popup.
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background text-foreground">
      <img
        src={KUBEEZ_BRAND_LOGO_URL}
        alt="Kubeez"
        className="h-10 w-10 object-contain"
      />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Signed in. You can close this window.
      </div>
    </div>
  );
}

export const Route = createFileRoute('/auth-popup-callback')({
  component: PopupCallback,
});
