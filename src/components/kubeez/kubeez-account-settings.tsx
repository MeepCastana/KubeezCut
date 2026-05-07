/**
 * Kubeez account section for the editor settings panel.
 *
 *   - Signed in: show "Signed in as …" with sign-out button.
 *   - Signed out + Supabase configured: show the "Connect Kubeez account"
 *     CTA. Clicking it opens the kubeez.com auth iframe and the editor
 *     unlocks when the user signs in or registers.
 *   - Supabase not configured (forks without a Kubeez backend): the
 *     section just renders the brand mark — there is nothing to connect to.
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { KUBEEZ_BRAND_LOGO_URL } from '@/components/brand/kubeez-cut-logo';
import { useKubeezSession } from '@/shared/state/kubeez-account';
import { ConnectKubeezAccountButton } from '@/components/kubeez/connect-kubeez-account-button';

export function KubeezAccountSettings() {
  const { user, isConfigured, signOut } = useKubeezSession();

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

      {user && (
        <div className="space-y-2 rounded-md border border-border/60 p-3">
          <div className="text-sm font-medium">
            Signed in as <span className="font-mono">{user.email ?? user.id}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Media generation uses your Kubeez account credits.
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

      {!user && isConfigured && (
        <div className="space-y-2 rounded-md border border-border/60 p-3">
          <p className="text-sm">
            Connect your Kubeez account to generate media directly inside the editor.
          </p>
          <ConnectKubeezAccountButton size="sm" />
        </div>
      )}
    </div>
  );
}
