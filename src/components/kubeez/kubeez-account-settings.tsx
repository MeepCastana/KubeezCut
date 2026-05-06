/**
 * Kubeez account section for the editor settings panel.
 *
 * Shape it presents depends on whether Supabase auth is configured AND on
 * the host:
 *   - Signed in (any host): show "Signed in as …" + sign-out button. The
 *     API key field is hidden — the editor uses the session JWT.
 *   - Signed out, on `*.kubeez.com`: show a single "Sign in with Kubeez"
 *     CTA. The API key field is hidden — there is no reason for users on
 *     editor.kubeez.com to paste keys.
 *   - Signed out, on any other host (localhost, OSS deploys): keep the
 *     API-key paste field — that's the standalone path. Show a small
 *     "Sign in with Kubeez" link below as the recommended alternative.
 */

import * as React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { KUBEEZ_BRAND_LOGO_URL } from '@/components/brand/kubeez-cut-logo';
import { useKubeezSession } from '@/shared/state/kubeez-account';
import { SignInWithKubeezButton } from '@/components/kubeez/sign-in-with-kubeez-button';
import { useSettingsStore } from '@/features/settings/stores/settings-store';

function isKubeezHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return host === 'kubeez.com' || host.endsWith('.kubeez.com');
}

export interface KubeezAccountSettingsProps {
  /** DOM id stem for the API-key input (kept stable for label/htmlFor pairing). */
  inputIdPrefix?: string;
}

export function KubeezAccountSettings({ inputIdPrefix = 'kubeez-api-key' }: KubeezAccountSettingsProps) {
  const { user, isConfigured, signOut } = useKubeezSession();
  const kubeezApiKey = useSettingsStore((s) => s.kubeezApiKey);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const onKubeezHost = isKubeezHost();

  const [signingOut, setSigningOut] = React.useState(false);
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <img
          src={KUBEEZ_BRAND_LOGO_URL}
          alt="Kubeez"
          className="h-9 w-auto max-w-[min(100%,200px)] object-contain object-left"
        />
      </div>

      {/* Signed-in state — same on every host */}
      {user && (
        <div className="space-y-2 rounded-md border border-border/60 p-3">
          <div className="text-sm font-medium">
            Signed in as <span className="font-mono">{user.email ?? user.id}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Media generation uses your Kubeez account credits — no API key needed.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out of Kubeez'}
          </Button>
        </div>
      )}

      {/* Signed-out + Supabase configured + kubeez subdomain → CTA only */}
      {!user && isConfigured && onKubeezHost && (
        <div className="space-y-2 rounded-md border border-border/60 p-3">
          <p className="text-sm">
            Connect your Kubeez account to generate media directly inside the editor.
          </p>
          <SignInWithKubeezButton size="sm" />
        </div>
      )}

      {/* Signed-out elsewhere → keep the OSS API-key paste path */}
      {!user && (!isConfigured || !onKubeezHost) && (
        <div className="space-y-1.5">
          <Label className="text-sm" htmlFor={inputIdPrefix}>
            API key
          </Label>
          <Input
            id={inputIdPrefix}
            type="password"
            autoComplete="off"
            placeholder="Paste your Kubeez API key"
            value={kubeezApiKey}
            onChange={(e) => setSetting('kubeezApiKey', e.target.value)}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Required for Kubeez media generation. Stored in this browser&apos;s local storage only.
          </p>
          {isConfigured && (
            <div className="pt-1">
              <SignInWithKubeezButton size="sm" variant="link" label="Or sign in with Kubeez" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
