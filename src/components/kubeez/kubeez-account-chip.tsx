/**
 * Compact "you're signed in as …" chip — avatar + display name + live
 * credit balance. Designed to sit in dialog headers where the user wants
 * to confirm at a glance whose account they're spending from.
 *
 * Click → dropdown with email + a "Sign out of Kubeez" action so users
 * can swap accounts without leaving the editor.
 *
 * Profile data comes from the `profiles` table (via `useKubeezProfile`),
 * which caches per-user in localStorage so the chip never flashes a
 * fallback name on subsequent opens.
 *
 * Renders nothing when the user is not signed in (parent UI should be
 * showing a Connect button in that state).
 */

import * as React from 'react';
import { LogOut } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useKubeezProfile, useKubeezSession } from '@/shared/state/kubeez-account';
import { cn } from '@/shared/ui/cn';

export interface KubeezAccountChipProps {
  /** Live credit balance from `useKubeezCredits`. `null` while loading; not rendered when null. */
  credits?: number | null;
  className?: string;
}

export function KubeezAccountChip({ credits, className }: KubeezAccountChipProps) {
  const { user, signOut } = useKubeezSession();
  const profile = useKubeezProfile();
  const [imgFailed, setImgFailed] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  // Reset failure flag when avatar URL changes (e.g. cache → live fetch).
  React.useEffect(() => {
    setImgFailed(false);
  }, [profile.avatarUrl]);

  if (!user) return null;

  const showImage = profile.avatarUrl && !imgFailed;
  const initial = (profile.username[0] ?? 'K').toUpperCase();
  const formattedCredits =
    typeof credits === 'number' ? Math.floor(credits).toLocaleString() : null;

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 rounded-full border border-border/60 bg-card/60 py-0.5 pl-0.5 pr-2.5 transition-colors hover:bg-card focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className
          )}
          aria-label={`Account menu — signed in as ${profile.username}`}
        >
          <div
            className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
            aria-hidden
          >
            {showImage ? (
              <img
                src={profile.avatarUrl!}
                alt=""
                /* CORS-mode request avoids the COEP-default `same-origin`
                 * block that fires for cross-origin no-CORS image loads when
                 * the editor sends `Cross-Origin-Embedder-Policy: require-corp`. */
                crossOrigin="anonymous"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              initial
            )}
          </div>
          <span className="max-w-[10rem] truncate text-xs font-medium text-foreground">
            {profile.username}
          </span>
          {formattedCredits !== null && (
            <span className="flex items-center gap-1 border-l border-border/50 pl-2">
              <span className="text-xs font-bold tabular-nums text-foreground">
                {formattedCredits}
              </span>
              <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                credits
              </span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[14rem]">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{profile.username}</span>
          {profile.email && (
            <span className="font-mono text-[11px] font-normal text-muted-foreground">
              {profile.email}
            </span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void handleSignOut();
          }}
          disabled={signingOut}
          className="gap-2"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          {signingOut ? 'Signing out…' : 'Sign out of Kubeez'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
